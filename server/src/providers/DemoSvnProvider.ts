import { randomUUID } from 'node:crypto';
import type {
  BranchConfig,
  BranchCounts,
  BranchStatus,
  ConflictFileDetail,
  ConflictQuickStrategy,
  LogEntry,
  MergeExecuteResult,
  MergeFileImpact,
  MergeImpactSummary,
  MergeMode,
  MergePreviewResult,
  PreflightResult,
  WorkingCopyFile,
} from '../../../shared/types';
import { recordInstantCommandLog } from '../utils/commandLogger';
import { applyHunkChoices, countConflictMarkers, parseConflictMarkers } from '../utils/conflictParser';
import { parseMergeOutput } from '../utils/svnParsers';
import type { SvnProvider } from './SvnProvider';

interface DemoBranchState {
  config: BranchConfig;
  url: string;
  relativeUrl: string;
  revision: number;
  lastChangedRev: number;
  lastChangedAuthor: string;
  lastChangedDate: string;
  files: WorkingCopyFile[];
  logs: LogEntry[];
  diffs: Record<string, string>;
  conflictContents: Record<string, string>;
  treeConflictDescriptions: Record<string, string>;
  resolvedFilesContent: Record<string, string>;
}

interface DemoMergeRule {
  revision: number;
  impacts: MergeFileImpact[];
  diffs: Record<string, string>;
  conflictContents: Record<string, string>;
  treeConflictDescriptions: Record<string, string>;
}

const REPO_ROOT = 'https://svn.company.local/repos/erp-suite';

const INVOICE_CONFLICT_TEXT = [
  'export interface InvoiceInput {',
  '  subtotal: number;',
  '  customerTier: "standard" | "vip";',
  '  taxRate: number;',
  '}',
  '',
  'export function calculateInvoiceTotal(input: InvoiceInput): number {',
  '<<<<<<< .working',
  '  // Master branch: flat loyalty discount 5% for VIP',
  '  const discount = input.customerTier === "vip" ? input.subtotal * 0.05 : 0;',
  '  const afterDiscount = input.subtotal - discount;',
  '=======',
  '  // Billing v2: tiered progressive VIP discount (10% above 1000 EGP)',
  '  const vipRate = input.subtotal >= 1000 ? 0.1 : 0.07;',
  '  const discount = input.customerTier === "vip" ? input.subtotal * vipRate : 0;',
  '  const afterDiscount = Math.max(0, input.subtotal - discount);',
  '>>>>>>> .merge-right.r145',
  '',
  '  const taxAmount = afterDiscount * input.taxRate;',
  '<<<<<<< .working',
  '  return Math.round((afterDiscount + taxAmount) * 100) / 100;',
  '=======',
  '  const serviceFee = afterDiscount > 0 ? 15 : 0;',
  '  return Number((afterDiscount + taxAmount + serviceFee).toFixed(2));',
  '>>>>>>> .merge-right.r145',
  '}',
].join('\n');

const TAX_RULES_CONFLICT_TEXT = [
  'export const TAX_RULES = {',
  '  currency: "EGP",',
  '<<<<<<< .working',
  '  vatRate: 0.13,',
  '  includeMedicalExemption: false,',
  '=======',
  '  vatRate: 0.14,',
  '  includeMedicalExemption: true,',
  '>>>>>>> .merge-right.r144',
  '  roundingPrecision: 2,',
  '};',
].join('\n');

