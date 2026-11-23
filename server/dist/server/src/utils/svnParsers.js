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
            const relPath = (0, pathSafety_1.toPosixRel)(workingCopyPath, rawPath);
            const wcStatus = entry['wc-status'] ?? {};
            const reposStatus = entry['repos-status'];
            const item = String(wcStatus['@_item'] ?? 'normal');
            const props = String(wcStatus['@_props'] ?? 'none');
            const treeConflicted = String(wcStatus['@_tree-conflicted'] ?? 'false') === 'true';
            const status = mapStatusItem(item);
            const remoteModified = Boolean(reposStatus && reposStatus['@_item'] && reposStatus['@_item'] !== 'none');
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
    return Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
}
function parseSvnLogXml(xml) {
    const parsed = xmlParser.parse(xml);
    const logentries = parsed?.log?.logentry ?? [];
    return logentries.map((entry) => {
        const rev = Number(entry['@_revision'] ?? 0) || 0;
        const author = String(entry.author ?? 'unknown');
        const date = String(entry.date ?? '');
        const msgNode = entry.msg;
        const message = typeof msgNode === 'string'
            ? msgNode
            : String(msgNode?.['#text'] ?? '');
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
    const seen = new Map();
    for (const rawLine of lines) {
        if (!rawLine || rawLine.length < 5)
            continue;
        if (rawLine.startsWith('---') ||
            rawLine.startsWith('Summary of conflicts:') ||
            rawLine.startsWith('  Text conflicts:') ||
            rawLine.startsWith('  Tree conflicts:') ||
            rawLine.startsWith('  Property conflicts:') ||
            rawLine.startsWith('Conflict discovered')) {
            continue;
        }
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
            ? (0, pathSafety_1.toPosixRel)(workingCopyPath, rawPath)
            : rawPath.split('\\').join('/');
        const treeConflict = col4 === 'C';
        const isConflict = col1 === 'C' || col2 === 'C' || treeConflict;
        const item = {
            path: normalizedPath,
            fileAction: col1,
            propAction: col2.trim(),
            treeConflict,
            isConflict,
            isProtected: false,
            rawLine,
        };
        const existing = seen.get(normalizedPath);
        if (existing) {
            existing.treeConflict = existing.treeConflict || item.treeConflict;
            existing.isConflict = existing.isConflict || item.isConflict;
            if (item.fileAction !== ' ')
                existing.fileAction = item.fileAction;
            if (item.propAction)
                existing.propAction = item.propAction;
        }
        else {
            seen.set(normalizedPath, item);
        }
    }
    return Array.from(seen.values());
}
function parseMergeinfoEligible(stdout) {
    const revs = [];
    for (const line of stdout.split(/\r?\n/)) {
        const match = /^r?(\d+)\*?$/.exec(line.trim());
        if (match)
            revs.push(Number(match[1]));
    }
    return revs.sort((a, b) => a - b);
}
//# sourceMappingURL=svnParsers.js.map