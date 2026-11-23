import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { LogEntry, ScannedSvnFile } from '../../../shared/types';
import { getSampleRepoRoot } from '../config/store';
import { countConflictMarkers } from '../utils/textDiff';
import { toPosixRel } from '../utils/pathSafety';

const baselineFiles = new Map<string, Buffer>();
let sampleRevision = 7425;
let sampleAuthor = 'Walid';
let sampleDate = '2026-11-23T15:22:36+03:00';

const INITIAL_LOGS: LogEntry[] = [
  {
    revision: 7425,
    author: 'Walid',
    date: '2026-11-23T15:22:36+03:00',
    message: 'Add ZATCA QR helper and progressive VIP discount tiers in billing DEV backend',
    changedPaths: [
      { action: 'M', path: '/BRANCHES/DEV/billing/backend/src/services/claimCalculator.ts' },
      { action: 'A', path: '/BRANCHES/DEV/billing/backend/src/utils/zatcaQrHelper.ts' },
    ],
  },
  {
    revision: 7424,
    author: 'Ahmed',
    date: '2026-11-23T13:10:00+03:00',
    message: 'Add batch approve modal & column updates in DEV billing frontend',
    changedPaths: [
      { action: 'M', path: '/BRANCHES/DEV/billing/frontend/src/components/InvoiceTable.tsx' },
      { action: 'A', path: '/BRANCHES/DEV/billing/frontend/src/components/BatchApproveModal.tsx' },
    ],
  },
  {
    revision: 7422,
    author: 'Sara',
    date: '2026-11-22T17:45:00+03:00',
    message: 'Update HL7 ADT segment mapping in his-integration DEV',
    changedPaths: [
      { action: 'M', path: '/BRANCHES/DEV/his-integration/src/hl7Mapper.ts' },
    ],
  },
  {
    revision: 7421,
    author: 'Walid',
    date: '2026-11-22T14:20:00+03:00',
    message: 'Add Arabic Hijri formatter in DEV shared/common utilities',
    changedPaths: [{ action: 'M', path: '/BRANCHES/DEV/shared/src/dateUtils.ts' }],
  },
  {
    revision: 7419,
    author: 'Omar',
    date: '2026-11-21T16:00:00+03:00',
    message: 'Add NPHIES eligibility retry timeout handling in TEST & DEV',
    changedPaths: [
      { action: 'M', path: '/BRANCHES/TEST/nphies/src/eligibilityClient.ts' },
      { action: 'M', path: '/BRANCHES/DEV/nphies/src/eligibilityClient.ts' },
    ],
  },
  {
    revision: 7418,
    author: 'Walid',
    date: '2026-11-20T11:30:00+03:00',
    message: 'Add index migration for claim status lookup in DEV db',
    changedPaths: [
      { action: 'A', path: '/BRANCHES/DEV/db/migrations/20261123_add_claim_status_idx.sql' },
    ],
  },
];

let sampleLogs: LogEntry[] = INITIAL_LOGS.map((l) => ({
  ...l,
  changedPaths: l.changedPaths.map((p) => ({ ...p })),
}));