const BILLING_RULES: DemoMergeRule[] = [
  {
    revision: 143,
    impacts: [
      {
        path: 'src/routes/patients.ts',
        fileAction: 'U',
        propAction: '',
        treeConflict: false,
        isConflict: false,
        rawLine: 'U    src/routes/patients.ts',
      },
      {
        path: 'src/services/invoiceCalculator.ts',
        fileAction: 'C',
        propAction: '',
        treeConflict: false,
        isConflict: true,
        rawLine: 'C    src/services/invoiceCalculator.ts',
      },
    ],
    diffs: {
      'src/routes/patients.ts': [
        'Index: src/routes/patients.ts',
        '===================================================================',
        '--- src/routes/patients.ts\t(revision 142)',
        '+++ src/routes/patients.ts\t(revision 143)',
        '@@ -14,6 +14,9 @@',
        '   const patient = await findPatientById(req.params.id);',
        '+  if (patient?.tier === "vip") {',
        '+    res.setHeader("X-Billing-Tier", "VIP");',
        '+  }',
        '   return res.json(patient);',
      ].join('\n'),
      'src/services/invoiceCalculator.ts': [
        'Index: src/services/invoiceCalculator.ts',
        '===================================================================',
        '--- src/services/invoiceCalculator.ts\t(revision 142)',
        '+++ src/services/invoiceCalculator.ts\t(revision 143)',
        '@@ -6,10 +6,13 @@',
        ' export function calculateInvoiceTotal(input: InvoiceInput): number {',
        '-  const discount = input.customerTier === "vip" ? input.subtotal * 0.05 : 0;',
        '-  const afterDiscount = input.subtotal - discount;',
        '+  const vipRate = input.subtotal >= 1000 ? 0.1 : 0.07;',
        '+  const discount = input.customerTier === "vip" ? input.subtotal * vipRate : 0;',
        '+  const afterDiscount = Math.max(0, input.subtotal - discount);',
        '   const taxAmount = afterDiscount * input.taxRate;',
        '-  return Math.round((afterDiscount + taxAmount) * 100) / 100;',
        '+  const serviceFee = afterDiscount > 0 ? 15 : 0;',
        '+  return Number((afterDiscount + taxAmount + serviceFee).toFixed(2));',
        ' }',
      ].join('\n'),
    },
    conflictContents: {
      'src/services/invoiceCalculator.ts': INVOICE_CONFLICT_TEXT,
    },
    treeConflictDescriptions: {},
  },
  {
    revision: 144,
    impacts: [
      {
        path: 'src/config/taxRules.ts',
        fileAction: 'C',
        propAction: '',
        treeConflict: false,
        isConflict: true,
        rawLine: 'C    src/config/taxRules.ts',
      },
    ],
    diffs: {
      'src/config/taxRules.ts': [
        'Index: src/config/taxRules.ts',
        '===================================================================',
        '--- src/config/taxRules.ts\t(revision 142)',
        '+++ src/config/taxRules.ts\t(revision 144)',
        '@@ -1,5 +1,5 @@',
        ' export const TAX_RULES = {',
        '   currency: "EGP",',
        '-  vatRate: 0.13,',
        '-  includeMedicalExemption: false,',
        '+  vatRate: 0.14,',
        '+  includeMedicalExemption: true,',
        '   roundingPrecision: 2,',
        ' };',
      ].join('\n'),
    },
    conflictContents: {
      'src/config/taxRules.ts': TAX_RULES_CONFLICT_TEXT,
    },
    treeConflictDescriptions: {},
  },
  {
    revision: 145,
    impacts: [
      {
        path: 'src/utils/pdfExporter.ts',
        fileAction: 'A',
        propAction: '',
        treeConflict: false,
        isConflict: false,
        rawLine: 'A    src/utils/pdfExporter.ts',
      },
      {
        path: 'src/legacy/oldReport.ts',
        fileAction: ' ',
        propAction: '',
        treeConflict: true,
        isConflict: true,
        rawLine: '   C src/legacy/oldReport.ts',
      },
    ],
    diffs: {
      'src/utils/pdfExporter.ts': [
        'Index: src/utils/pdfExporter.ts',
        '===================================================================',
        '--- /dev/null\t(nonexistent)',
        '+++ src/utils/pdfExporter.ts\t(revision 145)',
        '@@ -0,0 +1,8 @@',
        '+export interface PdfOptions { title: string; rtl?: boolean; }',
        '+export async function exportInvoicePdf(invoiceId: string, opts: PdfOptions) {',
        '+  return {',
        '+    fileName: `invoice-${invoiceId}.pdf`,',
        '+    title: opts.title,',
        '+    rtl: Boolean(opts.rtl),',
        '+  };',
        '+}',
      ].join('\n'),
      'src/legacy/oldReport.ts': [
        'Index: src/legacy/oldReport.ts',
        '===================================================================',
        '--- src/legacy/oldReport.ts\t(revision 142)',
        '+++ /dev/null\t(deleted in r145)',
        '@@ -1,4 +0,0 @@',
        '-export function generateLegacyCsv() {',
        '-  return "legacy-report-v1";',
        '-}',
      ].join('\n'),
    },
    conflictContents: {},
    treeConflictDescriptions: {
      'src/legacy/oldReport.ts':
        'Tree conflict during merge: incoming file delete upon merge, local file edit/keep upon merge (deleted in feature/billing-v2 r145 while still referenced in master).',
    },
  },
];

const PORTAL_RULES: DemoMergeRule[] = [
  {
    revision: 146,
    impacts: [
      {
        path: 'src/routes/appointments.ts',
        fileAction: 'U',
        propAction: '',
        treeConflict: false,
        isConflict: false,
        rawLine: 'U    src/routes/appointments.ts',
      },
    ],
    diffs: {
      'src/routes/appointments.ts': [
        'Index: src/routes/appointments.ts',
        '===================================================================',
        '--- src/routes/appointments.ts\t(revision 142)',
        '+++ src/routes/appointments.ts\t(revision 146)',
        '@@ -22,4 +22,8 @@',
        ' export function getAvailableSlots(doctorId: string, date: string) {',
        '+  if (!doctorId) throw new Error("doctorId required");',
        '+  return fetchSlotsFromSchedule(doctorId, date, { bufferMinutes: 15 });',
        ' }',
      ].join('\n'),
    },
    conflictContents: {},
    treeConflictDescriptions: {},
  },
  {
    revision: 147,
    impacts: [
      {
        path: 'src/templates/smsArabic.ts',
        fileAction: 'A',
        propAction: '',
        treeConflict: false,
        isConflict: false,
        rawLine: 'A    src/templates/smsArabic.ts',
      },
    ],
    diffs: {
      'src/templates/smsArabic.ts': [
        'Index: src/templates/smsArabic.ts',
        '===================================================================',
        '--- /dev/null\t(nonexistent)',
        '+++ src/templates/smsArabic.ts\t(revision 147)',
        '@@ -0,0 +1,4 @@',
        '+export function appointmentReminderAr(patientName: string, time: string): string {',
        '+  return `أهلاً ${patientName}، موعدك القادم الساعة ${time}`;',
        '+}',
      ].join('\n'),
    },
    conflictContents: {},
    treeConflictDescriptions: {},
  },
];

