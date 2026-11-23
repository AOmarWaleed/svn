import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CommandLogEntry } from '../../../shared/types';

const MAX_LOGS = 500;
const logs: CommandLogEntry[] = [];
const sseClients = new Set<Response>();

export function redactArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--password' && i + 1 < args.length) {
      out.push('--password', '***');
      i++;
    } else if (arg.startsWith('--password=')) {
      out.push('--password=***');
    } else {
      out.push(arg);
    }
  }
  return out;
}

export function formatCommandLine(executable: string, args: string[]): string {
  const safeArgs = redactArgs(args).map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
  const exeName =
    executable.includes('\\') || executable.includes('/') ? `"${executable}"` : executable;
  return `${exeName} ${safeArgs.join(' ')}`.trim();
}

function broadcastLog(entry: CommandLogEntry): void {
  const payload = `event: log\ndata: ${JSON.stringify(entry)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function pushEntry(entry: CommandLogEntry): void {
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  broadcastLog(entry);
}

export function startCommandLog(opts: {
  moduleId?: string;
  moduleName?: string;
  command: string;
}): string {
  const id = randomUUID();
  const entry: CommandLogEntry = {
    id,
    timestamp: new Date().toISOString(),
    moduleId: opts.moduleId,
    moduleName: opts.moduleName,
    command: opts.command,
    status: 'running',
    output: '',
  };
  pushEntry(entry);
  return id;
}

export function appendCommandOutput(id: string, chunk: string): void {
  const entry = logs.find((item) => item.id === id);
  if (!entry) return;
  entry.output += chunk;
  if (entry.output.length > 50_000) {
    entry.output = entry.output.slice(-50_000);
  }
  broadcastLog({ ...entry });
}

export function finishCommandLog(
  id: string,
  status: 'success' | 'error',
  durationMs: number,
  extraOutput?: string
): void {
  const entry = logs.find((item) => item.id === id);
  if (!entry) return;
  if (extraOutput) {
    entry.output = entry.output ? `${entry.output}\n${extraOutput}` : extraOutput;
  }
  entry.status = status;
  entry.durationMs = durationMs;
  broadcastLog({ ...entry });
}

export function recordInstantCommandLog(opts: {
  moduleId?: string;
  moduleName?: string;
  command: string;
  status: 'success' | 'error';
  output: string;
  durationMs: number;
}): CommandLogEntry {
  const entry: CommandLogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    moduleId: opts.moduleId,
    moduleName: opts.moduleName,
    command: opts.command,
    status: opts.status,
    output: opts.output,
    durationMs: opts.durationMs,
  };
  pushEntry(entry);
  return entry;
}

export function getCommandLogs(): CommandLogEntry[] {
  return [...logs];
}

export function clearCommandLogs(): void {
  logs.length = 0;
  const payload = `event: clear\ndata: {}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

export function subscribeCommandLogsSse(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`event: snapshot\ndata: ${JSON.stringify(logs.slice(-100))}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}
