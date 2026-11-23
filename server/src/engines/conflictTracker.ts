import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ActiveConflictItem } from '../../../shared/types';
import { computeUnifiedDiff, countConflictMarkers, isBinaryBuffer } from '../utils/textDiff';

export interface TrackedSyncConflict {
  id: string;
  moduleId: string;
  moduleName: string;
  targetEnvId: string;
  sourceEnvId: string;
  relPath: string;
  targetFullPath: string;
  sourceFullPath: string;
  kind: 'sync-markers' | 'sync-diff';
  preMergeTargetContent?: Buffer;
  description?: string;
}

export interface RollbackFileSnapshot {
  fullPath: string;
  existedBefore: boolean;
  previousContent?: Buffer;
}

interface RollbackRecord {
  id: string;
  createdAt: string;
  snapshots: RollbackFileSnapshot[];
  conflictIds: string[];
}

const trackedConflicts = new Map<string, TrackedSyncConflict>();
const rollbackRecords = new Map<string, RollbackRecord>();

function makeConflictKey(targetEnvId: string, moduleId: string, relPath: string): string {
  return `${targetEnvId}::${moduleId}::${relPath}`;
}

export function registerSyncConflict(
  input: Omit<TrackedSyncConflict, 'id'>
): TrackedSyncConflict {
  const key = makeConflictKey(input.targetEnvId, input.moduleId, input.relPath);
  const existing = trackedConflicts.get(key);
  const entry: TrackedSyncConflict = {
    ...input,
    id: existing?.id ?? `sync-${randomUUID().slice(0, 8)}`,
  };
  trackedConflicts.set(key, entry);
  return entry;
}

export function findTrackedConflictById(id: string): TrackedSyncConflict | undefined {
  for (const item of trackedConflicts.values()) {
    if (item.id === id) return item;
  }
  return undefined;
}

export function removeTrackedConflictById(id: string): void {
  for (const [key, item] of trackedConflicts.entries()) {
    if (item.id === id) {
      trackedConflicts.delete(key);
      return;
    }
  }
}

export function clearTrackedConflictsForModule(targetEnvId: string, moduleId: string): void {
  for (const [key, item] of trackedConflicts.entries()) {
    if (item.targetEnvId === targetEnvId && item.moduleId === moduleId) {
      trackedConflicts.delete(key);
    }
  }
}

export function clearAllTrackedConflicts(): void {
  trackedConflicts.clear();
  rollbackRecords.clear();
}

export async function getLiveSyncConflicts(): Promise<ActiveConflictItem[]> {
  const items: ActiveConflictItem[] = [];

  for (const [key, entry] of trackedConflicts.entries()) {
    if (!fs.existsSync(entry.targetFullPath)) {
      trackedConflicts.delete(key);
      continue;
    }

    let markerCount = 0;
    let previewDiff = '';
    try {
      const targetBuf = await fsp.readFile(entry.targetFullPath);
      if (!isBinaryBuffer(targetBuf)) {
        const targetText = targetBuf.toString('utf8');
        markerCount = countConflictMarkers(targetText);
        if (fs.existsSync(entry.sourceFullPath)) {
          const sourceBuf = await fsp.readFile(entry.sourceFullPath);
          if (!isBinaryBuffer(sourceBuf)) {
            previewDiff = computeUnifiedDiff(
              targetText,
              sourceBuf.toString('utf8'),
              entry.relPath,
              entry.targetEnvId.toUpperCase(),
              entry.sourceEnvId.toUpperCase()
            );
          }
        }
      }
    } catch {
      // ignore read glitch
    }

    items.push({
      id: entry.id,
      moduleId: entry.moduleId,
      moduleName: entry.moduleName,
      targetEnvId: entry.targetEnvId,
      sourceEnvId: entry.sourceEnvId,
      relPath: entry.relPath,
      targetFullPath: entry.targetFullPath,
      sourceFullPath: entry.sourceFullPath,
      kind: entry.kind,
      markerCount,
      readyToResolve: entry.kind === 'sync-diff' ? true : markerCount === 0,
      description: entry.description,
      previewDiff,
    });
  }

  return items;
}

export function saveRollbackSnapshot(
  snapshots: RollbackFileSnapshot[],
  conflictIds: string[]
): string {
  const id = `rb-${randomUUID().slice(0, 8)}`;
  rollbackRecords.set(id, {
    id,
    createdAt: new Date().toISOString(),
    snapshots,
    conflictIds,
  });

  // Keep only last 20 rollback snapshots in memory
  if (rollbackRecords.size > 20) {
    const oldestKey = rollbackRecords.keys().next().value;
    if (oldestKey) rollbackRecords.delete(oldestKey);
  }

  return id;
}

export async function executeRollbackSnapshot(rollbackId: string): Promise<number> {
  const record = rollbackRecords.get(rollbackId);
  if (!record) {
    throw Object.assign(new Error(`Rollback snapshot not found or expired: ${rollbackId}`), {
      statusCode: 404,
    });
  }

  let restored = 0;
  for (const snap of record.snapshots) {
    if (snap.existedBefore && snap.previousContent !== undefined) {
      await fsp.mkdir(path.dirname(snap.fullPath), { recursive: true });
      await fsp.writeFile(snap.fullPath, snap.previousContent);
      restored++;
    } else if (!snap.existedBefore && fs.existsSync(snap.fullPath)) {
      await fsp.unlink(snap.fullPath);
      restored++;
    }
  }

  for (const cid of record.conflictIds) {
    removeTrackedConflictById(cid);
  }
  rollbackRecords.delete(rollbackId);
  return restored;
}