const HOTFIX_RULES: DemoMergeRule[] = [
  {
    revision: 148,
    impacts: [
      {
        path: 'src/middleware/jwtAuth.ts',
        fileAction: 'G',
        propAction: '',
        treeConflict: false,
        isConflict: false,
        rawLine: 'G    src/middleware/jwtAuth.ts',
      },
    ],
    diffs: {
      'src/middleware/jwtAuth.ts': [
        'Index: src/middleware/jwtAuth.ts',
        '===================================================================',
        '--- src/middleware/jwtAuth.ts\t(revision 142)',
        '+++ src/middleware/jwtAuth.ts\t(revision 148)',
        '@@ -8,5 +8,6 @@',
        ' export function verifyJwt(token: string) {',
        '-  return decodeToken(token);',
        '+  return decodeToken(token, { clockToleranceSec: 30 });',
        ' }',
      ].join('\n'),
    },
    conflictContents: {},
    treeConflictDescriptions: {},
  },
];

function computeCounts(files: WorkingCopyFile[]): { counts: BranchCounts; isClean: boolean } {
  const counts: BranchCounts = {
    modified: 0,
    added: 0,
    deleted: 0,
    unversioned: 0,
    conflicted: 0,
    treeConflicts: 0,
    incoming: 0,
  };

  for (const f of files) {
    if (f.status === 'modified' || f.status === 'replaced') counts.modified++;
    else if (f.status === 'added') counts.added++;
    else if (f.status === 'deleted' || f.status === 'missing') counts.deleted++;
    else if (f.status === 'unversioned') counts.unversioned++;
    else if (f.status === 'conflicted') counts.conflicted++;

    if (f.treeConflict) counts.treeConflicts++;
    if (f.remoteModified) counts.incoming++;
  }

  const isClean =
    counts.modified === 0 &&
    counts.added === 0 &&
    counts.deleted === 0 &&
    counts.unversioned === 0 &&
    counts.conflicted === 0 &&
    counts.treeConflicts === 0;

  return { counts, isClean };
}

function summarizeImpacts(impacts: MergeFileImpact[]): MergeImpactSummary {
  const summary: MergeImpactSummary = {
    total: impacts.length,
    updated: 0,
    added: 0,
    deleted: 0,
    merged: 0,
    textConflicts: 0,
    treeConflicts: 0,
  };

  for (const impact of impacts) {
    if (impact.treeConflict) summary.treeConflicts++;
    if (impact.fileAction === 'C' || impact.propAction === 'C') summary.textConflicts++;

    if (impact.fileAction === 'U') summary.updated++;
    else if (impact.fileAction === 'A' || impact.fileAction === 'R') summary.added++;
    else if (impact.fileAction === 'D') summary.deleted++;
    else if (impact.fileAction === 'G') summary.merged++;
  }

  return summary;
}

export class DemoSvnProvider implements SvnProvider {
  private branches = new Map<string, DemoBranchState>();
  private nextRevision = 150;
  private mergedPairRevs = new Map<string, Set<number>>();

  constructor() {
    this.resetDemo();
  }

