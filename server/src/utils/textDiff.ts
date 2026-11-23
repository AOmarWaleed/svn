type LineOp =
  | { type: 'eq'; line: string; oldNum: number; newNum: number }
  | { type: 'del'; line: string; oldNum: number }
  | { type: 'add'; line: string; newNum: number };

const MAX_LCS_CELLS = 2_000_000;

export function isBinaryBuffer(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function countConflictMarkers(content: string): number {
  const lines = content.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (line.startsWith('<<<<<<< ') || line === '<<<<<<<') {
      count++;
    }
  }
  return count;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split(/\r?\n/);
}

function computeLineOps(oldLines: string[], newLines: string[]): LineOp[] {
  const oldLen = oldLines.length;
  const newLen = newLines.length;

  let prefix = 0;
  while (prefix < oldLen && prefix < newLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLen - prefix &&
    suffix < newLen - prefix &&
    oldLines[oldLen - 1 - suffix] === newLines[newLen - 1 - suffix]
  ) {
    suffix++;
  }

  const ops: LineOp[] = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ type: 'eq', line: oldLines[i], oldNum: i + 1, newNum: i + 1 });
  }

  const midOld = oldLines.slice(prefix, oldLen - suffix);
  const midNew = newLines.slice(prefix, newLen - suffix);
  const m = midOld.length;
  const n = midNew.length;

  if (m === 0 && n === 0) {
    // identical
  } else if (m === 0) {
    for (let j = 0; j < n; j++) {
      ops.push({ type: 'add', line: midNew[j], newNum: prefix + j + 1 });
    }
  } else if (n === 0) {
    for (let i = 0; i < m; i++) {
      ops.push({ type: 'del', line: midOld[i], oldNum: prefix + i + 1 });
    }
  } else if (m * n > MAX_LCS_CELLS) {
    // Fallback for gigantic differing blocks so event loop stays responsive
    for (let i = 0; i < m; i++) {
      ops.push({ type: 'del', line: midOld[i], oldNum: prefix + i + 1 });
    }
    for (let j = 0; j < n; j++) {
      ops.push({ type: 'add', line: midNew[j], newNum: prefix + j + 1 });
    }
  } else {
    const cols = n + 1;
    const dp = new Int32Array((m + 1) * cols);

    for (let i = m - 1; i >= 0; i--) {
      const rowOffset = i * cols;
      const nextRowOffset = (i + 1) * cols;
      for (let j = n - 1; j >= 0; j--) {
        if (midOld[i] === midNew[j]) {
          dp[rowOffset + j] = dp[nextRowOffset + j + 1] + 1;
        } else {
          const down = dp[nextRowOffset + j];
          const right = dp[rowOffset + j + 1];
          dp[rowOffset + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midOld[i] === midNew[j]) {
        ops.push({
          type: 'eq',
          line: midOld[i],
          oldNum: prefix + i + 1,
          newNum: prefix + j + 1,
        });
        i++;
        j++;
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
        ops.push({ type: 'del', line: midOld[i], oldNum: prefix + i + 1 });
        i++;
      } else {
        ops.push({ type: 'add', line: midNew[j], newNum: prefix + j + 1 });
        j++;
      }
    }
    while (i < m) {
      ops.push({ type: 'del', line: midOld[i], oldNum: prefix + i + 1 });
      i++;
    }
    while (j < n) {
      ops.push({ type: 'add', line: midNew[j], newNum: prefix + j + 1 });
      j++;
    }
  }

  for (let k = 0; k < suffix; k++) {
    const oIdx = oldLen - suffix + k;
    const nIdx = newLen - suffix + k;
    ops.push({
      type: 'eq',
      line: oldLines[oIdx],
      oldNum: oIdx + 1,
      newNum: nIdx + 1,
    });
  }

  return ops;
}

/**
 * Generates a standard unified diff with 3-line hunk context.
 */
export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  fileLabel: string,
  oldLabel = 'target',
  newLabel = 'source'
): string {
  if (oldText === newText) return '';

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const ops = computeLineOps(oldLines, newLines);

  const changeIndices: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'eq') changeIndices.push(i);
  }
  if (changeIndices.length === 0) return '';

  const context = 3;
  const hunks: Array<{ start: number; end: number }> = [];
  let curStart = Math.max(0, changeIndices[0] - context);
  let curEnd = Math.min(ops.length - 1, changeIndices[0] + context);

  for (let idx = 1; idx < changeIndices.length; idx++) {
    const ci = changeIndices[idx];
    const nextStart = Math.max(0, ci - context);
    const nextEnd = Math.min(ops.length - 1, ci + context);
    if (nextStart <= curEnd + 1) {
      curEnd = nextEnd;
    } else {
      hunks.push({ start: curStart, end: curEnd });
      curStart = nextStart;
      curEnd = nextEnd;
    }
  }
  hunks.push({ start: curStart, end: curEnd });

  const out: string[] = [
    `Index: ${fileLabel}`,
    '===================================================================',
    `--- ${fileLabel}\t(${oldLabel})`,
    `+++ ${fileLabel}\t(${newLabel})`,
  ];

  for (const hunk of hunks) {
    const slice = ops.slice(hunk.start, hunk.end + 1);
    let oldCount = 0;
    let newCount = 0;
    let firstOld = 0;
    let firstNew = 0;

    for (const op of slice) {
      if (op.type === 'eq') {
        if (!firstOld) firstOld = op.oldNum;
        if (!firstNew) firstNew = op.newNum;
        oldCount++;
        newCount++;
      } else if (op.type === 'del') {
        if (!firstOld) firstOld = op.oldNum;
        oldCount++;
      } else {
        if (!firstNew) firstNew = op.newNum;
        newCount++;
      }
    }

    if (!firstOld) firstOld = oldCount === 0 ? 0 : 1;
    if (!firstNew) firstNew = newCount === 0 ? 0 : 1;

    out.push(`@@ -${firstOld},${oldCount} +${firstNew},${newCount} @@`);
    for (const op of slice) {
      if (op.type === 'eq') out.push(` ${op.line}`);
      else if (op.type === 'del') out.push(`-${op.line}`);
      else out.push(`+${op.line}`);
    }
  }

  return out.join('\n');
}

