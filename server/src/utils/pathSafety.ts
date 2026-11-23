import fs from 'node:fs';
import path from 'node:path';

/**
 * Finds the workspace root directory regardless of whether running from tsx src or compiled dist.
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
 * Resolves a relative sub-path strictly inside rootDir, blocking directory traversal.
 */
export function resolveInsideRoot(rootDir: string, subPath: string): string {
  if (!rootDir) {
    throw Object.assign(new Error('Root directory is required.'), { statusCode: 400 });
  }
  if (subPath.includes('\0')) {
    throw Object.assign(new Error('Invalid path characters.'), { statusCode: 400 });
  }

  const normalizedRoot = path.resolve(rootDir);
  const cleaned = subPath.replace(/^[/\\]+/, '');
  const resolvedTarget = cleaned ? path.resolve(normalizedRoot, cleaned) : normalizedRoot;
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;

  const isWin = process.platform === 'win32';
  const targetCmp = isWin ? resolvedTarget.toLowerCase() : resolvedTarget;
  const rootCmp = isWin ? normalizedRoot.toLowerCase() : normalizedRoot;
  const rootWithSepCmp = isWin ? rootWithSep.toLowerCase() : rootWithSep;

  if (targetCmp !== rootCmp && !targetCmp.startsWith(rootWithSepCmp)) {
    throw Object.assign(new Error(`Path traversal blocked: ${subPath}`), { statusCode: 400 });
  }

  return resolvedTarget;
}

export function toPosixRel(baseDir: string, fullPath: string): string {
  const rel = path.relative(path.resolve(baseDir), path.resolve(fullPath));
  if (!rel || rel === '') return '.';
  return rel.split(path.sep).join('/');
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Matches a posix relative file path against ignore or protected patterns.
 */
export function matchesAnyPattern(relPath: string, patterns: string[]): string | null {
  const normalized = relPath.split('\\').join('/').replace(/^\/+/, '').toLowerCase();
  if (!normalized) return null;

  const segments = normalized.split('/');
  const basename = segments[segments.length - 1];

  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) continue;

    if (pattern.includes('/')) {
      const re = globToRegex(pattern);
      if (re.test(normalized)) {
        return rawPattern;
      }
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
          return rawPattern;
        }
      }
    } else {
      const re = globToRegex(pattern);
      if (re.test(basename) || segments.some((seg) => re.test(seg))) {
        return rawPattern;
      }
    }
  }

  return null;
}