  resetDemo(): void {
    this.branches.clear();
    this.mergedPairRevs.clear();
    this.nextRevision = 151;

    const initial: DemoBranchState[] = [
      {
        config: {
          id: 'demo-master',
          name: 'master (trunk)',
          path: 'D:\\CompanySVN\\erp-master',
          isMaster: true,
          color: '#10b981',
        },
        url: `${REPO_ROOT}/trunk`,
        relativeUrl: '^/trunk',
        revision: 142,
        lastChangedRev: 142,
        lastChangedAuthor: 'ahmed.hassan',
        lastChangedDate: '2026-11-22T15:30:00Z',
        files: [],
        logs: [
          {
            revision: 142,
            author: 'ahmed.hassan',
            date: '2026-11-22T15:30:00Z',
            message: 'Release baseline v2.4.0 to trunk before billing sprint merge',
            changedPaths: [
              { action: 'M', path: '/trunk/package.json' },
              { action: 'M', path: '/trunk/src/services/invoiceCalculator.ts' },
            ],
          },
          {
            revision: 139,
            author: 'sara.ali',
            date: '2026-11-20T11:15:00Z',
            message: 'Add VIP customer tier validation on patient lookup',
            changedPaths: [{ action: 'M', path: '/trunk/src/routes/patients.ts' }],
          },
        ],
        diffs: {},
        conflictContents: {},
        treeConflictDescriptions: {},
        resolvedFilesContent: {},
      },
      {
        config: {
          id: 'demo-billing',
          name: 'feature/billing-v2',
          path: 'D:\\CompanySVN\\erp-billing-v2',
          isMaster: false,
          color: '#6366f1',
        },
        url: `${REPO_ROOT}/branches/feature/billing-v2`,
        relativeUrl: '^/branches/feature/billing-v2',
        revision: 145,
        lastChangedRev: 145,
        lastChangedAuthor: 'karim.nabil',
        lastChangedDate: '2026-11-23T09:10:00Z',
        files: [],
        logs: [
          {
            revision: 145,
            author: 'karim.nabil',
            date: '2026-11-23T09:10:00Z',
            message: 'Add invoice PDF exporter and remove obsolete legacy report',
            changedPaths: [
              { action: 'A', path: '/branches/feature/billing-v2/src/utils/pdfExporter.ts' },
              { action: 'D', path: '/branches/feature/billing-v2/src/legacy/oldReport.ts' },
            ],
          },
          {
            revision: 144,
            author: 'karim.nabil',
            date: '2026-11-22T18:20:00Z',
            message: 'Update VAT rate to 14% and enable medical exemption flag',
            changedPaths: [{ action: 'M', path: '/branches/feature/billing-v2/src/config/taxRules.ts' }],
          },
          {
            revision: 143,
            author: 'mona.adel',
            date: '2026-11-22T16:45:00Z',
            message: 'Implement progressive VIP discount tiers and service fee',
            changedPaths: [
              { action: 'M', path: '/branches/feature/billing-v2/src/services/invoiceCalculator.ts' },
              { action: 'M', path: '/branches/feature/billing-v2/src/routes/patients.ts' },
            ],
          },
        ],
        diffs: {},
        conflictContents: {},
        treeConflictDescriptions: {},
        resolvedFilesContent: {},
      },
      {
        config: {
          id: 'demo-portal',
          name: 'feature/patient-portal',
          path: 'D:\\CompanySVN\\erp-patient-portal',
          isMaster: false,
          color: '#06b6d4',
        },
        url: `${REPO_ROOT}/branches/feature/patient-portal`,
        relativeUrl: '^/branches/feature/patient-portal',
        revision: 147,
        lastChangedRev: 147,
        lastChangedAuthor: 'sara.ali',
        lastChangedDate: '2026-11-23T10:05:00Z',
        files: [],
        logs: [
          {
            revision: 147,
            author: 'sara.ali',
            date: '2026-11-23T10:05:00Z',
            message: 'Add Arabic appointment reminder SMS template',
            changedPaths: [
              { action: 'A', path: '/branches/feature/patient-portal/src/templates/smsArabic.ts' },
            ],
          },
          {
            revision: 146,
            author: 'sara.ali',
            date: '2026-11-22T14:00:00Z',
            message: 'Add 15-minute slot buffer for doctor appointments',
            changedPaths: [
              { action: 'M', path: '/branches/feature/patient-portal/src/routes/appointments.ts' },
            ],
          },
        ],
        diffs: {},
        conflictContents: {},
        treeConflictDescriptions: {},
        resolvedFilesContent: {},
      },
      {
        config: {
          id: 'demo-hotfix',
          name: 'hotfix/auth-token',
          path: 'D:\\CompanySVN\\erp-hotfix-auth',
          isMaster: false,
          color: '#f59e0b',
        },
        url: `${REPO_ROOT}/branches/hotfix/auth-token`,
        relativeUrl: '^/branches/hotfix/auth-token',
        revision: 148,
        lastChangedRev: 148,
        lastChangedAuthor: 'omar.tarek',
        lastChangedDate: '2026-11-23T08:40:00Z',
        files: [
          { path: 'src/middleware/jwtAuth.ts', status: 'modified' },
          { path: 'src/services/sessionStore.ts', status: 'normal', remoteModified: true },
          { path: 'src/config/security.ts', status: 'normal', remoteModified: true },
        ],
        logs: [
          {
            revision: 148,
            author: 'omar.tarek',
            date: '2026-11-23T08:40:00Z',
            message: 'Harden JWT refresh token validation window',
            changedPaths: [
              { action: 'M', path: '/branches/hotfix/auth-token/src/middleware/jwtAuth.ts' },
            ],
          },
        ],
        diffs: {
          'src/middleware/jwtAuth.ts': [
            'Index: src/middleware/jwtAuth.ts',
            '===================================================================',
            '--- src/middleware/jwtAuth.ts\t(revision 148)',
            '+++ src/middleware/jwtAuth.ts\t(working copy)',
            '@@ -8,5 +8,7 @@',
            ' export function verifyJwt(token: string) {',
            '-  return decodeToken(token);',
            '+  if (!token) throw new Error("Missing token");',
            '+  return decodeToken(token, { clockToleranceSec: 30 });',
            ' }',
          ].join('\n'),
        },
        conflictContents: {},
        treeConflictDescriptions: {},
        resolvedFilesContent: {},
      },
    ];

    for (const item of initial) {
      this.branches.set(item.config.id, item);
    }
  }

  getBranches(): BranchConfig[] {
    return Array.from(this.branches.values()).map((b) => ({ ...b.config }));
  }

  addBranch(input: { name: string; path: string; isMaster?: boolean; color?: string }): BranchConfig {
    const id = `demo-${randomUUID().slice(0, 8)}`;
    const isMaster = Boolean(input.isMaster) || this.branches.size === 0;
    if (isMaster) {
      for (const b of this.branches.values()) b.config.isMaster = false;
    }
    const rev = this.nextRevision++;
    const config: BranchConfig = {
      id,
      name: input.name.trim(),
      path: input.path.trim(),
      isMaster,
      color: input.color ?? '#8b5cf6',
    };
    this.branches.set(id, {
      config,
      url: `${REPO_ROOT}/branches/${config.name.replace(/\s+/g, '-')}`,
      relativeUrl: `^/branches/${config.name.replace(/\s+/g, '-')}`,
      revision: rev,
      lastChangedRev: rev,
      lastChangedAuthor: 'demo.user',
      lastChangedDate: new Date().toISOString(),
      files: [],
      logs: [
        {
          revision: rev,
          author: 'demo.user',
          date: new Date().toISOString(),
          message: `Create working copy branch ${config.name}`,
          changedPaths: [{ action: 'A', path: `/branches/${config.name}` }],
        },
      ],
      diffs: {},
      conflictContents: {},
      treeConflictDescriptions: {},
      resolvedFilesContent: {},
    });
    return { ...config };
  }

  updateBranchConfig(id: string, patch: Partial<Omit<BranchConfig, 'id'>>): BranchConfig {
    const state = this.branches.get(id);
    if (!state) {
      throw Object.assign(new Error(`Demo branch not found: ${id}`), { statusCode: 404 });
    }
    if (patch.isMaster) {
      for (const b of this.branches.values()) {
        b.config.isMaster = b.config.id === id;
      }
    }
    state.config = {
      ...state.config,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.path !== undefined ? { path: patch.path.trim() } : {}),
      ...(patch.isMaster !== undefined ? { isMaster: patch.isMaster } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
    };
    return { ...state.config };
  }

