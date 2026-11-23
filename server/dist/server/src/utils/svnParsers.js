"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSvnInfoXml = parseSvnInfoXml;
exports.parseSvnStatusXml = parseSvnStatusXml;
exports.parseSvnLogXml = parseSvnLogXml;
exports.parseMergeOutput = parseMergeOutput;
exports.parseMergeinfoEligible = parseMergeinfoEligible;
const fast_xml_parser_1 = require("fast-xml-parser");
const pathSafety_1 = require("./pathSafety");
const xmlParser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: true,
    isArray: (tagName) => ['entry', 'logentry', 'path', 'target'].includes(tagName),
});
function parseSvnInfoXml(xml) {
    const parsed = xmlParser.parse(xml);
    const entry = parsed?.info?.entry?.[0] ?? parsed?.info?.entry;
    if (!entry) {
        throw new Error('Failed to parse SVN info XML: missing entry node.');
    }
    const commit = entry.commit ?? {};
    const repo = entry.repository ?? {};
    let treeConflictDescription;
    const tc = entry['tree-conflict'];
    if (tc) {
        const kind = tc['@_kind'] ?? 'tree';
        const action = tc['@_action'] ?? 'unknown';
        const reason = tc['@_reason'] ?? 'unknown';
        const operation = tc['@_operation'] ?? 'merge';
        treeConflictDescription = `Tree conflict during ${operation}: incoming ${action}, local ${reason} (${kind})`;
    }
    return {
        url: String(entry.url ?? ''),
        relativeUrl: String(entry['relative-url'] ?? ''),
        repositoryRoot: String(repo.root ?? ''),
        revision: Number(entry['@_revision'] ?? 0) || 0,
        lastChangedRev: Number(commit['@_revision'] ?? 0) || 0,
        lastChangedAuthor: String(commit.author ?? ''),
        lastChangedDate: String(commit.date ?? ''),
        treeConflictDescription,
    };
}
function mapStatusItem(item) {
    switch (item) {
        case 'modified':
            return 'modified';
        case 'added':
            return 'added';
        case 'deleted':
            return 'deleted';
        case 'replaced':
            return 'replaced';
        case 'unversioned':
            return 'unversioned';
        case 'missing':
            return 'missing';
        case 'conflicted':
            return 'conflicted';
        case 'obstructed':
            return 'obstructed';
        case 'external':
            return 'external';
        default:
            return 'normal';
    }
}
function parseSvnStatusXml(xml, workingCopyPath) {
    const parsed = xmlParser.parse(xml);
    const targets = parsed?.status?.target ?? [];
    const fileMap = new Map();
    for (const target of targets) {
        const entries = target?.entry ?? [];
        for (const entry of entries) {
            const rawPath = String(entry['@_path'] ?? '');
            if (!rawPath)
                continue;
            const relPath = (0, pathSafety_1.toRelativePosixPath)(workingCopyPath, rawPath);
            const wcStatus = entry['wc-status'] ?? {};
            const reposStatus = entry['repos-status'];
            const item = String(wcStatus['@_item'] ?? 'normal');
            const props = String(wcStatus['@_props'] ?? 'none');
            const treeConflicted = String(wcStatus['@_tree-conflicted'] ?? 'false') === 'true';
            const status = mapStatusItem(item);
            const remoteModified = Boolean(reposStatus && reposStatus['@_item'] && reposStatus['@_item'] !== 'none');
            // Ignore root '.' if it has no local/prop/tree/remote changes
            if (relPath === '.' && status === 'normal' && props === 'none' && !treeConflicted && !remoteModified) {
                continue;
            }
            if (status === 'normal' && props === 'none' && !treeConflicted && !remoteModified) {
                continue;
            }
            const existing = fileMap.get(relPath);
            if (existing) {
                existing.remoteModified = existing.remoteModified || remoteModified;
                existing.treeConflict = existing.treeConflict || treeConflicted;
                if (status !== 'normal')
                    existing.status = status;
            }
            else {
                fileMap.set(relPath, {
                    path: relPath,
                    status,
                    propStatus: props !== 'none' ? props : undefined,
                    treeConflict: treeConflicted,
                    remoteModified,
                });
            }
        }
    }
    const files = Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
    const counts = {
        modified: 0,
        added: 0,
        deleted: 0,
        unversioned: 0,
        conflicted: 0,
        treeConflicts: 0,
        incoming: 0,
    };
    for (const file of files) {
        if (file.status === 'modified' || file.status === 'replaced')
            counts.modified++;
        else if (file.status === 'added')
            counts.added++;
        else if (file.status === 'deleted' || file.status === 'missing')
            counts.deleted++;
        else if (file.status === 'unversioned')
            counts.unversioned++;
        else if (file.status === 'conflicted')
            counts.conflicted++;
        if (file.treeConflict)
            counts.treeConflicts++;
        if (file.remoteModified)
            counts.incoming++;
    }
    return { files, counts };
}
function parseSvnLogXml(xml) {
    const parsed = xmlParser.parse(xml);
    const logentries = parsed?.log?.logentry ?? [];
    return logentries.map((entry) => {
        const rev = Number(entry['@_revision'] ?? 0) || 0;
        const author = String(entry.author ?? 'unknown');
        const date = String(entry.date ?? '');
        const msgNode = entry.msg;
        const message = typeof msgNode === 'string' ? msgNode : String(msgNode?.['#text'] ?? '');
        const pathsContainer = entry.paths;
        const rawPaths = pathsContainer?.path ?? [];
        const changedPaths = rawPaths.map((p) => {
            const pathText = typeof p === 'string' ? p : String(p['#text'] ?? '');
            return {
                action: String(p['@_action'] ?? 'M'),
                path: pathText,
                copyFromPath: p['@_copyfrom-path'] ? String(p['@_copyfrom-path']) : undefined,
                copyFromRev: p['@_copyfrom-rev'] ? Number(p['@_copyfrom-rev']) : undefined,
            };
        });
        return {
            revision: rev,
            author,
            date,
            message,
            changedPaths,
        };
    });
}
const VALID_FILE_ACTIONS = new Set(['U', 'A', 'D', 'G', 'C', 'E', 'R', ' ']);
function parseMergeOutput(stdout, workingCopyPath) {
    const lines = stdout.split(/\r?\n/);
    const impacts = [];
    const seen = new Map();
    for (const rawLine of lines) {
        if (!rawLine || rawLine.length < 5)
            continue;
        // Ignore headers / summary lines from svn merge
        if (rawLine.startsWith('---') ||
            rawLine.startsWith('Summary of conflicts:') ||
            rawLine.startsWith('  Text conflicts:') ||
            rawLine.startsWith('  Tree conflicts:') ||
            rawLine.startsWith('  Property conflicts:') ||
            rawLine.startsWith('Conflict discovered')) {
            continue;
        }
        // Standard svn merge notification format: 4 status columns + 1 space + path
        // Col 1: File action (U, A, D, G, C, E, R, or space)
        // Col 2: Property action (U, C, G, or space)
        // Col 3: Lock ('B' or space)
        // Col 4: Tree conflict ('C' or space)
        const match = /^([AUDCGER ])([UCG ])([B ])([C ])\s+(.+)$/.exec(rawLine);
        if (!match)
            continue;
        const col1 = match[1];
        const col2 = match[2];
        const col4 = match[4];
        const rawPath = match[5].trim();
        if (!rawPath || !VALID_FILE_ACTIONS.has(col1))
            continue;
        if (col1 === ' ' && col2 === ' ' && col4 === ' ')
            continue;
        const normalizedPath = workingCopyPath
            ? (0, pathSafety_1.toRelativePosixPath)(workingCopyPath, rawPath)
            : rawPath.split('\\').join('/');
        const treeConflict = col4 === 'C';
        const isConflict = col1 === 'C' || col2 === 'C' || treeConflict;
        const impact = {
            path: normalizedPath,
            fileAction: col1,
            propAction: col2.trim(),
            treeConflict,
            isConflict,
            rawLine,
        };
        const existing = seen.get(normalizedPath);
        if (existing) {
            existing.treeConflict = existing.treeConflict || impact.treeConflict;
            existing.isConflict = existing.isConflict || impact.isConflict;
            if (impact.fileAction !== ' ')
                existing.fileAction = impact.fileAction;
            if (impact.propAction)
                existing.propAction = impact.propAction;
        }
        else {
            seen.set(normalizedPath, impact);
            impacts.push(impact);
        }
    }
    const summary = {
        total: impacts.length,
        updated: 0,
        added: 0,
        deleted: 0,
        merged: 0,
        textConflicts: 0,
        treeConflicts: 0,
    };
    for (const impact of impacts) {
        if (impact.treeConflict)
            summary.treeConflicts++;
        if (impact.fileAction === 'C' || impact.propAction === 'C')
            summary.textConflicts++;
        if (impact.fileAction === 'U')
            summary.updated++;
        else if (impact.fileAction === 'A' || impact.fileAction === 'R')
            summary.added++;
        else if (impact.fileAction === 'D')
            summary.deleted++;
        else if (impact.fileAction === 'G')
            summary.merged++;
    }
    return { impacts, summary };
}
function parseMergeinfoEligible(stdout) {
    const revs = [];
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
        const match = /^r?(\d+)\*?$/.exec(line.trim());
        if (match) {
            revs.push(Number(match[1]));
        }
    }
    return revs.sort((a, b) => a - b);
}
//# sourceMappingURL=svnParsers.js.map