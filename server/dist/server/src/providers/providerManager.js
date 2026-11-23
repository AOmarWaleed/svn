"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveProvider = getActiveProvider;
exports.getDemoProvider = getDemoProvider;
exports.getActiveBranches = getActiveBranches;
exports.getActiveBranchById = getActiveBranchById;
exports.addActiveBranch = addActiveBranch;
exports.updateActiveBranch = updateActiveBranch;
exports.removeActiveBranch = removeActiveBranch;
exports.setActiveMasterBranch = setActiveMasterBranch;
const store_1 = require("../config/store");
const DemoSvnProvider_1 = require("./DemoSvnProvider");
const RealSvnProvider_1 = require("./RealSvnProvider");
const realProvider = new RealSvnProvider_1.RealSvnProvider();
const demoProvider = new DemoSvnProvider_1.DemoSvnProvider();
function getActiveProvider() {
    return (0, store_1.getSettings)().mode === 'demo' ? demoProvider : realProvider;
}
function getDemoProvider() {
    return demoProvider;
}
function getActiveBranches() {
    return (0, store_1.getSettings)().mode === 'demo' ? demoProvider.getBranches() : (0, store_1.getRealBranches)();
}
function getActiveBranchById(id) {
    const branch = getActiveBranches().find((b) => b.id === id);
    if (!branch) {
        throw Object.assign(new Error(`Branch not found: ${id}`), { statusCode: 404 });
    }
    return branch;
}
async function addActiveBranch(input) {
    if ((0, store_1.getSettings)().mode === 'demo') {
        return demoProvider.addBranch(input);
    }
    return (0, store_1.addRealBranch)(input);
}
async function updateActiveBranch(id, patch) {
    if ((0, store_1.getSettings)().mode === 'demo') {
        return demoProvider.updateBranchConfig(id, patch);
    }
    return (0, store_1.updateRealBranch)(id, patch);
}
async function removeActiveBranch(id) {
    if ((0, store_1.getSettings)().mode === 'demo') {
        demoProvider.removeBranch(id);
        return;
    }
    await (0, store_1.removeRealBranch)(id);
}
async function setActiveMasterBranch(id) {
    if ((0, store_1.getSettings)().mode === 'demo') {
        return demoProvider.setMasterBranch(id);
    }
    return (0, store_1.setRealMasterBranch)(id);
}
//# sourceMappingURL=providerManager.js.map