  removeBranch(id: string): void {
    const state = this.branches.get(id);
    if (!state) {
      throw Object.assign(new Error(`Demo branch not found: ${id}`), { statusCode: 404 });
    }
    const wasMaster = state.config.isMaster;
    this.branches.delete(id);
    if (wasMaster) {
      const first = this.branches.values().next().value;
      if (first) first.config.isMaster = true;
    }
  }

  setMasterBranch(id: string): BranchConfig[] {
    if (!this.branches.has(id)) {
      throw Object.assign(new Error(`Demo branch not found: ${id}`), { statusCode: 404 });
    }
    for (const b of this.branches.values()) {
      b.config.isMaster = b.config.id === id;
    }
    return this.getBranches();
  }

  private getState(branch: BranchConfig): DemoBranchState {
    const state = this.branches.get(branch.id);
    if (!state) {
      throw Object.assign(new Error(`Demo branch not found: ${branch.name}`), { statusCode: 404 });
    }
    return state;
  }

  async getBranchStatus(branch: BranchConfig, _checkRemote = false): Promise<BranchStatus> {
    const state = this.getState(branch);
    const { counts, isClean } = computeCounts(state.files);
    return {
      branchId: state.config.id,
      name: state.config.name,
      path: state.config.path,
      isMaster: state.config.isMaster,
      color: state.config.color,
      url: state.url,
      relativeUrl: state.relativeUrl,
      repositoryRoot: REPO_ROOT,
      revision: state.revision,
      lastChangedRev: state.lastChangedRev,
      lastChangedAuthor: state.lastChangedAuthor,
      lastChangedDate: state.lastChangedDate,
      counts,
      files: state.files.map((f) => ({ ...f })),
      isClean,
    };
  }

  async updateBranch(branch: BranchConfig): Promise<{ output: string; newRevision: number }> {
    const state = this.getState(branch);
    const incomingFiles = state.files.filter((f) => f.remoteModified);
    state.files = state.files
      .filter((f) => !(f.status === 'normal' && f.remoteModified))
      .map((f) => ({ ...f, remoteModified: false }));

    if (incomingFiles.length > 0) {
      state.revision = Math.max(state.revision + 1, 150);
    }

    const lines = [
      `Updating '${state.config.path}':`,
      ...incomingFiles.map((f) => `U    ${f.path}`),
      `Updated to revision ${state.revision}.`,
    ];
    const output = lines.join('\n');

    recordInstantCommandLog({
      branchId: state.config.id,
      branchName: state.config.name,
      command: `svn update --accept postpone "${state.config.path}"`,
      status: 'success',
      output,
      durationMs: 180,
    });

    return { output, newRevision: state.revision };
  }

  async commitBranch(
    branch: BranchConfig,
    files: string[],
    message: string
  ): Promise<{ output: string; newRevision?: number }> {
    const state = this.getState(branch);
    if (!message.trim()) {
      throw Object.assign(new Error('Commit message is required.'), { statusCode: 400 });
    }
    if (!files.length) {
      throw Object.assign(new Error('Select at least one file to commit.'), { statusCode: 400 });
    }

    const hasConflict = state.files.some(
      (f) => files.includes(f.path) && (f.status === 'conflicted' || f.treeConflict)
    );
    if (hasConflict) {
      throw Object.assign(
        new Error('Aborting commit: selected files still have unresolved conflicts.'),
        { statusCode: 409 }
      );
    }

    const newRev = this.nextRevision++;
    const fileSet = new Set(files);
    const committedPaths = state.files
      .filter((f) => fileSet.has(f.path))
      .map((f) => ({
        action: f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M',
        path: `${state.relativeUrl.replace('^', '')}/${f.path}`,
      }));

    state.files = state.files.filter((f) => !fileSet.has(f.path));
    for (const f of files) {
      delete state.diffs[f];
      delete state.conflictContents[f];
      delete state.treeConflictDescriptions[f];
    }

    state.revision = newRev;
    state.lastChangedRev = newRev;
    state.lastChangedAuthor = 'you (company-dev)';
    state.lastChangedDate = new Date().toISOString();
    state.logs.unshift({
      revision: newRev,
      author: 'you (company-dev)',
      date: state.lastChangedDate,
      message: message.trim(),
      changedPaths: committedPaths,
    });

    // If committing a merge into target, mark merged revisions from any source pointing to target
    for (const [pairKey, revs] of this.mergedPairRevs.entries()) {
      if (pairKey.endsWith(`->${branch.id}`) && revs.size > 0) {
        // Already tracked
      }
    }

    const output = [
      ...files.map((f) => `Sending        ${f}`),
      `Transmitting file data ${'.'.repeat(Math.min(files.length, 6))}done`,
      `Committing transaction...`,
      `Committed revision ${newRev}.`,
    ].join('\n');

    recordInstantCommandLog({
      branchId: state.config.id,
      branchName: state.config.name,
      command: `svn commit -m "${message.trim()}" ${files.join(' ')}`,
      status: 'success',
      output,
      durationMs: 240,
    });

    return { output, newRevision: newRev };
  }

