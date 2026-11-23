"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectRoot = getProjectRoot;
exports.resolveInsideRoot = resolveInsideRoot;
exports.toPosixRel = toPosixRel;
exports.matchesAnyPattern = matchesAnyPattern;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Finds the workspace root directory regardless of whether running from tsx src or compiled dist.
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
 * Resolves a relative sub-path strictly inside rootDir, blocking directory traversal.
 */
function resolveInsideRoot(rootDir, subPath) {
    if (!rootDir) {
        throw Object.assign(new Error('Root directory is required.'), { statusCode: 400 });
    }
    if (subPath.includes('\0')) {
        throw Object.assign(new Error('Invalid path characters.'), { statusCode: 400 });
    }
    const normalizedRoot = node_path_1.default.resolve(rootDir);
    const cleaned = subPath.replace(/^[/\\]+/, '');
    const resolvedTarget = cleaned ? node_path_1.default.resolve(normalizedRoot, cleaned) : normalizedRoot;
    const rootWithSep = normalizedRoot.endsWith(node_path_1.default.sep)
        ? normalizedRoot
        : `${normalizedRoot}${node_path_1.default.sep}`;
    const isWin = process.platform === 'win32';
    const targetCmp = isWin ? resolvedTarget.toLowerCase() : resolvedTarget;
    const rootCmp = isWin ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSepCmp = isWin ? rootWithSep.toLowerCase() : rootWithSep;
    if (targetCmp !== rootCmp && !targetCmp.startsWith(rootWithSepCmp)) {
        throw Object.assign(new Error(`Path traversal blocked: ${subPath}`), { statusCode: 400 });
    }
    return resolvedTarget;
}
function toPosixRel(baseDir, fullPath) {
    const rel = node_path_1.default.relative(node_path_1.default.resolve(baseDir), node_path_1.default.resolve(fullPath));
    if (!rel || rel === '')
        return '.';
    return rel.split(node_path_1.default.sep).join('/');
}
function globToRegex(glob) {
    const escaped = glob
        .toLowerCase()
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}
/**
 * Matches a posix relative file path against ignore or protected patterns.
 */
function matchesAnyPattern(relPath, patterns) {
    const normalized = relPath.split('\\').join('/').replace(/^\/+/, '').toLowerCase();
    if (!normalized)
        return null;
    const segments = normalized.split('/');
    const basename = segments[segments.length - 1];
    for (const rawPattern of patterns) {
        const pattern = rawPattern.trim().toLowerCase();
        if (!pattern)
            continue;
        if (pattern.includes('/')) {
            const re = globToRegex(pattern);
            if (re.test(normalized)) {
                return rawPattern;
            }
            if (pattern.endsWith('/*')) {
                const prefix = pattern.slice(0, -2);
                if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
                    return rawPattern;
                }
            }
        }
        else {
            const re = globToRegex(pattern);
            if (re.test(basename) || segments.some((seg) => re.test(seg))) {
                return rawPattern;
            }
        }
    }
    return null;
}
//# sourceMappingURL=pathSafety.js.map