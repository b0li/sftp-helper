const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { readSftpConfig } = require('./config');
const { SFTPConnection } = require('./connection');
const { RemoteTreeProvider } = require('./treeProvider');

let treeProvider = null;

function activate(context) {
  const config = readSftpConfig();

  // Factory: creates a fresh connection from the current config
  const createConnection = async () => {
    const cfg = readSftpConfig();
    if (!cfg) {
      throw new Error('No sftp.json config found.');
    }
    const conn = new SFTPConnection(cfg);
    await conn.connect();
    return conn;
  };

  // Resolve the target directory for create/upload actions:
  // directory item → inside it, file item → its parent, no item (title bar) → config root
  const resolveBaseDir = (item) => {
    if (item && item.type === 'directory') return item.remotePath;
    if (item && item.type === 'file') return path.posix.dirname(item.remotePath);
    const cfg = readSftpConfig();
    return (cfg && cfg.remotePath) ? cfg.remotePath : '/';
  };

  // Tree provider for the sidebar
  treeProvider = new RemoteTreeProvider(createConnection);

  if (config && config.remotePath) {
    treeProvider.setRootPath(config.remotePath);
  }

  // Register tree view with drag & drop support
  const treeView = vscode.window.createTreeView('sftpHelperExplorer', {
    treeDataProvider: treeProvider,
    canSelectMany: true,
    dragAndDropController: treeProvider,
  });

  context.subscriptions.push(treeView);

  // ── Double-click detector ─────────────────────────────────
  let lastClickPath = null;
  let lastClickTime = 0;
  const DOUBLE_CLICK_MS = 500;

  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper._onClick', (item) => {
      if (!item || item.type !== 'file') return;

      const now = Date.now();
      if (lastClickPath === item.remotePath && (now - lastClickTime) < DOUBLE_CLICK_MS) {
        // Double-click detected → edit in local
        lastClickPath = null;
        lastClickTime = 0;
        vscode.commands.executeCommand('sftpHelper.editLocal', item);
      } else {
        // Single click — just remember it
        lastClickPath = item.remotePath;
        lastClickTime = now;
      }
    })
  );

  // ── Refresh ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.refresh', () => {
      // Re-read config in case remotePath changed
      const cfg = readSftpConfig();
      if (cfg && cfg.remotePath) {
        treeProvider.setRootPath(cfg.remotePath);
      }
      treeProvider.refresh();
    })
  );

  // ── Edit in Local ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.editLocal', async (item) => {
      if (!item || item.type !== 'file') return;

      const cfg = readSftpConfig();
      if (!cfg) return;

      // Calculate local path: workspace folder + relative path from remotePath root
      const workspaceFolder = cfg._workspaceFolder;
      const remotePath = cfg.remotePath || '/';

      // Get the relative path from the config's remotePath
      let relativePath = item.remotePath;
      if (relativePath.startsWith(remotePath)) {
        relativePath = relativePath.slice(remotePath.length);
      }
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }

      const localFilePath = path.join(workspaceFolder, relativePath);

      // Ensure local directory exists
      const localDir = path.dirname(localFilePath);
      fs.mkdirSync(localDir, { recursive: true });

      try {
        const conn = await createConnection();

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${item.name}...`,
            cancellable: false,
          },
          async () => {
            await conn.download(item.remotePath, localFilePath);
          }
        );

        await conn.disconnect();

        // Open the file in the editor (pinned tab, not preview)
        const doc = await vscode.workspace.openTextDocument(localFilePath);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Download failed — ${err.message}`
        );
      }
    })
  );

  // ── Rename ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.rename', async (item) => {
      // Keybinding passes no item — fall back to the tree selection (single item)
      if (!item) {
        const sel = treeView.selection || [];
        if (sel.length === 0) return;
        item = sel[0];
      }

      const oldName = item.name;
      const newName = await vscode.window.showInputBox({
        prompt: 'New name',
        value: oldName,
        validateInput: (v) => {
          if (!v || v.trim().length === 0) return 'Name cannot be empty';
          if (v.includes('/')) return 'Name cannot contain /';
          return null;
        },
      });

      if (!newName || newName === oldName) return;

      try {
        const conn = await createConnection();
        const parentDir = path.posix.dirname(item.remotePath);
        const newPath = path.posix.join(parentDir, newName);

        await conn.rename(item.remotePath, newPath);
        await conn.disconnect();

        vscode.window.showInformationMessage(
          `Renamed: ${oldName} → ${newName}`
        );
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Rename failed — ${err.message}`
        );
      }
    })
  );

  // ── Delete (supports multi-select) ────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.delete', async (item, selectedItems) => {
      // VS Code passes (clicked item, all selected items) from the context menu,
      // but passes nothing when triggered via keybinding — fall back to the tree selection
      const items = (selectedItems && selectedItems.length > 0)
        ? selectedItems
        : (item ? [item] : (treeView.selection || []));
      if (items.length === 0) return;

      const message = items.length === 1
        ? `Delete ${items[0].type === 'directory' ? 'folder' : 'file'} "${items[0].name}"?`
        : `Delete ${items.length} items?`;

      const answer = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Delete'
      );

      if (answer !== 'Delete') return;

      try {
        const conn = await createConnection();

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'SFTP Helper: Deleting...',
            cancellable: false,
          },
          async (progress) => {
            for (let i = 0; i < items.length; i++) {
              const it = items[i];
              progress.report({
                message: `${it.name} (${i + 1}/${items.length})`,
                increment: 100 / items.length,
              });
              await conn.delete(it.remotePath, it.type === 'directory');
            }
          }
        );

        await conn.disconnect();

        const msg = items.length === 1
          ? `Deleted: ${items[0].name}`
          : `Deleted ${items.length} items.`;
        vscode.window.showInformationMessage(msg);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Delete failed — ${err.message}`
        );
      }
    })
  );

  // ── Upload File Here ─────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.upload', async (item) => {
      if (!item || item.type !== 'directory') {
        vscode.window.showWarningMessage('SFTP Helper: Select a folder first.');
        return;
      }

      const fileUris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Upload',
      });

      if (!fileUris || fileUris.length === 0) return;

      try {
        const conn = await createConnection();
        let uploaded = 0;
        let skipped = 0;
        const applyToAll = {};

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'SFTP Helper: Uploading...',
            cancellable: false,
          },
          async (progress) => {
            for (let i = 0; i < fileUris.length; i++) {
              const uri = fileUris[i];
              const fileName = path.basename(uri.fsPath);
              const remoteDest = item.remotePath.endsWith('/')
                ? item.remotePath + fileName
                : item.remotePath + '/' + fileName;

              progress.report({
                message: `${fileName} (${i + 1}/${fileUris.length})`,
                increment: 100 / fileUris.length,
              });

              const result = await treeProvider._uploadFileWithCheck(conn, uri.fsPath, remoteDest, applyToAll);
              if (result === 'skipped') {
                skipped++;
              } else {
                uploaded++;
              }
            }
          }
        );

        await conn.disconnect();
        const parts = [`${uploaded} file(s) uploaded`];
        if (skipped > 0) parts.push(`${skipped} skipped`);
        vscode.window.showInformationMessage(`SFTP Helper: ${parts.join(', ')}.`);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Upload failed — ${err.message}`
        );
      }
    })
  );

  // ── Upload Folder Here ────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.uploadFolder', async (item) => {
      if (!item || item.type !== 'directory') {
        vscode.window.showWarningMessage('SFTP Helper: Select a folder first.');
        return;
      }

      const folderUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: 'Upload Folder',
      });

      if (!folderUris || folderUris.length === 0) return;

      const localFolder = folderUris[0].fsPath;
      const folderBaseName = path.basename(localFolder);
      const remoteBase = item.remotePath.endsWith('/')
        ? item.remotePath + folderBaseName
        : item.remotePath + '/' + folderBaseName;

      // Collect all files recursively
      const allFiles = [];
      const collectFiles = (dir, relative) => {
        const entries = require('fs').readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const rel = relative ? relative + '/' + entry.name : entry.name;
          if (entry.isDirectory()) {
            collectFiles(fullPath, rel);
          } else if (entry.isFile()) {
            allFiles.push({ localPath: fullPath, relativePath: rel });
          }
        }
      };

      try {
        collectFiles(localFolder, '');
      } catch (err) {
        vscode.window.showErrorMessage(`SFTP Helper: Cannot read folder — ${err.message}`);
        return;
      }

      if (allFiles.length === 0) {
        vscode.window.showWarningMessage('SFTP Helper: Folder is empty.');
        return;
      }

      try {
        const conn = await createConnection();
        let uploaded = 0;
        let skipped = 0;
        const applyToAll = {};

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `SFTP Helper: Uploading ${folderBaseName}/...`,
            cancellable: false,
          },
          async (progress) => {
            // Collect unique directories and create them
            const dirs = new Set();
            for (const f of allFiles) {
              const parts = f.relativePath.split('/');
              for (let i = 1; i < parts.length; i++) {
                dirs.add(parts.slice(0, i).join('/'));
              }
            }
            // Create root folder + subdirectories
            await conn.mkdir(remoteBase);
            const sortedDirs = [...dirs].sort();
            for (const dir of sortedDirs) {
              await conn.mkdir(remoteBase + '/' + dir);
            }

            // Upload files with conflict check
            for (let i = 0; i < allFiles.length; i++) {
              const file = allFiles[i];
              const remoteDest = remoteBase + '/' + file.relativePath;

              progress.report({
                message: `${file.relativePath} (${i + 1}/${allFiles.length})`,
                increment: 100 / allFiles.length,
              });

              const result = await treeProvider._uploadFileWithCheck(conn, file.localPath, remoteDest, applyToAll);
              if (result === 'skipped') {
                skipped++;
              } else {
                uploaded++;
              }
            }
          }
        );

        await conn.disconnect();
        const parts = [`${uploaded} file(s) uploaded`];
        if (skipped > 0) parts.push(`${skipped} skipped`);
        vscode.window.showInformationMessage(
          `SFTP Helper: Folder "${folderBaseName}" — ${parts.join(', ')}.`
        );
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Folder upload failed — ${err.message}`
        );
      }
    })
  );

  // ── New Folder ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.newFolder', async (item) => {
      // Directory → inside it; file → its parent; no item (title bar) → root
      const baseDir = resolveBaseDir(item);

      const folderName = await vscode.window.showInputBox({
        prompt: 'New folder name',
        validateInput: (v) => {
          if (!v || v.trim().length === 0) return 'Name cannot be empty';
          if (v.includes('/')) return 'Name cannot contain /';
          return null;
        },
      });

      if (!folderName) return;

      try {
        const conn = await createConnection();
        const newPath = baseDir.endsWith('/')
          ? baseDir + folderName
          : baseDir + '/' + folderName;

        await conn.mkdir(newPath);
        await conn.disconnect();

        vscode.window.showInformationMessage(`Created folder: ${folderName}`);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Create folder failed — ${err.message}`
        );
      }
    })
  );

  // ── New File ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.newFile', async (item) => {
      // Directory → inside it; file → its parent; no item (title bar) → root
      const baseDir = resolveBaseDir(item);

      const fileName = await vscode.window.showInputBox({
        prompt: 'New file name',
        validateInput: (v) => {
          if (! v || v.trim().length === 0) return 'Name cannot be empty';
          if (v.includes('/')) return 'Name cannot contain /';
          return null;
        },
      });

      if (! fileName) return;

      const newPath = baseDir.endsWith('/')
        ? baseDir + fileName
        : baseDir + '/' + fileName;

      try {
        const conn = await createConnection();

        // Abort if a file/folder with that name already exists
        const existing = await conn.exists(newPath);
        if (existing) {
          await conn.disconnect();
          vscode.window.showWarningMessage(`SFTP Helper: "${fileName}" already exists.`);
          return;
        }

        await conn.createFile(newPath);
        await conn.disconnect();

        vscode.window.showInformationMessage(`Created file: ${fileName}`);
        treeProvider.refresh();

        // Download the empty file locally and open it for editing
        vscode.commands.executeCommand('sftpHelper.editLocal', {
          type: 'file',
          name: fileName,
          remotePath: newPath,
        });
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Create file failed — ${err.message}`
        );
      }
    })
  );

  // ── Move to... (supports multi-select) ────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.moveTo', async (item, selectedItems) => {
      const items = (selectedItems && selectedItems.length > 0) ? selectedItems : (item ? [item] : []);
      if (items.length === 0) return;

      const cfg = readSftpConfig();
      const rootPath = (cfg && cfg.remotePath) ? cfg.remotePath : '/';

      // Suggest parent dir of first item as default destination
      const defaultDest = path.posix.dirname(items[0].remotePath);

      const destination = await vscode.window.showInputBox({
        prompt: `Move ${items.length === 1 ? `"${items[0].name}"` : `${items.length} items`} to (remote path)`,
        value: defaultDest,
        validateInput: (v) => {
          if (!v || v.trim().length === 0) return 'Path cannot be empty';
          if (!v.startsWith('/')) return 'Path must start with /';
          return null;
        },
      });

      if (!destination) return;

      try {
        const conn = await createConnection();

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'SFTP Helper: Moving...',
            cancellable: false,
          },
          async (progress) => {
            for (let i = 0; i < items.length; i++) {
              const it = items[i];
              const newPath = destination.endsWith('/')
                ? destination + it.name
                : destination + '/' + it.name;

              progress.report({
                message: `${it.name} (${i + 1}/${items.length})`,
                increment: 100 / items.length,
              });

              await conn.rename(it.remotePath, newPath);
            }
          }
        );

        await conn.disconnect();

        const msg = items.length === 1
          ? `Moved "${items[0].name}" to ${destination}`
          : `Moved ${items.length} items to ${destination}`;
        vscode.window.showInformationMessage(msg);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Move failed — ${err.message}`
        );
      }
    })
  );

  // ── Download to... (files + folders, multi-select) ────────
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpHelper.downloadTo', async (item, selectedItems) => {
      // Context menu passes (clicked item, selection); keybinding passes nothing
      const items = (selectedItems && selectedItems.length > 0)
        ? selectedItems
        : (item ? [item] : (treeView.selection || []));
      if (items.length === 0) return;

      // Ask for the local destination folder
      const destUris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: 'Download Here',
      });
      if (!destUris || destUris.length === 0) return;

      const destRoot = destUris[0].fsPath;

      try {
        const conn = await createConnection();

        let downloaded = 0;
        let skipped = 0;
        const applyToAll = {}; // { overwrite: true|false }

        // Resolve a local overwrite conflict; honors "apply to all"
        const resolveConflict = async (localPath, name) => {
          if (! fs.existsSync(localPath)) return 'write';
          if (applyToAll.overwrite === true) return 'write';
          if (applyToAll.overwrite === false) return 'skip';

          const choice = await vscode.window.showWarningMessage(
            `"${name}" already exists locally. Overwrite?`,
            { modal: true },
            'Overwrite', 'Overwrite All', 'Skip', 'Skip All'
          );

          if (choice === 'Overwrite') return 'write';
          if (choice === 'Overwrite All') { applyToAll.overwrite = true; return 'write'; }
          if (choice === 'Skip') return 'skip';
          if (choice === 'Skip All') { applyToAll.overwrite = false; return 'skip'; }

          return 'cancel'; // dialog dismissed
        };

        // Recursively collect all files under a remote directory
        const collectRemote = async (remoteDir, relBase) => {
          const out = [];
          const entries = await conn.list(remoteDir);
          for (const e of entries) {
            const rPath = remoteDir.endsWith('/') ? remoteDir + e.name : remoteDir + '/' + e.name;
            const rel = relBase ? relBase + '/' + e.name : e.name;
            if (e.type === 'directory') {
              out.push(...await collectRemote(rPath, rel));
            } else {
              out.push({ remotePath: rPath, relativePath: rel });
            }
          }
          return out;
        };

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'SFTP Helper: Downloading...',
            cancellable: false,
          },
          async (progress) => {
            // Build a flat job list, keeping folder structure under destRoot
            const jobs = [];
            for (const it of items) {
              if (it.type === 'directory') {
                // Preserve the folder itself (also when empty)
                fs.mkdirSync(path.join(destRoot, it.name), { recursive: true });
                jobs.push(...await collectRemote(it.remotePath, it.name));
              } else {
                jobs.push({ remotePath: it.remotePath, relativePath: it.name });
              }
            }

            if (jobs.length === 0) return;

            for (let i = 0; i < jobs.length; i++) {
              const job = jobs[i];
              const localPath = path.join(destRoot, ...job.relativePath.split('/'));

              progress.report({
                message: `${job.relativePath} (${i + 1}/${jobs.length})`,
                increment: 100 / jobs.length,
              });

              const decision = await resolveConflict(localPath, job.relativePath);
              if (decision === 'cancel') break;
              if (decision === 'skip') { skipped++; continue; }

              fs.mkdirSync(path.dirname(localPath), { recursive: true });
              await conn.download(job.remotePath, localPath);
              downloaded++;
            }
          }
        );

        await conn.disconnect();

        const parts = [`${downloaded} file(s) downloaded`];
        if (skipped > 0) parts.push(`${skipped} skipped`);
        vscode.window.showInformationMessage(
          `SFTP Helper: ${parts.join(', ')} → ${destRoot}`
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `SFTP Helper: Download failed — ${err.message}`
        );
      }
    })
  );

  vscode.window.showInformationMessage('SFTP Helper activated ✓');
}

function deactivate() {
  if (treeProvider) {
    treeProvider.dispose();
  }
}

module.exports = { activate, deactivate };