  async getDiff(branch: BranchConfig, filePath?: string, revision?: number): Promise<string> {
    const state = this.getState(branch);

    if (revision !== undefined) {
      const rules = [...BILLING_RULES, ...PORTAL_RULES, ...HOTFIX_RULES];
      const rule = rules.find((r) => r.revision === revision);
      if (rule) {
        if (filePath && rule.diffs[filePath]) return rule.diffs[filePath];
        return Object.values(rule.diffs).join('\n\n');
      }
      const log = state.logs.find((l) => l.revision === revision);
      if (log) {
        return [
          `Index: r${revision} (${log.message})`,
          '===================================================================',
          `--- revision ${revision - 1}`,
          `+++ revision ${revision}`,
          ...log.changedPaths.map((p) => `+ [${p.action}] ${p.path}`),
        ].join('\n');
      }
      return '';
    }

    if (filePath) {
      const existingDiff = state.diffs[filePath];
      if (existingDiff) return existingDiff;
      if (state.conflictContents[filePath]) {
        return state.conflictContents[filePath]
          .split('\n')
          .map((l) => ` ${l}`)
          .join('\n');
      }
      return '';
    }

    return Object.values(state.diffs).join('\n\n');
  }

  async getLog(branch: BranchConfig, limit = 30): Promise<LogEntry[]> {
    const state = this.getState(branch);
    return state.logs.slice(0, limit);
  }

  async revert(branch: BranchConfig, files?: string[]): Promise<{ output: string }> {
    const state = this.getState(branch);
    const targetFiles = files && files.length > 0 ? files : state.files.map((f) => f.path);
    const fileSet = new Set(targetFiles);

    const revertedNames: string[] = [];
    state.files = state.files.filter((f) => {
      if (fileSet.has(f.path) && f.status !== 'normal') {
        revertedNames.push(f.path);
        delete state.diffs[f.path];
        delete state.conflictContents[f.path];
        delete state.treeConflictDescriptions[f.path];
        delete state.resolvedFilesContent[f.path];
        return Boolean(f.remoteModified);
      }
      return true;
    });

    // Clear un-committed merged rev tracking if full revert
    if (!files || files.length === 0) {
      for (const pairKey of Array.from(this.mergedPairRevs.keys())) {
        if (pairKey.endsWith(`->${branch.id}`)) {
          this.mergedPairRevs.delete(pairKey);
        }
      }
    }

    const output =
      revertedNames.length > 0
        ? revertedNames.map((p) => `Reverted '${p}'`).join('\n')
        : 'Working copy is already clean.';

    recordInstantCommandLog({
      branchId: state.config.id,
      branchName: state.config.name,
      command: files?.length ? `svn revert ${files.join(' ')}` : `svn revert -R "${state.config.path}"`,
      status: 'success',
      output,
      durationMs: 120,
    });

    return { output };
  }

  async cleanup(branch: BranchConfig): Promise<{ output: string }> {
    const state = this.getState(branch);
    const output = `Cleanup completed successfully for '${state.config.path}'.`;
    recordInstantCommandLog({
      branchId: state.config.id,
      branchName: state.config.name,
      command: `svn cleanup "${state.config.path}"`,
      status: 'success',
      output,
      durationMs: 90,
    });
    return { output };
  }

  private getRulesForPair(source: BranchConfig, target: BranchConfig): DemoMergeRule[] {
    const pairKey = `${source.id}->${target.id}`;
    const alreadyMerged = this.mergedPairRevs.get(pairKey) ?? new Set<number>();

    let baseRules: DemoMergeRule[] = [];
    if (source.id === 'demo-billing') {
      baseRules = BILLING_RULES;
    } else if (source.id === 'demo-portal') {
      baseRules = PORTAL_RULES;
    } else if (source.id === 'demo-hotfix') {
      baseRules = HOTFIX_RULES;
    } else {
      const sourceState = this.getState(source);
      baseRules = sourceState.logs.slice(0, 2).map((l) => ({
        revision: l.revision,
        impacts: [
          {
            path: `src/modules/${source.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.ts`,
            fileAction: 'U',
            propAction: '',
            treeConflict: false,
            isConflict: false,
            rawLine: `U    src/modules/${source.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.ts`,
          },
        ],
        diffs: {
          [`src/modules/${source.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.ts`]: [
            `Index: src/modules/${source.name}.ts`,
            '===================================================================',
            `--- src/modules/${source.name}.ts\t(target)`,
            `+++ src/modules/${source.name}.ts\t(r${l.revision})`,
            '@@ -1,2 +1,3 @@',
            ' export const version = 1;',
            `+export const syncedFrom = "${source.name}";`,
          ].join('\n'),
        },
        conflictContents: {},
        treeConflictDescriptions: {},
      }));
    }

    return baseRules.filter((r) => !alreadyMerged.has(r.revision));
  }

  async getEligibleRevisions(source: BranchConfig, target: BranchConfig): Promise<LogEntry[]> {
    const sourceState = this.getState(source);
    const rules = this.getRulesForPair(source, target);
    const eligibleSet = new Set(rules.map((r) => r.revision));
    return sourceState.logs.filter((l) => eligibleSet.has(l.revision));
  }

