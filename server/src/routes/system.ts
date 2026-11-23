import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Router } from 'express';
import { getSettings } from '../config/store';
import { getActiveBranchById } from '../providers/providerManager';
import { resolveSafeFilePath } from '../utils/pathSafety';

export const systemRouter = Router();

systemRouter.post('/open-editor', (req, res, next) => {
  try {
    const { branchId, filePath } = req.body ?? {};
    if (!branchId || !filePath) {
      res.status(400).json({ error: 'branchId and filePath are required.' });
      return;
    }

    const branch = getActiveBranchById(String(branchId));
    const fullPath = resolveSafeFilePath(branch.path, String(filePath));
    const settings = getSettings();

    if (settings.mode === 'demo') {
      res.json({
        ok: true,
        simulated: true,
        fullPath,
        editor: settings.editorCommand || 'code',
        message: `Demo mode: simulated opening ${fullPath} in "${settings.editorCommand || 'code'}".`,
      });
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: `File does not exist on disk: ${fullPath}` });
      return;
    }

    const editorCmd = (settings.editorCommand || 'code').trim();
    if (process.platform === 'win32') {
      if (editorCmd === 'default') {
        const child = spawn('cmd.exe', ['/c', 'start', '', fullPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      } else {
        const child = spawn('cmd.exe', ['/c', editorCmd, fullPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      }
    } else {
      const cmd = editorCmd === 'default' ? 'xdg-open' : editorCmd;
      const child = spawn(cmd, [fullPath], { detached: true, stdio: 'ignore' });
      child.unref();
    }

    res.json({ ok: true, simulated: false, fullPath, editor: editorCmd });
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/open-folder', (req, res, next) => {
  try {
    const { branchId } = req.body ?? {};
    if (!branchId) {
      res.status(400).json({ error: 'branchId is required.' });
      return;
    }

    const branch = getActiveBranchById(String(branchId));
    const settings = getSettings();

    if (settings.mode === 'demo') {
      res.json({
        ok: true,
        simulated: true,
        path: branch.path,
        message: `Demo mode: simulated opening folder ${branch.path}.`,
      });
      return;
    }

    if (!fs.existsSync(branch.path)) {
      res.status(404).json({ error: `Folder not found on disk: ${branch.path}` });
      return;
    }

    if (process.platform === 'win32') {
      const child = spawn('explorer.exe', [branch.path], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } else {
      const child = spawn('xdg-open', [branch.path], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }

    res.json({ ok: true, simulated: false, path: branch.path });
  } catch (err) {
    next(err);
  }
});
