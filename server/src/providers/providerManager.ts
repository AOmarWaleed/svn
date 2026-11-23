import type { BranchConfig } from '../../../shared/types';
import {
  addRealBranch,
  getRealBranches,
  getSettings,
  removeRealBranch,
  setRealMasterBranch,
  updateRealBranch,
} from '../config/store';
import { DemoSvnProvider } from './DemoSvnProvider';
import { RealSvnProvider } from './RealSvnProvider';
import type { SvnProvider } from './SvnProvider';

const realProvider = new RealSvnProvider();
const demoProvider = new DemoSvnProvider();

export function getActiveProvider(): SvnProvider {
  return getSettings().mode === 'demo' ? demoProvider : realProvider;
}

export function getDemoProvider(): DemoSvnProvider {
  return demoProvider;
}

export function getActiveBranches(): BranchConfig[] {
  return getSettings().mode === 'demo' ? demoProvider.getBranches() : getRealBranches();
}

export function getActiveBranchById(id: string): BranchConfig {
  const branch = getActiveBranches().find((b) => b.id === id);
  if (!branch) {
    throw Object.assign(new Error(`Branch not found: ${id}`), { statusCode: 404 });
  }
  return branch;
}

export async function addActiveBranch(input: {
  name: string;
  path: string;
  isMaster?: boolean;
  color?: string;
}): Promise<BranchConfig> {
  if (getSettings().mode === 'demo') {
    return demoProvider.addBranch(input);
  }
  return addRealBranch(input);
}

export async function updateActiveBranch(
  id: string,
  patch: Partial<Omit<BranchConfig, 'id'>>
): Promise<BranchConfig> {
  if (getSettings().mode === 'demo') {
    return demoProvider.updateBranchConfig(id, patch);
  }
  return updateRealBranch(id, patch);
}

export async function removeActiveBranch(id: string): Promise<void> {
  if (getSettings().mode === 'demo') {
    demoProvider.removeBranch(id);
    return;
  }
  await removeRealBranch(id);
}

export async function setActiveMasterBranch(id: string): Promise<BranchConfig[]> {
  if (getSettings().mode === 'demo') {
    return demoProvider.setMasterBranch(id);
  }
  return setRealMasterBranch(id);
}