  async preflightMerge(source: BranchConfig, target: BranchConfig): Promise<PreflightResult> {
    const [sourceStatus, targetStatus] = await Promise.all([
      this.getBranchStatus(source, false),
      this.getBranchStatus(target, true),
    ]);

    const warnings: string[] = [];
    const blockers: string[] = [];

    if (source.id === target.id) {
      blockers.push('Source and target branches must be different.');
    }

    const targetModifiedCount =
      targetStatus.counts.modified + targetStatus.counts.added + targetStatus.counts.deleted;

    if (targetStatus.counts.conflicted > 0 || targetStatus.counts.treeConflicts > 0) {
      blockers.push('Target working copy already has unresolved conflicts.');
    }
    if (targetModifiedCount > 0) {
      warnings.push('Target working copy has uncommitted local modifications.');
    }
    if (targetStatus.counts.incoming > 0) {
      warnings.push('Target working copy has incoming updates on the server.');
    }

    return {
      targetClean: targetStatus.isClean,
      targetModifiedCount,
      targetConflictCount: targetStatus.counts.conflicted + targetStatus.counts.treeConflicts,
      targetIncomingCount: targetStatus.counts.incoming,
      sourceValid: Boolean(sourceStatus.url),
      targetValid: Boolean(targetStatus.url),
      warnings,
      blockers,
    };
  }

  private collectSelectedRules(
    source: BranchConfig,
    target: BranchConfig,
    mode: MergeMode,
    revisions: number[] = []
  ): DemoMergeRule[] {
    const available = this.getRulesForPair(source, target);
    if (mode === 'all') return available;
    if (revisions.length === 0) {
      throw Object.assign(new Error('Select at least one revision to merge.'), { statusCode: 400 });
    }
    const revSet = new Set(revisions);
    return available.filter((r) => revSet.has(r.revision));
  }

  private buildMergeSummaryText(
    sourceUrl: string,
    selectedRules: DemoMergeRule[],
    summary: MergeImpactSummary
  ): string {
    const lines: string[] = [];
    const revs = selectedRules.map((r) => r.revision).sort((a, b) => a - b);
    const revRange = revs.length > 0 ? `r${revs[0]} through r${revs[revs.length - 1]}` : 'HEAD';
    lines.push(`--- Merging ${revRange} into '.':`);
    for (const rule of selectedRules) {
      for (const imp of rule.impacts) {
        lines.push(imp.rawLine);
      }
    }
    lines.push(`--- Recording mergeinfo for merge of ${revRange} into '${sourceUrl}':`);
    lines.push(` U   .`);
    if (summary.textConflicts > 0 || summary.treeConflicts > 0) {
      lines.push('Summary of conflicts:');
      if (summary.textConflicts > 0) lines.push(`  Text conflicts: ${summary.textConflicts}`);
      if (summary.treeConflicts > 0) lines.push(`  Tree conflicts: ${summary.treeConflicts}`);
    }
    return lines.join('\n');
  }

  private buildCommitMsg(
    source: BranchConfig,
    target: BranchConfig,
    mode: MergeMode,
    revs: number[]
  ): string {
    if (mode === 'revisions' && revs.length > 0) {
      return `Merge ${revs.map((r) => `r${r}`).join(', ')} from ${source.name} into ${target.name}`;
    }
    return `Merge changes from ${source.name} into ${target.name}`;
  }

  async testMerge(
    source: BranchConfig,
    target: BranchConfig,
    mode: MergeMode,
    revisions: number[] = []
  ): Promise<MergePreviewResult> {
    const sourceState = this.getState(source);
    const targetState = this.getState(target);
    const selectedRules = this.collectSelectedRules(source, target, mode, revisions);

    const rawLines = selectedRules.flatMap((r) => r.impacts.map((i) => i.rawLine)).join('\n');
    const { impacts, summary } = parseMergeOutput(rawLines);
    const sortedRevs = selectedRules.map((r) => r.revision).sort((a, b) => a - b);
    const rawOutput = this.buildMergeSummaryText(sourceState.url, selectedRules, summary);

    const revFlag =
      mode === 'revisions' && sortedRevs.length > 0 ? `-c ${sortedRevs.join(',')} ` : '';
    recordInstantCommandLog({
      branchId: targetState.config.id,
      branchName: targetState.config.name,
      command: `svn merge --dry-run --accept postpone ${revFlag}${sourceState.url}`,
      status: 'success',
      output: rawOutput,
      durationMs: 260,
    });

    return {
      sourceBranchId: source.id,
      targetBranchId: target.id,
      mode,
      revisions: sortedRevs,
      dryRun: true,
      impacts,
      summary,
      rawOutput,
      suggestedCommitMessage: this.buildCommitMsg(source, target, mode, sortedRevs),
    };
  }

  async getMergeFileDiff(
    source: BranchConfig,
    target: BranchConfig,
    filePath: string,
    revisions: number[] = []
  ): Promise<string> {
    const rules = this.getRulesForPair(source, target);
    const filtered =
      revisions.length > 0 ? rules.filter((r) => revisions.includes(r.revision)) : rules;
    for (const rule of filtered) {
      if (rule.diffs[filePath]) {
        return rule.diffs[filePath];
      }
    }
    return '';
  }

