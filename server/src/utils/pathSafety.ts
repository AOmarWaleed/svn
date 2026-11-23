import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ScannedWorkingCopy } from '../../../shared/types';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  'dist',
  'build',
  '.next',
  '.cache',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

/**
 * Resolves the workspace root directory regardless of whether running from tsx src or compiled dist.
 */
export function getProjectRoot(): string {
  let current = __dirname;
  for (let i = 0; i < 8; i++) {
    const hasServerPkg = fs.existsSync(path.join(current, 'server', 'package.json'));
    const hasShared = fs.existsSync(path.join(current, 'shared', 'types.ts'));
    if (hasServerPkg && hasShared) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * Ensures a relative or sub-path resolves strictly within the working copy root.
 */
export function resolveSafeFilePath(workingCopyRoot: string, relativeOrSubPath: string): string {
  if (!workingCopyRoot || !relativeOrSubPath) {
    throw Object.assign(new Error('Working copy root and file path are required.'), { statusCode: 400 });
  }

  const normalizedRoot = path.resolve(workingCopyRoot);
  const cleanedSub = relativeOrSubPath.replace(/^[/\\]+/, '');
  if (!cleanedSub || cleanedSub.includes('\0')) {
    throw Object.assign(new Error('Invalid file path.'), { statusCode: 400 });
  }

  const resolvedTarget = path.resolve(normalizedRoot, cleanedSub);
  const rootWithSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;

  const isWin = process.platform === 'win32';
  const targetCmp = isWin ? resolvedTarget.toLowerCase() : resolvedTarget;
  const rootWithSepCmp = isWin ? rootWithSep.toLowerCase() : rootWithSep;
  const rootCmp = isWin ? normalizedRoot.toLowerCase() : normalizedRoot;

  if (targetCmp !== rootCmp && !targetCmp.startsWith(rootWithSepCmp)) {
    throw Object.assign(new Error(`Path traversal blocked: ${relativeOrSubPath}`), { statusCode: 400 });
  }

  return resolvedTarget;
}

/**
 * Normalizes a file path relative to a working copy root using forward slashes.
 */
export function toRelativePosixPath(workingCopyRoot: string, entryPath: string): string {
  const normalizedRoot = path.resolve(workingCopyRoot);
  const resolvedEntry = path.isAbsolute(entryPath)
    ? path.resolve(entryPath)
    : path.resolve(normalizedRoot, entryPath);

  const rel = path.relative(normalizedRoot, resolvedEntry);
  if (!rel || rel === '') return '.';
  return rel.split(path.sep).join('/');
}

/**
 * Recursively scans a parent directory for SVN working copies (folders containing a .svn directory).
 */
export async function scanForSvnWorkingCopies(
  rootDir: string,
  existingPaths: string[] = [],
  maxDepth = 3
): Promise<ScannedWorkingCopy[]> {
  const resolvedRoot = path.resolve(rootDir);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolvedRoot);
  } catch {
    throw Object.assign(new Error(`Directory not found: ${resolvedRoot}`), { statusCode: 404 });
  }

  if (!stat.isDirectory()) {
    throw Object.assign(new Error(`Path is not a directory: ${resolvedRoot}`), { statusCode: 400 });
  }

  const existingSet = new Set(
    existingPaths.map((p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)))
  );

  const found: ScannedWorkingCopy[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    const svnMetaDir = path.join(dir, '.svn');
    try {
      const svnStat = await fsp.stat(svnMetaDir);
      if (svnStat.isDirectory()) {
        const cmp = process.platform === 'win32' ? dir.toLowerCase() : dir;
        found.push({
          name: path.basename(dir) || dir,
          path: dir,
          alreadyAdded: existingSet.has(cmp),
        });
        return; // Don't recurse inside an SVN working copy
      }
    } catch {
      // Not an SVN working copy; continue walking children
    }

    if (depth === maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  await walk(resolvedRoot, 0);

  return found.sort((a, b) => a.name.localeCompare(b.name));
}