function buildSampleFileTree(): Record<string, string> {
  const claimCalcMaster = [
    'export interface ClaimInput {',
    '  amount: number;',
    '  customerTier: "standard" | "vip";',
    '  patientSharePercent: number;',
    '}',
    '',
    'export function calculateClaimNet(input: ClaimInput): number {',
    '  const baseAmount = Math.max(0, input.amount);',
    '  // MASTER: standard flat 5% VIP discount',
    '  const discount = input.customerTier === "vip" ? baseAmount * 0.05 : 0;',
    '  const discounted = baseAmount - discount;',
    '',
    '  const patientShare = discounted * (input.patientSharePercent / 100);',
    '  const taxable = discounted - patientShare;',
    '',
    '  // MASTER: 14% VAT with simple rounding',
    '  const vat = taxable * 0.14;',
    '  return Math.round((taxable + vat) * 100) / 100;',
    '}',
    '',
  ].join('\n');

  const claimCalcDev = [
    'export interface ClaimInput {',
    '  amount: number;',
    '  customerTier: "standard" | "vip";',
    '  patientSharePercent: number;',
    '}',
    '',
    'export function calculateClaimNet(input: ClaimInput): number {',
    '  const baseAmount = Math.max(0, input.amount);',
    '  // DEV: progressive VIP discount (10% above 1000, else 7%)',
    '  const vipRate = baseAmount >= 1000 ? 0.1 : 0.07;',
    '  const discount = input.customerTier === "vip" ? baseAmount * vipRate : 0;',
    '  const discounted = Math.max(0, baseAmount - discount);',
    '',
    '  const patientShare = discounted * (input.patientSharePercent / 100);',
    '  const taxable = discounted - patientShare;',
    '',
    '  // DEV: 15% VAT + fixed 15 SAR processing fee',
    '  const vat = taxable * 0.15;',
    '  const serviceFee = taxable > 0 ? 15 : 0;',
    '  return Number((taxable + vat + serviceFee).toFixed(2));',
    '}',
    '',
  ].join('\n');

  const claimCalcTest = [
    'export interface ClaimInput {',
    '  amount: number;',
    '  customerTier: "standard" | "vip";',
    '  patientSharePercent: number;',
    '}',
    '',
    'export function calculateClaimNet(input: ClaimInput): number {',
    '  const baseAmount = Math.max(0, input.amount);',
    '  // TEST: capped 6% VIP discount during QA cycle',
    '  const discount = input.customerTier === "vip" ? Math.min(250, baseAmount * 0.06) : 0;',
    '  const discounted = baseAmount - discount;',
    '',
    '  const patientShare = discounted * (input.patientSharePercent / 100);',
    '  const taxable = discounted - patientShare;',
    '',
    '  // TEST: 15% VAT without service fee',
    '  const vat = taxable * 0.15;',
    '  return Number((taxable + vat).toFixed(2));',
    '}',
    '',
  ].join('\n');

  const invoiceControllerBase = [
    'export async function getInvoiceById(id: string) {',
    '  return { id, status: "OPEN", total: 420 };',
    '}',
    '',
  ].join('\n');

  const invoiceControllerDev = [
    'export async function getInvoiceById(id: string) {',
    '  return { id, status: "OPEN", total: 420 };',
    '}',
    '',
    'export async function batchApproveInvoices(ids: string[]) {',
    '  return { approvedCount: ids.length, approvedAt: new Date().toISOString() };',
    '}',
    '',
  ].join('\n');

  const invoiceTableBase = [
    'export function InvoiceTable({ rows }: { rows: Array<{ id: string; total: number }> }) {',
    '  return rows.map((r) => `${r.id}: ${r.total}`).join("\\n");',
    '}',
    '',
  ].join('\n');

  const invoiceTableDev = [
    'export function InvoiceTable({ rows }: { rows: Array<{ id: string; total: number; status?: string }> }) {',
    '  return rows.map((r) => `${r.id} [${r.status ?? "NEW"}]: ${r.total} SAR`).join("\\n");',
    '}',
    '',
  ].join('\n');

  const invoiceTableTest = [
    'export function InvoiceTable({ rows }: { rows: Array<{ id: string; total: number }> }) {',
    '  return rows.map((r) => `#${r.id} => ${r.total} SAR`).join("\\n");',
    '}',
    '',
  ].join('\n');

  const files: Record<string, string> = {
    // Root helper folders matching user's `dir`
    'archive/README.txt': 'Archived legacy billing scripts.\n',
    'DevOps/deploy-rcm.ps1': 'Write-Host "Deploying RCM services..."\n',
    'Doc/architecture.md': '# RCM Architecture\n',
    'env/production.env': 'NODE_ENV=production\n',
    'main-backend/src/server.ts': 'export const mainPort = 3000;\n',
    'report/src/dailySummary.ts': 'export const reportVersion = "2.1";\n',
    'templates/invoice.html': '<html><body><h1>Invoice</h1></body></html>\n',

    // 1) Billing Backend (MASTER: billing/rcm-api, DEV/TEST: BRANCHES/*/billing/backend)
    'billing/rcm-api/src/services/claimCalculator.ts': claimCalcMaster,
    'billing/rcm-api/src/controllers/invoiceController.ts': invoiceControllerBase,
    'billing/rcm-api/src/legacy/manualExport.ts': 'export const keepInMaster = true;\n',
    'billing/rcm-api/.env': 'PORT=4001\nDB_HOST=prod-sql.rcm.local\nDB_NAME=RCM_PROD\n',
    'billing/rcm-api/node_modules/fake-pkg/index.js': 'module.exports = {};\n',
    'billing/rcm-api/dist/server.js': '// compiled artifact\n',

    'BRANCHES/DEV/billing/backend/src/services/claimCalculator.ts': claimCalcDev,
    'BRANCHES/DEV/billing/backend/src/controllers/invoiceController.ts': invoiceControllerDev,
    'BRANCHES/DEV/billing/backend/src/utils/zatcaQrHelper.ts':
      'export function buildZatcaQrPayload(vatNo: string, total: number): string {\n  return `${vatNo}|${total.toFixed(2)}`;\n}\n',
    'BRANCHES/DEV/billing/backend/.env': 'PORT=4001\nDB_HOST=dev-sql.rcm.local\nDB_NAME=RCM_DEV\n',
    'BRANCHES/DEV/billing/backend/node_modules/fake-pkg/index.js': 'module.exports = { dev: true };\n',
    'BRANCHES/DEV/billing/backend/dist/server.js': '// dev compiled artifact\n',

    'BRANCHES/TEST/billing/backend/src/services/claimCalculator.ts': claimCalcTest,
    'BRANCHES/TEST/billing/backend/src/controllers/invoiceController.ts': invoiceControllerBase,
    'BRANCHES/TEST/billing/backend/.env': 'PORT=4001\nDB_HOST=test-sql.rcm.local\nDB_NAME=RCM_TEST\n',

    // 2) Billing Frontend (MASTER: billing/rcm-frontend, DEV/TEST: BRANCHES/*/billing/frontend)
    'billing/rcm-frontend/src/components/InvoiceTable.tsx': invoiceTableBase,
    'billing/rcm-frontend/.env': 'VITE_API_URL=https://api.rcm.local\n',

    'BRANCHES/DEV/billing/frontend/src/components/InvoiceTable.tsx': invoiceTableDev,
    'BRANCHES/DEV/billing/frontend/src/components/BatchApproveModal.tsx':
      'export function BatchApproveModal() { return "Approve Selected"; }\n',
    'BRANCHES/DEV/billing/frontend/.env': 'VITE_API_URL=https://dev-api.rcm.local\n',

    'BRANCHES/TEST/billing/frontend/src/components/InvoiceTable.tsx': invoiceTableTest,
    'BRANCHES/TEST/billing/frontend/.env': 'VITE_API_URL=https://test-api.rcm.local\n',

    // 3) HIS-Integration (case & structure differences!)
    'HIS-Integration/src/hl7Mapper.ts':
      'export function mapAdtSegment(pid: string) { return { patientId: pid, version: "2.3" }; }\n',
    'BRANCHES/DEV/his-integration/src/hl7Mapper.ts':
      'export function mapAdtSegment(pid: string, visitNo?: string) { return { patientId: pid, visitNo, version: "2.5" }; }\n',
    'BRANCHES/TEST/his-integration/src/hl7Mapper.ts':
      'export function mapAdtSegment(pid: string) { return { patientId: pid, version: "2.3" }; }\n',

    // 4) common <-> shared
    'common/src/dateUtils.ts': 'export function formatRcmDate(d: Date) { return d.toISOString().slice(0, 10); }\n',
    'BRANCHES/DEV/shared/src/dateUtils.ts':
      'export function formatRcmDate(d: Date, locale: "en" | "ar" = "en") {\n  return locale === "ar" ? d.toLocaleDateString("ar-SA") : d.toISOString().slice(0, 10);\n}\n',
    'BRANCHES/TEST/shared/src/dateUtils.ts':
      'export function formatRcmDate(d: Date) { return d.toISOString().slice(0, 10); }\n',

    // 5) db
    'db/schema.sql': 'CREATE TABLE claims (id INT PRIMARY KEY, status VARCHAR(20));\n',
    'BRANCHES/DEV/db/schema.sql': 'CREATE TABLE claims (id INT PRIMARY KEY, status VARCHAR(20));\n',
    'BRANCHES/DEV/db/migrations/20261123_add_claim_status_idx.sql':
      'CREATE INDEX idx_claims_status ON claims(status);\n',
    'BRANCHES/TEST/db/schema.sql': 'CREATE TABLE claims (id INT PRIMARY KEY, status VARCHAR(20));\n',

    // 6) nphies
    'nphies/src/eligibilityClient.ts': 'export const timeoutMs = 5000;\n',
    'BRANCHES/DEV/nphies/src/eligibilityClient.ts': 'export const timeoutMs = 12000;\nexport const retries = 2;\n',
    'BRANCHES/TEST/nphies/src/eligibilityClient.ts': 'export const timeoutMs = 10000;\n',

    // 7) Remaining RCM modules
    'dashboard/src/index.ts': 'export const dashboardReady = true;\n',
    'BRANCHES/DEV/dashboard/src/index.ts': 'export const dashboardReady = true;\n',
    'BRANCHES/TEST/dashboard/src/index.ts': 'export const dashboardReady = true;\n',

    'heartbeat-monitoring/src/ping.ts': 'export const intervalSec = 30;\n',
    'BRANCHES/DEV/heartbeat-monitoring/src/ping.ts': 'export const intervalSec = 15;\n',
    'BRANCHES/TEST/heartbeat-monitoring/src/ping.ts': 'export const intervalSec = 30;\n',

    'his-rcm-integration/src/sync.ts': 'export const syncEnabled = true;\n',
    'BRANCHES/DEV/his-rcm-integration/src/sync.ts': 'export const syncEnabled = true;\n',
    'BRANCHES/TEST/his-rcm-integration/src/sync.ts': 'export const syncEnabled = true;\n',

    'main-frontend/src/App.tsx': 'export const appTitle = "RCM Portal";\n',
    'BRANCHES/DEV/main-frontend/src/App.tsx': 'export const appTitle = "RCM Portal (DEV)";\n',
    'BRANCHES/TEST/main-frontend/src/App.tsx': 'export const appTitle = "RCM Portal";\n',

    'oasis-integration/src/client.ts': 'export const oasisEndpoint = "https://oasis.local";\n',
    'BRANCHES/DEV/oasis-integration/src/client.ts': 'export const oasisEndpoint = "https://oasis.local";\n',
    'BRANCHES/TEST/oasis-integration/src/client.ts': 'export const oasisEndpoint = "https://oasis.local";\n',
  };

  return files;
}

