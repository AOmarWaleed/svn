import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getOperationHistory, getSettings, initConfigStore } from './config/store';
import { branchesRouter } from './routes/branches';
import { conflictsRouter } from './routes/conflicts';
import { healthRouter } from './routes/health';
import { logsRouter } from './routes/logs';
import { mergeRouter } from './routes/merge';
import { resetDemoHandler, settingsRouter } from './routes/settings';
import { svnRouter } from './routes/svn';
import { systemRouter } from './routes/system';
import { getProjectRoot } from './utils/pathSafety';

export async function createApp(): Promise<express.Express> {
  await initConfigStore();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/settings', settingsRouter);
  app.post('/api/demo/reset', resetDemoHandler);
  app.use('/api/branches', branchesRouter);
  app.use('/api/svn', svnRouter);
  app.use('/api/merge', mergeRouter);
  app.use('/api/conflicts', conflictsRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/logs', logsRouter);
  app.get('/api/history', (_req, res) => {
    res.json(getOperationHistory());
  });

  // Static production frontend serving when client/dist exists
  const clientDist = path.join(getProjectRoot(), 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Unknown /api routes -> 404 JSON
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Error handler
  app.use(
    (
      err: Error & { statusCode?: number },
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
      res.status(status).json({
        error: err.message || 'Internal server error',
      });
    }
  );

  return app;
}

async function main(): Promise<void> {
  const app = await createApp();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4100);

  app.listen(port, host, () => {
    const settings = getSettings();
    console.log(
      `[SVN Control Center] Server listening at http://${host}:${port} (mode=${settings.mode})`
    );
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[SVN Control Center] Fatal startup error:', err);
    process.exit(1);
  });
}