/**
 * Inserts surgical per-hunk conflict markers (VS Code Merge Editor compatible)
 * while preserving all identical surrounding lines cleanly.
 */
export function buildSmartConflictMarkers(
  targetText: string,
  sourceText: string,
  targetLabel = 'TARGET (Current)',
  sourceLabel = 'SOURCE (Incoming)'
): { content: string; conflictCount: number } {
  if (targetText === sourceText) {
    return { content: targetText, conflictCount: 0 };
  }

  const targetLines = splitLines(targetText);
  const sourceLines = splitLines(sourceText);
  const ops = computeLineOps(targetLines, sourceLines);

  const lineEnding = targetText.includes('\r\n') ? '\r\n' : '\n';
  const out: string[] = [];
  let conflictCount = 0;
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'eq') {
      out.push(op.line);
      i++;
      continue;
    }

    const mineChunk: string[] = [];
    const theirsChunk: string[] = [];
    while (i < ops.length && ops[i].type !== 'eq') {
      const cur = ops[i];
      if (cur.type === 'del') mineChunk.push(cur.line);
      else if (cur.type === 'add') theirsChunk.push(cur.line);
      i++;
    }

    conflictCount++;
    out.push(`<<<<<<< ${targetLabel}`);
    out.push(...mineChunk);
    out.push('=======');
    out.push(...theirsChunk);
    out.push(`>>>>>>> ${sourceLabel}`);
  }

  return {
    content: out.join(lineEnding),
    conflictCount,
  };
}