export async function resetSampleRepo(): Promise<string> {
  const root = getSampleRepoRoot();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(root, { recursive: true });

  baselineFiles.clear();
  sampleRevision = 7425;
  sampleAuthor = 'Walid';
  sampleDate = '2026-11-23T15:22:36+03:00';
  sampleLogs = INITIAL_LOGS.map((l) => ({
    ...l,
    changedPaths: l.changedPaths.map((p) => ({ ...p })),
  }));

  const tree = buildSampleFileTree();
  for (const [rel, content] of Object.entries(tree)) {
    const full = path.join(root, rel.split('/').join(path.sep));
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const buf = Buffer.from(content, 'utf8');
    await fsp.writeFile(full, buf);
    baselineFiles.set(rel, buf);
  }

  return root;
}

export async function ensureSampleRepoInitialized(): Promise<void> {
  const root = getSampleRepoRoot();
  if (!fs.existsSync(root) || baselineFiles.size === 0) {
    await resetSampleRepo();
  }
}

export function getSampleRepoMeta(): {
  url: string;
  revision: number;
  lastChangedAuthor: string;
  lastChangedDate: string;
} {
  return {
    url: 'https://128.1.1.32/svn/rcm (SAMPLE SANDBOX)',
    revision: sampleRevision,
    lastChangedAuthor: sampleAuthor,
    lastChangedDate: sampleDate,
  };
}

