"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectRoot = getProjectRoot;
exports.resolveSafeFilePath = resolveSafeFilePath;
exports.toRelativePosixPath = toRelativePosixPath;
exports.scanForSvnWorkingCopies = scanForSvnWorkingCopies;
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.svn',
    'dist',
    'build',
    '.next',
    '.cache',
    '$RECYCLE.BIN',
    'System Volume Information',
]);
/**
 * Resolves the workspace root directory regardless of whether running from tsx src or compiled dist.
 */
function getProjectRoot() {
    let current = __dirname;
    for (let i = 0; i < 8; i++) {
        const hasServerPkg = node_fs_1.default.existsSync(node_path_1.default.join(current, 'server', 'package.json'));
        const hasShared = node_fs_1.default.existsSync(node_path_1.default.join(current, 'shared', 'types.ts'));
        if (hasServerPkg && hasShared) {
            return current;
        }
        const parent = node_path_1.default.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return node_path_1.default.resolve(__dirname, '..', '..', '..');
}
/**
 * Ensures a relative or sub-path resolves strictly within the working copy root.
 */
function resolveSafeFilePath(workingCopyRoot, relativeOrSubPath) {
    if (!workingCopyRoot || !relativeOrSubPath) {
        throw Object.assign(new Error('Working copy root and file path are required.'), { statusCode: 400 });
    }
    const normalizedRoot = node_path_1.default.resolve(workingCopyRoot);
    const cleanedSub = relativeOrSubPath.replace(/^[/\\]+/, '');
    if (!cleanedSub || cleanedSub.includes('\0')) {
        throw Object.assign(new Error('Invalid file path.'), { statusCode: 400 });
    }
    const resolvedTarget = node_path_1.default.resolve(normalizedRoot, cleanedSub);
    const rootWithSep = normalizedRoot.endsWith(node_path_1.default.sep) ? normalizedRoot : `${normalizedRoot}${node_path_1.default.sep}`;
    const isWin = process.platform === 'win32';
    const targetCmp = isWin ? resolvedTarget.toLowerCase() : resolvedTarget;
    const rootWithSepCmp = isWin ? rootWithSep.toLowerCase() : rootWithSep;
    const rootCmp = isWin ? normalizedRoot.toLowerCase() : normalizedRoot;
    if (targetCmp !== rootCmp && !targetCmp.startsWith(rootWithSepCmp)) {
        throw Object.assign(new Error(`Path traversal blocked: ${relativeOrSubPath}`), { statusCode: 400 });
    }
    return resolvedTarget;
}
/**
 * Normalizes a file path relative to a working copy root using forward slashes.
 */
function toRelativePosixPath(workingCopyRoot, entryPath) {
    const normalizedRoot = node_path_1.default.resolve(workingCopyRoot);
    const resolvedEntry = node_path_1.default.isAbsolute(entryPath)
        ? node_path_1.default.resolve(entryPath)
        : node_path_1.default.resolve(normalizedRoot, entryPath);
    const rel = node_path_1.default.relative(normalizedRoot, resolvedEntry);
    if (!rel || rel === '')
        return '.';
    return rel.split(node_path_1.default.sep).join('/');
}
/**
 * Recursively scans a parent directory for SVN working copies (folders containing a .svn directory).
 */
async function scanForSvnWorkingCopies(rootDir, existingPaths = [], maxDepth = 3) {
    const resolvedRoot = node_path_1.default.resolve(rootDir);
    let stat;
    try {
        stat = await promises_1.default.stat(resolvedRoot);
    }
    catch {
        throw Object.assign(new Error(`Directory not found: ${resolvedRoot}`), { statusCode: 404 });
    }
    if (!stat.isDirectory()) {
        throw Object.assign(new Error(`Path is not a directory: ${resolvedRoot}`), { statusCode: 400 });
    }
    const existingSet = new Set(existingPaths.map((p) => (process.platform === 'win32' ? node_path_1.default.resolve(p).toLowerCase() : node_path_1.default.resolve(p))));
    const found = [];
    async function walk(dir, depth) {
        if (depth > maxDepth)
            return;
        const svnMetaDir = node_path_1.default.join(dir, '.svn');
        try {
            const svnStat = await promises_1.default.stat(svnMetaDir);
            if (svnStat.isDirectory()) {
                const cmp = process.platform === 'win32' ? dir.toLowerCase() : dir;
                found.push({
                    name: node_path_1.default.basename(dir) || dir,
                    path: dir,
                    alreadyAdded: existingSet.has(cmp),
                });
                return; // Don't recurse inside an SVN working copy
            }
        }
        catch {
            // Not an SVN working copy; continue walking children
        }
        if (depth === maxDepth)
            return;
        let entries;
        try {
            entries = await promises_1.default.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.'))
                continue;
            await walk(node_path_1.default.join(dir, entry.name), depth + 1);
        }
    }
    await walk(resolvedRoot, 0);
    return found.sort((a, b) => a.name.localeCompare(b.name));
}
//# sourceMappingURL=pathSafety.js.map