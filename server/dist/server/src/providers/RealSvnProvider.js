"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealSvnProvider = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const store_1 = require("../config/store");
const commandLogger_1 = require("../utils/commandLogger");
const conflictParser_1 = require("../utils/conflictParser");
const pathSafety_1 = require("../utils/pathSafety");
const svnParsers_1 = require("../utils/svnParsers");
function encodeUrlPathSegment(baseUrl, relFilePath) {
    const cleanRel = relFilePath.replace(/^[/\\]+/, '').split('\\').join('/');
    const encodedRel = cleanRel
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
    return `${baseUrl.replace(/\/+$/, '')}/${encodedRel}`;
}
function buildSyntheticAddedDiff(filePath, content) {
    const lines = content.split(/\r?\n/);
    const body = lines.map((l) => `+${l}`).join('\n');
    return [
        `Index: ${filePath}`,
        `===================================================================`,
        `--- /dev/null\t(nonexistent)`,
        `+++ ${filePath}\t(incoming)`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
    ].join('\n');
}
function buildSyntheticDeletedDiff(filePath, content) {
    const lines = content.split(/\r?\n/);
    const body = lines.map((l) => `-${l}`).join('\n');
    return [
        `Index: ${filePath}`,
        `===================================================================`,
        `--- ${filePath}\t(target)`,
        `+++ /dev/null\t(deleted in source)`,
        `@@ -1,${lines.length} +0,0 @@`,
        body,
    ].join('\n');
}
class RealSvnProvider {
    async execSvn(args, opts = {}) {
        const settings = (0, store_1.getSettings)();
        const svnExe = settings.svnPath || 'svn';
        const finalArgs = [...args, '--non-interactive'];
        if (opts.network) {
            if (settings.trustServerCert) {
                finalArgs.push('--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other');
            }
            if (settings.authMode === 'custom' && settings.username) {
                finalArgs.push('--username', settings.username);
                if (settings.password) {
                    finalArgs.push('--password', settings.password);
                }
            }
        }
        const commandStr = (0, commandLogger_1.formatCommandLine)(svnExe, finalArgs);
        const startTime = Date.now();
        const logId = opts.quiet
            ? null
            : (0, commandLogger_1.startCommandLog)({
                branchId: opts.branchId,
                branchName: opts.branchName,
                command: commandStr,
            });
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let child;
            try {
                child = (0, node_child_process_1.spawn)(svnExe, finalArgs, {
                    cwd: opts.cwd,
                    windowsHide: true,
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (logId) {
                    (0, commandLogger_1.finishCommandLog)(logId, 'error', Date.now() - startTime, msg);
                }
                reject(Object.assign(new Error(`Failed to execute SVN: ${msg}`), { statusCode: 500 }));
                return;
            }
            child.stdout?.on('data', (chunk) => {
                const text = String(chunk);
                stdout += text;
                if (logId && !args.includes('--xml')) {
                    (0, commandLogger_1.appendCommandOutput)(logId, text);
                }
            });
            child.stderr?.on('data', (chunk) => {
                const text = String(chunk);
                stderr += text;
                if (logId) {
                    (0, commandLogger_1.appendCommandOutput)(logId, text);
                }
            });
            child.on('error', (err) => {
                if (logId) {
                    (0, commandLogger_1.finishCommandLog)(logId, 'error', Date.now() - startTime, err.message);
                }
                reject(Object.assign(new Error(`SVN execution error (${svnExe}): ${err.message}`), {
                    statusCode: 500,
                }));
            });
            child.on('close', (code) => {
                const duration = Date.now() - startTime;
                if (code === 0) {
                    if (logId) {
                        const summaryNote = args.includes('--xml')
                            ? `Completed XML query (${stdout.length} bytes)`
                            : undefined;
                        (0, commandLogger_1.finishCommandLog)(logId, 'success', duration, summaryNote);
                    }
                    resolve({ stdout, stderr });
                }
                else {
                    const message = stderr.trim() || stdout.trim() || `svn exited with code ${code}`;
                    if (logId) {
                        (0, commandLogger_1.finishCommandLog)(logId, 'error', duration, message);
                    }
                    reject(Object.assign(new Error(message), { statusCode: 400 }));
                }
            });
        });
    }
    async ensureWorkingCopyExists(branch) {
        try {
            const stat = await promises_1.default.stat(branch.path);
            if (!stat.isDirectory()) {
                throw new Error(`Not a directory: ${branch.path}`);
            }
        }
        catch {
            throw Object.assign(new Error(`Working copy folder not found: ${branch.path}`), {
                statusCode: 404,
            });
        }
    }
    async getBranchStatus(branch, checkRemote = false) {
        try {
            await this.ensureWorkingCopyExists(branch);
            const infoRes = await this.execSvn(['info', '--xml'], {
                cwd: branch.path,
                branchId: branch.id,
                branchName: branch.name,
                quiet: true,
            });
            const info = (0, svnParsers_1.parseSvnInfoXml)(infoRes.stdout);
            let statusStdout = '';
            let remoteWarning;
            if (checkRemote) {
                try {
                    const stRes = await this.execSvn(['status', '-u', '--xml'], {
                        cwd: branch.path,
                        branchId: branch.id,
                        branchName: branch.name,
                        network: true,
                        quiet: false,
                    });
                    statusStdout = stRes.stdout;
                }
                catch (err) {
                    remoteWarning = err instanceof Error ? err.message : String(err);
                    const localRes = await this.execSvn(['status', '--xml'], {
                        cwd: branch.path,
                        branchId: branch.id,
                        branchName: branch.name,
                        quiet: true,
                    });
                    statusStdout = localRes.stdout;
                }
            }
            else {
                const localRes = await this.execSvn(['status', '--xml'], {
                    cwd: branch.path,
                    branchId: branch.id,
                    branchName: branch.name,
                    quiet: true,
                });
                statusStdout = localRes.stdout;
            }
            const { files, counts } = (0, svnParsers_1.parseSvnStatusXml)(statusStdout, branch.path);
            const isClean = counts.modified === 0 &&
                counts.added === 0 &&
                counts.deleted === 0 &&
                counts.unversioned === 0 &&
                counts.conflicted === 0 &&
                counts.treeConflicts === 0;
            return {
                branchId: branch.id,
                name: branch.name,
                path: branch.path,
                isMaster: branch.isMaster,
                color: branch.color,
                url: info.url,
                relativeUrl: info.relativeUrl,
                repositoryRoot: info.repositoryRoot,
                revision: info.revision,
                lastChangedRev: info.lastChangedRev,
                lastChangedAuthor: info.lastChangedAuthor,
                lastChangedDate: info.lastChangedDate,
                counts,
                files,
                isClean,
                error: remoteWarning,
            };
        }
        catch (err) {
            return {
                branchId: branch.id,
                name: branch.name,
                path: branch.path,
                isMaster: branch.isMaster,
                color: branch.color,
                url: '',
                relativeUrl: '',
                repositoryRoot: '',
                revision: 0,
                lastChangedRev: 0,
                lastChangedAuthor: '',
                lastChangedDate: '',
                counts: {
                    modified: 0,
                    added: 0,
                    deleted: 0,
                    unversioned: 0,
                    conflicted: 0,
                    treeConflicts: 0,
                    incoming: 0,
                },
                files: [],
                isClean: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    async updateBranch(branch) {
        await this.ensureWorkingCopyExists(branch);
        const { stdout } = await this.execSvn(['update', '--accept', 'postpone'], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
            network: true,
        });
        const infoRes = await this.execSvn(['info', '--xml'], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
            quiet: true,
        });
        const info = (0, svnParsers_1.parseSvnInfoXml)(infoRes.stdout);
        return {
            output: stdout.trim(),
            newRevision: info.revision,
        };
    }
    async commitBranch(branch, files, message) {
        await this.ensureWorkingCopyExists(branch);
        if (!message.trim()) {
            throw Object.assign(new Error('Commit message is required.'), { statusCode: 400 });
        }
        if (!files.length) {
            throw Object.assign(new Error('Select at least one file to commit.'), { statusCode: 400 });
        }
        // Ensure any selected unversioned files are `svn add`ed first if needed
        const statusRes = await this.execSvn(['status', '--xml'], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
            quiet: true,
        });
        const { files: wcFiles } = (0, svnParsers_1.parseSvnStatusXml)(statusRes.stdout, branch.path);
        const unversionedSet = new Set(wcFiles.filter((f) => f.status === 'unversioned').map((f) => f.path));
        const safeFiles = files.map((f) => {
            (0, pathSafety_1.resolveSafeFilePath)(branch.path, f);
            return f;
        });
        const toAdd = safeFiles.filter((f) => unversionedSet.has(f));
        if (toAdd.length > 0) {
            await this.execSvn(['add', '--parents', ...toAdd], {
                cwd: branch.path,
                branchId: branch.id,
                branchName: branch.name,
            });
        }
        const tmpMsgFile = node_path_1.default.join(node_os_1.default.tmpdir(), `svn-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
        try {
            await promises_1.default.writeFile(tmpMsgFile, message, 'utf8');
            const { stdout } = await this.execSvn(['commit', '-F', tmpMsgFile, '--encoding', 'utf-8', ...safeFiles], {
                cwd: branch.path,
                branchId: branch.id,
                branchName: branch.name,
                network: true,
            });
            const revMatch = /Committed revision (\d+)\./i.exec(stdout);
            return {
                output: stdout.trim(),
                newRevision: revMatch ? Number(revMatch[1]) : undefined,
            };
        }
        finally {
            await promises_1.default.unlink(tmpMsgFile).catch(() => undefined);
        }
    }
    async getDiff(branch, filePath, revision) {
        await this.ensureWorkingCopyExists(branch);
        const args = ['diff'];
        if (revision !== undefined && Number.isFinite(revision)) {
            args.push('-c', String(revision));
        }
        if (filePath) {
            (0, pathSafety_1.resolveSafeFilePath)(branch.path, filePath);
            args.push(filePath);
        }
        const { stdout } = await this.execSvn(args, {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
            network: revision !== undefined,
        });
        return stdout;
    }
    async getLog(branch, limit = 30) {
        await this.ensureWorkingCopyExists(branch);
        const { stdout } = await this.execSvn(['log', '--xml', '-v', '-l', String(Math.max(1, Math.min(limit, 200)))], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
            network: true,
            quiet: true,
        });
        return (0, svnParsers_1.parseSvnLogXml)(stdout);
    }
    async revert(branch, files) {
        await this.ensureWorkingCopyExists(branch);
        const targets = files && files.length > 0
            ? files.map((f) => {
                (0, pathSafety_1.resolveSafeFilePath)(branch.path, f);
                return f;
            })
            : ['.'];
        const args = files && files.length > 0 ? ['revert', ...targets] : ['revert', '-R', '.'];
        const { stdout } = await this.execSvn(args, {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
        });
        return { output: stdout.trim() || 'Reverted working copy changes.' };
    }
    async cleanup(branch) {
        await this.ensureWorkingCopyExists(branch);
        const { stdout } = await this.execSvn(['cleanup'], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
        });
        return { output: stdout.trim() || 'Cleanup completed.' };
    }
    async getBranchUrl(branch) {
        const infoRes = await this.execSvn(['info', '--xml'], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
            quiet: true,
        });
        const info = (0, svnParsers_1.parseSvnInfoXml)(infoRes.stdout);
        if (!info.url) {
            throw Object.assign(new Error(`Unable to determine repository URL for ${branch.name}`), {
                statusCode: 400,
            });
        }
        return info.url;
    }
    async getEligibleRevisions(source, target) {
        await this.ensureWorkingCopyExists(source);
        await this.ensureWorkingCopyExists(target);
        const sourceUrl = await this.getBranchUrl(source);
        const { stdout: eligibleOut } = await this.execSvn(['mergeinfo', '--show-revs', 'eligible', sourceUrl, target.path], {
            cwd: target.path,
            branchId: target.id,
            branchName: target.name,
            network: true,
            quiet: true,
        });
        const revs = (0, svnParsers_1.parseMergeinfoEligible)(eligibleOut);
        if (revs.length === 0)
            return [];
        const revSet = new Set(revs);
        const minRev = revs[0];
        const maxRev = revs[revs.length - 1];
        const { stdout: logXml } = await this.execSvn(['log', '--xml', '-v', '-r', `${maxRev}:${minRev}`, sourceUrl], {
            cwd: target.path,
            branchId: target.id,
            branchName: target.name,
            network: true,
            quiet: true,
        });
        return (0, svnParsers_1.parseSvnLogXml)(logXml).filter((entry) => revSet.has(entry.revision));
    }
    async preflightMerge(source, target) {
        const [sourceStatus, targetStatus] = await Promise.all([
            this.getBranchStatus(source, false),
            this.getBranchStatus(target, true),
        ]);
        const warnings = [];
        const blockers = [];
        if (sourceStatus.error) {
            blockers.push(`Source branch error: ${sourceStatus.error}`);
        }
        if (targetStatus.error && !targetStatus.url) {
            blockers.push(`Target branch error: ${targetStatus.error}`);
        }
        if (source.id === target.id) {
            blockers.push('Source and target branches must be different.');
        }
        const targetModifiedCount = targetStatus.counts.modified + targetStatus.counts.added + targetStatus.counts.deleted;
        if (targetStatus.counts.conflicted > 0 || targetStatus.counts.treeConflicts > 0) {
            blockers.push('Target working copy already has unresolved conflicts.');
        }
        if (targetModifiedCount > 0) {
            warnings.push('Target working copy has uncommitted local modifications.');
        }
        if (targetStatus.counts.incoming > 0) {
            warnings.push('Target working copy is behind the repository and needs update.');
        }
        return {
            targetClean: targetStatus.isClean,
            targetModifiedCount,
            targetConflictCount: targetStatus.counts.conflicted + targetStatus.counts.treeConflicts,
            targetIncomingCount: targetStatus.counts.incoming,
            sourceValid: !sourceStatus.error,
            targetValid: Boolean(targetStatus.url),
            warnings,
            blockers,
        };
    }
    buildSuggestedCommitMessage(source, target, mode, revisions) {
        if (mode === 'revisions' && revisions && revisions.length > 0) {
            const revList = [...revisions].sort((a, b) => a - b).map((r) => `r${r}`).join(', ');
            return `Merge ${revList} from ${source.name} into ${target.name}`;
        }
        return `Merge changes from ${source.name} into ${target.name}`;
    }
    async testMerge(source, target, mode, revisions = []) {
        await this.ensureWorkingCopyExists(source);
        await this.ensureWorkingCopyExists(target);
        const sourceUrl = await this.getBranchUrl(source);
        const sortedRevs = [...revisions].sort((a, b) => a - b);
        const args = ['merge', '--dry-run', '--accept', 'postpone'];
        if (mode === 'revisions') {
            if (sortedRevs.length === 0) {
                throw Object.assign(new Error('Select at least one revision to cherry-pick.'), {
                    statusCode: 400,
                });
            }
            args.push('-c', sortedRevs.join(','));
        }
        args.push(sourceUrl);
        const { stdout, stderr } = await this.execSvn(args, {
            cwd: target.path,
            branchId: target.id,
            branchName: target.name,
            network: true,
        });
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        const { impacts, summary } = (0, svnParsers_1.parseMergeOutput)(combined, target.path);
        return {
            sourceBranchId: source.id,
            targetBranchId: target.id,
            mode,
            revisions: sortedRevs,
            dryRun: true,
            impacts,
            summary,
            rawOutput: combined.trim(),
            suggestedCommitMessage: this.buildSuggestedCommitMessage(source, target, mode, sortedRevs),
        };
    }
    async getMergeFileDiff(source, target, filePath, revisions = []) {
        await this.ensureWorkingCopyExists(source);
        await this.ensureWorkingCopyExists(target);
        (0, pathSafety_1.resolveSafeFilePath)(target.path, filePath);
        const [sourceUrl, targetUrl] = await Promise.all([
            this.getBranchUrl(source),
            this.getBranchUrl(target),
        ]);
        const srcFileUrl = encodeUrlPathSegment(sourceUrl, filePath);
        const tgtFileUrl = encodeUrlPathSegment(targetUrl, filePath);
        if (revisions.length === 1) {
            try {
                const { stdout } = await this.execSvn(['diff', '-c', String(revisions[0]), srcFileUrl], {
                    cwd: target.path,
                    branchId: target.id,
                    branchName: target.name,
                    network: true,
                    quiet: true,
                });
                if (stdout.trim())
                    return stdout;
            }
            catch {
                // Fallback below
            }
        }
        try {
            const { stdout } = await this.execSvn(['diff', tgtFileUrl, srcFileUrl], {
                cwd: target.path,
                branchId: target.id,
                branchName: target.name,
                network: true,
                quiet: true,
            });
            if (stdout.trim())
                return stdout;
        }
        catch {
            // Handle file existing only on source or only on target
            try {
                const { stdout: addedContent } = await this.execSvn(['cat', srcFileUrl], {
                    cwd: target.path,
                    network: true,
                    quiet: true,
                });
                return buildSyntheticAddedDiff(filePath, addedContent);
            }
            catch {
                try {
                    const { stdout: deletedContent } = await this.execSvn(['cat', tgtFileUrl], {
                        cwd: target.path,
                        network: true,
                        quiet: true,
                    });
                    return buildSyntheticDeletedDiff(filePath, deletedContent);
                }
                catch {
                    return '';
                }
            }
        }
        return '';
    }
    async executeMerge(source, target, mode, revisions = []) {
        await this.ensureWorkingCopyExists(source);
        await this.ensureWorkingCopyExists(target);
        const sourceUrl = await this.getBranchUrl(source);
        const sortedRevs = [...revisions].sort((a, b) => a - b);
        const args = ['merge', '--accept', 'postpone'];
        if (mode === 'revisions') {
            if (sortedRevs.length === 0) {
                throw Object.assign(new Error('Select at least one revision to merge.'), { statusCode: 400 });
            }
            args.push('-c', sortedRevs.join(','));
        }
        args.push(sourceUrl);
        const { stdout, stderr } = await this.execSvn(args, {
            cwd: target.path,
            branchId: target.id,
            branchName: target.name,
            network: true,
        });
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        const { impacts, summary } = (0, svnParsers_1.parseMergeOutput)(combined, target.path);
        const conflicts = await this.listConflicts(target);
        const conflictedFiles = conflicts.map((c) => c.path);
        return {
            success: true,
            dryRun: false,
            impacts,
            summary,
            hasConflicts: conflictedFiles.length > 0,
            conflictedFiles,
            rawOutput: combined.trim(),
            suggestedCommitMessage: this.buildSuggestedCommitMessage(source, target, mode, sortedRevs),
        };
    }
    async listConflicts(branch) {
        const status = await this.getBranchStatus(branch, false);
        return status.files.filter((f) => f.status === 'conflicted' || f.treeConflict);
    }
    async getConflictDetail(branch, filePath) {
        await this.ensureWorkingCopyExists(branch);
        const fullPath = (0, pathSafety_1.resolveSafeFilePath)(branch.path, filePath);
        let treeConflictDescription;
        try {
            const infoRes = await this.execSvn(['info', '--xml', filePath], {
                cwd: branch.path,
                branchId: branch.id,
                branchName: branch.name,
                quiet: true,
            });
            const parsed = (0, svnParsers_1.parseSvnInfoXml)(infoRes.stdout);
            treeConflictDescription = parsed.treeConflictDescription;
        }
        catch {
            // File may not exist in WC if deleted/missing
        }
        const exists = node_fs_1.default.existsSync(fullPath);
        let rawContent = '';
        if (exists) {
            const stat = await promises_1.default.stat(fullPath);
            if (stat.isFile()) {
                rawContent = await promises_1.default.readFile(fullPath, 'utf8');
            }
        }
        const { segments, hunks, markerCount } = (0, conflictParser_1.parseConflictMarkers)(rawContent);
        const kind = treeConflictDescription && markerCount === 0 ? 'tree' : 'text';
        // Try finding companion SVN conflict artifacts (.working, .merge-left.*, .merge-right.*)
        let mineFullContent;
        let theirsFullContent;
        let baseFullContent;
        try {
            const dir = node_path_1.default.dirname(fullPath);
            const baseName = node_path_1.default.basename(fullPath);
            const siblings = await promises_1.default.readdir(dir);
            for (const name of siblings) {
                if (name === `${baseName}.working`) {
                    mineFullContent = await promises_1.default.readFile(node_path_1.default.join(dir, name), 'utf8');
                }
                else if (name.startsWith(`${baseName}.merge-right.`)) {
                    theirsFullContent = await promises_1.default.readFile(node_path_1.default.join(dir, name), 'utf8');
                }
                else if (name.startsWith(`${baseName}.merge-left.`)) {
                    baseFullContent = await promises_1.default.readFile(node_path_1.default.join(dir, name), 'utf8');
                }
            }
        }
        catch {
            // Optional companion files
        }
        return {
            branchId: branch.id,
            filePath,
            fullPath,
            kind,
            treeConflictDescription,
            rawContent,
            hunks,
            segments,
            mineFullContent,
            theirsFullContent,
            baseFullContent,
            markerCount,
        };
    }
    async saveAndResolveConflict(branch, filePath, resolvedContent) {
        await this.ensureWorkingCopyExists(branch);
        const fullPath = (0, pathSafety_1.resolveSafeFilePath)(branch.path, filePath);
        const remaining = (0, conflictParser_1.countConflictMarkers)(resolvedContent);
        if (remaining > 0) {
            throw Object.assign(new Error(`File still contains ${remaining} unresolved conflict marker(s).`), { statusCode: 400 });
        }
        await promises_1.default.writeFile(fullPath, resolvedContent, 'utf8');
        const { stdout } = await this.execSvn(['resolve', '--accept', 'working', filePath], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
        });
        return { output: stdout.trim() || `Resolved conflict in ${filePath}` };
    }
    async quickResolveConflict(branch, filePath, strategy) {
        await this.ensureWorkingCopyExists(branch);
        (0, pathSafety_1.resolveSafeFilePath)(branch.path, filePath);
        const { stdout } = await this.execSvn(['resolve', '--accept', strategy, filePath], {
            cwd: branch.path,
            branchId: branch.id,
            branchName: branch.name,
        });
        return { output: stdout.trim() || `Resolved ${filePath} using ${strategy}` };
    }
}
exports.RealSvnProvider = RealSvnProvider;
//# sourceMappingURL=RealSvnProvider.js.map