async function walkActualFiles(dir: string, rootDir: string, out: string[]): Promise<void> {
  if (!fs.existsSync(dir)) return;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.svn' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkActualFiles(full, rootDir, out);
    } else if (entry.isFile()) {
      out.push(toPosixRel(rootDir, full));
    }
  }
}

/**
 * Compares disk files inside a sample-rcm module folder against baselineFiles
 * to produce live modified/untracked/conflicted/deleted status!
 */
export async function getSampleModuleSvnStatus(moduleRelPath: string): Promise<ScannedSvnFile[]> {
  await ensureSampleRepoInitialized();
  const root = getSampleRepoRoot();
  const normPrefix = moduleRelPath.split('\\').join('/').replace(/^\/+|\/+$/g, '');
  const moduleFull = path.join(root, normPrefix.split('/').join(path.sep));

  const actualFiles: string[] = [];
  await walkActualFiles(moduleFull, moduleFull, actualFiles);

  const results: ScannedSvnFile[] = [];
  const actualSet = new Set(actualFiles);

  for (const rel of actualFiles) {
    const repoKey = `${normPrefix}/${rel}`;
    const fullPath = path.join(moduleFull, rel.split('/').join(path.sep));
    const currentBuf = await fsp.readFile(fullPath);
    const currentText = currentBuf.toString('utf8');
    const hasMarkers = countConflictMarkers(currentText) > 0;
    const baselineBuf = baselineFiles.get(repoKey);

    if (hasMarkers) {
      results.push({ path: rel, status: 'conflicted' });
    } else if (!baselineBuf) {
      results.push({ path: rel, status: 'unversioned' });
    } else if (!baselineBuf.equals(currentBuf)) {
      results.push({ path: rel, status: 'modified' });
    }
  }

  for (const key of baselineFiles.keys()) {
    if (key.startsWith(`${normPrefix}/`)) {
      const subRel = key.slice(normPrefix.length + 1);
      if (subRel.startsWith('node_modules/') || subRel.startsWith('dist/')) continue;
      if (!actualSet.has(subRel)) {
        results.push({ path: subRel, status: 'deleted' });
      }
    }
  }

  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export async function commitSampleModuleFiles(
  moduleRelPath: string,
  relFiles: string[],
  message: string
): Promise<number> {
  await ensureSampleRepoInitialized();
  const root = getSampleRepoRoot();
  const normPrefix = moduleRelPath.split('\\').join('/').replace(/^\/+|\/+$/g, '');
  const moduleFull = path.join(root, normPrefix.split('/').join(path.sep));

  const changedPaths: LogEntry['changedPaths'] = [];

  for (const rel of relFiles) {
    const repoKey = `${normPrefix}/${rel}`;
    const full = path.join(moduleFull, rel.split('/').join(path.sep));
    if (fs.existsSync(full)) {
      const buf = await fsp.readFile(full);
      const existed = baselineFiles.has(repoKey);
      baselineFiles.set(repoKey, buf);
      changedPaths.push({ action: existed ? 'M' : 'A', path: `/${repoKey}` });
    } else if (baselineFiles.has(repoKey)) {
      baselineFiles.delete(repoKey);
      changedPaths.push({ action: 'D', path: `/${repoKey}` });
    }
  }

  sampleRevision += 1;
  sampleAuthor = 'you';
  sampleDate = new Date().toISOString();
  sampleLogs.unshift({
    revision: sampleRevision,
    author: sampleAuthor,
    date: sampleDate,
    message,
    changedPaths,
  });

  return sampleRevision;
}

export async function revertSampleModuleFiles(
  moduleRelPath: string,
  relFiles?: string[]
): Promise<string[]> {
  await ensureSampleRepoInitialized();
  const root = getSampleRepoRoot();
  const normPrefix = moduleRelPath.split('\\').join('/').replace(/^\/+|\/+$/g, '');
  const moduleFull = path.join(root, normPrefix.split('/').join(path.sep));

  const reverted: string[] = [];
  const targetSet = relFiles && relFiles.length > 0 ? new Set(relFiles) : null;

  // Restore baseline files
  for (const [key, buf] of baselineFiles.entries()) {
    if (!key.startsWith(`${normPrefix}/`)) continue;
    const subRel = key.slice(normPrefix.length + 1);
    if (targetSet && !targetSet.has(subRel)) continue;

    const full = path.join(moduleFull, subRel.split('/').join(path.sep));
    const current = fs.existsSync(full) ? await fsp.readFile(full) : null;
    if (!current || !current.equals(buf)) {
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, buf);
      reverted.push(subRel);
    }
  }

  // Note: svn revert keeps unversioned files unless explicitly handled, OR if reverting specific unmerged added files from sync
  return reverted;
}

export function getSampleBaselineBuffer(moduleRelPath: string, relFile: string): Buffer | undefined {
  const normPrefix = moduleRelPath.split('\\').join('/').replace(/^\/+|\/+$/g, '');
  return baselineFiles.get(`${normPrefix}/${relFile}`);
}

export function getSampleLogsForModule(moduleRelPath: string, limit = 30): LogEntry[] {
  const normPrefix = `/${moduleRelPath.split('\\').join('/').replace(/^\/+|\/+$/g, '')}/`;
  const matching = sampleLogs.filter((l) =>
    l.changedPaths.some((p) => p.path.startsWith(normPrefix))
  );
  return (matching.length > 0 ? matching : sampleLogs).slice(0, limit);
}
