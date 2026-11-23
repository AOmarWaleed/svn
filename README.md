# SVN Control Center

Local web application (`React + Node.js`) to manage multiple SVN working copies (Master/Trunk + Feature/Hotfix Branches) from one browser dashboard.

## Features
- **All-in-One Branch Dashboard**: Status overview (`Clean`, `Modified`, `Added`, `Deleted`, `Conflicts`, `Incoming Updates`), 1-click `Update`, `Update All`, `Commit`, `Diff & Log`, `Revert`, `Cleanup`, and folder auto-scan.
- **Safe 2-Step Merge Wizard**:
  1. Pre-flight check on target working copy + All Eligible Changes or Cherry-pick specific revisions.
  2. **Test Merge (`svn merge --dry-run`)** previewing every affected file, predicted text/tree conflicts, and incoming diffs with zero disk modification.
  3. **Confirm Real Merge** with immediate Commit (pre-filled message) or Rollback.
- **Interactive Conflict Resolver**: Side-by-side hunk comparison (`Mine` vs `Theirs`), quick resolution buttons, raw manual editor, tree-conflict resolver, and external editor launch (`code`, etc.).
- **Dual Mode**: Built-in **Demo Sandbox** for instant testing without SVN installed + **Real SVN CLI** mode for your company machine.
- **Bilingual & Themed**: Instant toggle between Arabic (RTL) and English (LTR) + Dark/Light themes, with strict LTR isolation for code, diffs, and paths.

## Quick Start (Development)
```powershell
npm.cmd run dev
```
- Frontend dev server: `http://127.0.0.1:5173`
- Backend API server: `http://127.0.0.1:4100`

## Production Build & Launch (Company PC)
1. Ensure TortoiseSVN is installed **with "command line client tools" enabled** (so `svn.exe` is available, e.g. `C:\Program Files\TortoiseSVN\bin\svn.exe`).
2. Build and run:
```powershell
npm.cmd run build
npm.cmd start
```
Or simply double-click `start-svn-manager.bat`.

3. Open **Settings** in the web app, verify `svn.exe` path using **Test SVN Connection**, switch Mode to **Real SVN**, and use **Add Branch -> Auto-Scan Folder** to discover your local branches.
