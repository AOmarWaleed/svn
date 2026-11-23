import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cachedVsCodePath: string | null | undefined;

function runWhere(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    let out = '';
    try {
      const child = spawn(cmd, [bin], { windowsHide: true });
      child.stdout?.on('data', (d) => {
        out += String(d);
      });
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }
        const first = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean);
        resolve(first ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function detectVsCodePath(): Promise<string | null> {
  if (cachedVsCodePath !== undefined) return cachedVsCodePath;

  const fromWhere =
    (await runWhere(process.platform === 'win32' ? 'code.cmd' : 'code')) ||
    (await runWhere('code'));
  if (fromWhere && fs.existsSync(fromWhere)) {
    cachedVsCodePath = fromWhere;
    return fromWhere;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
      'C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        cachedVsCodePath = c;
        return c;
      }
    }
  }

  cachedVsCodePath = null;
  return null;
}

async function launchEditorArgs(args: string[], editorCommand: string): Promise<string> {
  const cmdSetting = (editorCommand || 'code').trim();

  if (process.platform === 'win32') {
    if (cmdSetting === 'default' && args.length === 1) {
      const child = spawn('cmd.exe', ['/c', 'start', '', args[0]], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return 'default';
    }

    const detected = await detectVsCodePath();
    const resolvedBin =
      (cmdSetting === 'code' || cmdSetting === 'code.cmd') && detected ? detected : cmdSetting;

    const child = spawn('cmd.exe', ['/c', resolvedBin, ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return resolvedBin;
  }

  const bin = cmdSetting === 'default' ? 'xdg-open' : cmdSetting;
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return bin;
}

export async function openFilesInEditor(
  filePaths: string[],
  editorCommand: string
): Promise<string> {
  if (filePaths.length === 0) {
    throw Object.assign(new Error('No files specified to open.'), { statusCode: 400 });
  }
  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) {
      throw Object.assign(new Error(`File not found on disk: ${fp}`), { statusCode: 404 });
    }
  }
  return launchEditorArgs(filePaths, editorCommand);
}

export async function openDiffInVsCode(
  sourcePath: string,
  targetPath: string,
  editorCommand: string
): Promise<string> {
  if (!fs.existsSync(sourcePath)) {
    throw Object.assign(new Error(`Source file not found: ${sourcePath}`), { statusCode: 404 });
  }
  if (!fs.existsSync(targetPath)) {
    throw Object.assign(new Error(`Target file not found: ${targetPath}`), { statusCode: 404 });
  }
  return launchEditorArgs(['--diff', sourcePath, targetPath], editorCommand);
}

export function openFolderInExplorer(folderPath: string): void {
  if (!fs.existsSync(folderPath)) {
    throw Object.assign(new Error(`Folder not found: ${folderPath}`), { statusCode: 404 });
  }
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}