  async executeMerge(
    source: BranchConfig,
    target: BranchConfig,
    mode: MergeMode,
    revisions: number[] = []
  ): Promise<MergeExecuteResult> {
    const sourceState = this.getState(source);
    const targetState = this.getState(target);
    const selectedRules = this.collectSelectedRules(source, target, mode, revisions);

    const allImpacts: MergeFileImpact[] = [];
    for (const rule of selectedRules) {
      allImpacts.push(...rule.impacts);
      Object.assign(targetState.diffs, rule.diffs);
      Object.assign(targetState.conflictContents, rule.conflictContents);
      Object.assign(targetState.treeConflictDescriptions, rule.treeConflictDescriptions);
    }

    const summary = summarizeImpacts(allImpacts);
    const pairKey = `${source.id}->${target.id}`;
    const mergedSet = this.mergedPairRevs.get(pairKey) ?? new Set<number>();
    for (const rule of selectedRules) {
      mergedSet.add(rule.revision);
    }
    this.mergedPairRevs.set(pairKey, mergedSet);

    const existingMap = new Map(targetState.files.map((f) => [f.path, f]));
    for (const imp of allImpacts) {
      let status: WorkingCopyFile['status'] = 'modified';
      if (imp.fileAction === 'C' || imp.propAction === 'C' || imp.treeConflict) {
        status = 'conflicted';
      } else if (imp.fileAction === 'A') {
        status = 'added';
      } else if (imp.fileAction === 'D') {
        status = 'deleted';
      }

      existingMap.set(imp.path, {
        path: imp.path,
        status,
        treeConflict: imp.treeConflict,
      });
    }

    targetState.files = Array.from(existingMap.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    const conflictedFiles = targetState.files
      .filter((f) => f.status === 'conflicted' || f.treeConflict)
      .map((f) => f.path);

    const sortedRevs = selectedRules.map((r) => r.revision).sort((a, b) => a - b);
    const rawOutput = this.buildMergeSummaryText(sourceState.url, selectedRules, summary);

    const revFlag =
      mode === 'revisions' && sortedRevs.length > 0 ? `-c ${sortedRevs.join(',')} ` : '';
    recordInstantCommandLog({
      branchId: targetState.config.id,
      branchName: targetState.config.name,
      command: `svn merge --accept postpone ${revFlag}${sourceState.url}`,
      status: 'success',
      output: rawOutput,
      durationMs: 310,
    });

    return {
      success: true,
      dryRun: false,
      impacts: allImpacts,
      summary,
      hasConflicts: conflictedFiles.length > 0,
      conflictedFiles,
      rawOutput,
      suggestedCommitMessage: this.buildCommitMsg(source, target, mode, sortedRevs),
    };
  }

  async listConflicts(branch: BranchConfig): Promise<WorkingCopyFile[]> {
    const state = this.getState(branch);
    return state.files.filter((f) => f.status === 'conflicted' || f.treeConflict);
  }

  async getConflictDetail(branch: BranchConfig, filePath: string): Promise<ConflictFileDetail> {
    const state = this.getState(branch);
    const fileEntry = state.files.find((f) => f.path === filePath);
    if (!fileEntry || (fileEntry.status !== 'conflicted' && !fileEntry.treeConflict)) {
      throw Object.assign(new Error(`No active conflict for ${filePath} on ${branch.name}`), {
        statusCode: 404,
      });
    }

    const treeDesc = state.treeConflictDescriptions[filePath];
    const rawContent = state.conflictContents[filePath] ?? '';
    const { segments, hunks, markerCount } = parseConflictMarkers(rawContent);
    const kind: 'text' | 'tree' = treeDesc && markerCount === 0 ? 'tree' : 'text';

    return {
      branchId: state.config.id,
      filePath,
      fullPath: `${state.config.path}\\${filePath.replace(/\//g, '\\')}`,
      kind,
      treeConflictDescription: treeDesc,
      rawContent,
      hunks,
      segments,
      markerCount,
    };
  }

  async saveAndResolveConflict(
    branch: BranchConfig,
    filePath: string,
    resolvedContent: string
  ): Promise<{ output: string }> {
    const state = this.getState(branch);
    const remaining = countConflictMarkers(resolvedContent);
    if (remaining > 0) {
      throw Object.assign(
        new Error(`File still contains ${remaining} unresolved conflict marker(s).`),
        { statusCode: 400 }
      );
    }

    state.resolvedFilesContent[filePath] = resolvedContent;
    delete state.conflictContents[filePath];
    delete state.treeConflictDescriptions[filePath];

    state.files = state.files.map((f) =>
      f.path === filePath ? { ...f, status: 'modified', treeConflict: false } : f
    );

    const output = `Resolved conflicted state of '${filePath}'`;
    recordInstantCommandLog({
      branchId: state.config.id,
      branchName: state.config.name,
      command: `svn resolve --accept working "${filePath}"`,
      status: 'success',
      output,
      durationMs: 110,
    });

    return { output };
  }

  async quickResolveConflict(
    branch: BranchConfig,
    filePath: string,
    strategy: ConflictQuickStrategy
  ): Promise<{ output: string }> {
    const state = this.getState(branch);
    const rawContent = state.conflictContents[filePath];
    if (rawContent) {
      const { segments, hunks } = parseConflictMarkers(rawContent);
      const choice =
        strategy === 'theirs-full' || strategy === 'theirs-conflict' ? 'theirs' : 'mine';
      const choiceMap: Record<string, 'mine' | 'theirs'> = {};
      for (const h of hunks) choiceMap[h.id] = choice;
      state.resolvedFilesContent[filePath] = applyHunkChoices(segments, choiceMap);
    }

    delete state.conflictContents[filePath];
    delete state.treeConflictDescriptions[filePath];

    state.files = state.files.map((f) => {
      if (f.path !== filePath) return f;
      const isTreeDeleteAccepted = f.treeConflict && strategy === 'theirs-full';
      return {
        ...f,
        status: isTreeDeleteAccepted ? 'deleted' : 'modified',
        treeConflict: false,
      };
    });

    const output = `Resolved conflicted state of '${filePath}' (accept ${strategy})`;
    recordInstantCommandLog({
      branchId: state.config.id,
      branchName: state.config.name,
      command: `svn resolve --accept ${strategy} "${filePath}"`,
      status: 'success',
      output,
      durationMs: 110,
    });

    return { output };
  }
}
