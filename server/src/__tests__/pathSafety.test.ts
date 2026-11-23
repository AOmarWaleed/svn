import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSafeFilePath, scanForSvnWorkingCopies } from '../utils/pathSafety';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

describe('pathSafety', () => {
  it('resolves valid subpaths and blocks directory traversal', () => {
    const root = path.resolve(os.tmpdir(), 'svn-wc-root');
    const valid = resolveSafeFilePath(root, 'src/services/invoice.ts');
    expect(valid).toBe(path.resolve(root, 'src', 'services', 'invoice.ts'));

    expect(() => resolveSafeFilePath(root, '../../etc/passwd')).toThrow(/traversal/i);
    expect(() => resolveSafeFilePath(root, '..\\..\\Windows\\win.ini')).toThrow(/traversal/i);
  });

  it('scans a directory tree and discovers .svn working copies', async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'svn-scan-'));
    tmpDirs.push(base);

    const masterDir = path.join(base, 'erp-master');
    const branchDir = path.join(base, 'branches', 'erp-billing');
    const nonSvnDir = path.join(base, 'other-folder');

    await fsp.mkdir(path.join(masterDir, '.svn'), { recursive: true });
    await fsp.mkdir(path.join(branchDir, '.svn'), { recursive: true });
    await fsp.mkdir(nonSvnDir, { recursive: true });

    const found = await scanForSvnWorkingCopies(base, [masterDir], 3);
    expect(found).toHaveLength(2);

    const masterItem = found.find((f) => f.name === 'erp-master');
    const branchItem = found.find((f) => f.name === 'erp-billing');

    expect(masterItem?.alreadyAdded).toBe(true);
    expect(branchItem?.alreadyAdded).toBe(false);
  });
});
