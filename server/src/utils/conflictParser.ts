import type { ConflictHunk, ConflictSegment } from '../../../shared/types';

export type HunkResolutionChoice =
  | 'mine'
  | 'theirs'
  | 'both-mine-first'
  | 'both-theirs-first'
  | { custom: string };

/**
 * Counts unresolved SVN conflict markers in file text.
 */
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

/**
 * Parses standard 2-way and 3-way (diff3) conflict markers into structured segments and hunks.
 */
export function parseConflictMarkers(content: string): {
  segments: ConflictSegment[];
  hunks: ConflictHunk[];
  markerCount: number;
} {
  const lines = content.split(/\r?\n/);
  const segments: ConflictSegment[] = [];
  const hunks: ConflictHunk[] = [];

  let normalBuffer: string[] = [];
  let i = 0;
  let hunkIndex = 0;

  const flushNormal = () => {
    if (normalBuffer.length > 0) {
      segments.push({ type: 'normal', lines: normalBuffer });
      normalBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) {
      const startLine = i + 1;
      const mineLabel = line.slice(7).trim() || '.working';
      const mineLines: string[] = [];
      let baseLabel: string | undefined;
      let baseLines: string[] | undefined;
      const theirsLines: string[] = [];
      let theirsLabel = '.merge-right';

      let section: 'mine' | 'base' | 'theirs' = 'mine';
      let closed = false;
      let j = i + 1;

      while (j < lines.length) {
        const cur = lines[j];
        if (section === 'mine' && cur.startsWith('|||||||')) {
          baseLabel = cur.slice(7).trim() || '.merge-left';
          baseLines = [];
          section = 'base';
        } else if ((section === 'mine' || section === 'base') && cur.startsWith('=======')) {
          section = 'theirs';
        } else if (section === 'theirs' && cur.startsWith('>>>>>>>')) {
          theirsLabel = cur.slice(7).trim() || '.merge-right';
          closed = true;
          break;
        } else {
          if (section === 'mine') mineLines.push(cur);
          else if (section === 'base' && baseLines) baseLines.push(cur);
          else theirsLines.push(cur);
        }
        j++;
      }

      if (closed) {
        flushNormal();
        hunkIndex++;
        const hunk: ConflictHunk = {
          id: `hunk-${hunkIndex}`,
          startLine,
          endLine: j + 1,
          mineLabel,
          baseLabel,
          theirsLabel,
          mineLines,
          baseLines,
          theirsLines,
        };
        hunks.push(hunk);
        segments.push({ type: 'conflict', hunk });
        i = j + 1;
        continue;
      }
    }

    normalBuffer.push(line);
    i++;
  }

  flushNormal();

  return {
    segments,
    hunks,
    markerCount: hunks.length,
  };
}

/**
 * Reconstructs clean file content by applying user choices for each conflict hunk.
 */
export function applyHunkChoices(
  segments: ConflictSegment[],
  choices: Record<string, HunkResolutionChoice>,
  lineEnding: '\n' | '\r\n' = '\n'
): string {
  const outLines: string[] = [];

  for (const segment of segments) {
    if (segment.type === 'normal') {
      outLines.push(...segment.lines);
      continue;
    }

    const { hunk } = segment;
    const choice = choices[hunk.id];
    if (!choice) {
      // Leave unresolved markers intact if no choice was supplied for this hunk
      outLines.push(`<<<<<<< ${hunk.mineLabel}`);
      outLines.push(...hunk.mineLines);
      if (hunk.baseLines !== undefined) {
        outLines.push(`||||||| ${hunk.baseLabel ?? '.merge-left'}`);
        outLines.push(...hunk.baseLines);
      }
      outLines.push('=======');
      outLines.push(...hunk.theirsLines);
      outLines.push(`>>>>>>> ${hunk.theirsLabel}`);
      continue;
    }

    if (choice === 'mine') {
      outLines.push(...hunk.mineLines);
    } else if (choice === 'theirs') {
      outLines.push(...hunk.theirsLines);
    } else if (choice === 'both-mine-first') {
      outLines.push(...hunk.mineLines, ...hunk.theirsLines);
    } else if (choice === 'both-theirs-first') {
      outLines.push(...hunk.theirsLines, ...hunk.mineLines);
    } else if (typeof choice === 'object' && 'custom' in choice) {
      outLines.push(...choice.custom.split(/\r?\n/));
    }
  }

  return outLines.join(lineEnding);
}
