# RCM Transfer & SVN Hub

Local React + Node.js control center built specifically for your single-root RCM SVN monorepo (`MASTER` + `BRANCHES/DEV` + `BRANCHES/TEST`) with mismatched folder path mappings (`billing/rcm-api` ↔ `BRANCHES/DEV/billing/backend`, `HIS-Integration` ↔ `BRANCHES/DEV/his-integration`, `common` ↔ `BRANCHES/DEV/shared`, etc.) and **VS Code-first conflict resolution**.

## Launch Locally (Sample RCM On-Disk Sandbox)
```powershell
npm.cmd run build
npm.cmd start
```
Or double-click `start-svn-manager.bat` and open `http://127.0.0.1:4100`.
In **Sample Mode**, a real directory tree mirroring your company repository is created at `sample-rcm\` so you can test **Smart Folder Diff**, **Dry-Run Previews**, **Conflict Markers**, and launching **VS Code** (`code` / `code --diff`) immediately on this PC.

## Use on Your Company Machine
1. Ensure TortoiseSVN is installed with **Command Line Client Tools** enabled (`svn.exe`).
2. Open **Settings** in the app:
   - Switch Mode to **Real Company Repo**.
   - Set **Company RCM Working Copy Root** to `C:\Users\appdev3l\Desktop\rcm`.
   - Click **Test SVN** and **Test VS Code**, then click **Save Settings**.
3. Open **Path Mapping** to inspect/edit or auto-discover any additional folders.
