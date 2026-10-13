const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const INTERNAL_MIME = 'application/vnd.sftp-helper.items+json';

class RemoteFileItem extends vscode.TreeItem {
  constructor(name, type, remotePath, collapsibleState) {
    super(name, collapsibleState);
    this.name = name;
    this.type = type;
    this.remotePath = remotePath;
    this.contextValue = type; // 'directory' or 'file'

    if (type === 'file') {
      this.iconPath = new vscode.ThemeIcon('file');
      // Route through double-click detector
      this.command = {
        command: 'sftpHelper._onClick',
        title: 'Click',
        arguments: [this],
      };
    } else {
      this.iconPath = new vscode.ThemeIcon('folder');
    }

    this.tooltip = remotePath;
  }
}

class RemoteTreeProvider {
  constructor(connectionFactory) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._connectionFactory = connectionFactory;
    this._connection = null;
    this._rootPath = '/';
  }

  setRootPath(rootPath) {
    this._rootPath = rootPath || '/';
  }

  refresh() {
    // Drop cached connection so next getChildren reconnects
    this._disconnect();
    this._onDidChangeTreeData.fire(undefined);
  }

  async _ensureConnection() {
    if (!this._connection) {
      this._connection = await this._connectionFactory();
    }
    return this._connection;
  }

  _disconnect() {
    if (this._connection) {
      this._connection.disconnect().catch(() => {});
      this._connection = null;
    }
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    try {
      const conn = await this._ensureConnection();
      const remotePath = element ? element.remotePath : this._rootPath;

      const items = await conn.list(remotePath);

      return items.map(item => {
        const fullPath = remotePath.endsWith('/')
          ? remotePath + item.name
          : remotePath + '/' + item.name;

        const collapsible = item.type === 'directory'
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;

        return new RemoteFileItem(item.name, item.type, fullPath, collapsible);
      });
    } catch (err) {
      // On error, reset connection for next attempt
      this._disconnect();
      vscode.window.showErrorMessage(`SFTP Helper: ${err.message}`);
      return [];
    }
  }

  // ── Drag & Drop ──────────────────────────────────────────

  get dropMimeTypes() {
    return ['text/uri-list', 'files', INTERNAL_MIME];
  }

  get dragMimeTypes() {
    return [INTERNAL_MIME];
  }

  /**
   * Called when items are dragged FROM the tree (internal move).
   */
  handleDrag(source, dataTransfer) {
    const items = source.map(item => ({
      name: item.name,
      type: item.type,
      remotePath: item.remotePath,
    }));
    dataTransfer.set(INTERNAL_MIME, new vscode.DataTransferItem(JSON.stringify(items)));
  }

  /**
   * Called when items are dropped onto a tree item.
   * Handles both external file uploads and internal moves.
   */
  async handleDrop(target, dataTransfer) {
    if (!target || target.type !== 'directory') {
      vscode.window.showWarningMessage('SFTP Helper: Drop onto a folder.');
      return;
    }

    // ── Internal move (drag within tree) ──
    const internalData = dataTransfer.get(INTERNAL_MIME);
    if (internalData) {
      let items;
      try {
        const value = typeof internalData.value === 'string'
          ? internalData.value
          : await internalData.asString();
        items = JSON.parse(value);
      } catch {
        return;
      }

      if (!items || items.length === 0) return;

      // Don't move into itself or its own subtree
      for (const item of items) {
        if (item.remotePath === target.remotePath) return;
        if (item.type === 'directory' && target.remotePath.startsWith(item.remotePath + '/')) {
          vscode.window.showWarningMessage('SFTP Helper: Cannot move a folder into itself.');
          return;
        }
      }

      const label = items.length === 1 ? `"${items[0].name}"` : `${items.length} items`;
      const answer = await vscode.window.showInformationMessage(
        `Move ${label} to "${target.name}"?`,
        { modal: false },
        'Move'
      );
      if (answer !== 'Move') return;

      try {
        const conn = await this._ensureConnection();

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'SFTP Helper: Moving...',
            cancellable: false,
          },
          async (progress) => {
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const newPath = target.remotePath.endsWith('/')
                ? target.remotePath + item.name
                : target.remotePath + '/' + item.name;

              progress.report({
                message: `${item.name} (${i + 1}/${items.length})`,
                increment: 100 / items.length,
              });

              await conn.rename(item.remotePath, newPath);
            }
          }
        );

        vscode.window.showInformationMessage(
          `SFTP Helper: ${items.length} item(s) moved.`
        );
        this._onDidChangeTreeData.fire(undefined); // full refresh
      } catch (err) {
        this._disconnect();
        vscode.window.showErrorMessage(`SFTP Helper: Move failed — ${err.message}`);
      }
      return;
    }

    // ── External file upload (drag from OS / Explorer) ──
    // Try text/uri-list first, then fall back to iterating all entries
    let uris = [];

    const uriList = dataTransfer.get('text/uri-list');
    if (uriList) {
      // Value may be a string or need async resolution
      let raw;
      try {
        raw = typeof uriList.value === 'string' ? uriList.value : await uriList.asString();
      } catch {
        raw = '';
      }
      uris = raw
        .split(/[\r\n]+/)
        .map(u => u.trim())
        .filter(u => u.length > 0 && !u.startsWith('#'))
        .map(u => vscode.Uri.parse(u));
    }

    // If text/uri-list gave nothing, try to find file URIs in other entries
    if (uris.length === 0) {
      for (const [mime, item] of dataTransfer) {
        if (mime === INTERNAL_MIME) continue;
        try {
          const raw = typeof item.value === 'string' ? item.value : await item.asString();
          if (raw && (raw.includes('file://') || raw.includes('/'))) {
            const parsed = raw
              .split(/[\r\n]+/)
              .map(u => u.trim())
              .filter(u => u.length > 0 && !u.startsWith('#'))
              .map(u => vscode.Uri.parse(u))
              .filter(u => u.scheme === 'file');
            uris.push(...parsed);
          }
        } catch {
          // skip unreadable entries
        }
      }
    }

    if (uris.length === 0) {
      vscode.window.showWarningMessage('SFTP Helper: No files found in drop.');
      return;
    }

    try {
      const conn = await this._ensureConnection();

      // Separate files and folders
      const files = [];
      const folders = [];
      for (const uri of uris) {
        try {
          const stat = fs.statSync(uri.fsPath);
          if (stat.isDirectory()) {
            folders.push(uri);
          } else {
            files.push(uri);
          }
        } catch {
          files.push(uri); // assume file if stat fails
        }
      }

      let totalUploaded = 0;
      let totalSkipped = 0;
      const applyToAll = {}; // shared across batch for "Overwrite All" / "Skip All"

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'SFTP Helper: Uploading...',
          cancellable: false,
        },
        async (progress) => {
          // Upload individual files
          for (let i = 0; i < files.length; i++) {
            const uri = files[i];
            const fileName = path.basename(uri.fsPath);
            const remoteDest = target.remotePath.endsWith('/')
              ? target.remotePath + fileName
              : target.remotePath + '/' + fileName;

            progress.report({ message: fileName });
            const result = await this._uploadFileWithCheck(conn, uri.fsPath, remoteDest, applyToAll);
            if (result === 'skipped') {
              totalSkipped++;
            } else {
              totalUploaded++;
            }
          }

          // Upload folders recursively
          for (const folderUri of folders) {
            const localFolder = folderUri.fsPath;
            const folderName = path.basename(localFolder);
            const remoteBase = target.remotePath.endsWith('/')
              ? target.remotePath + folderName
              : target.remotePath + '/' + folderName;

            // Collect all files recursively
            const allFiles = [];
            const collectFiles = (dir, relative) => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
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
            collectFiles(localFolder, '');

            // Create directories
            await conn.mkdir(remoteBase);
            const dirs = new Set();
            for (const f of allFiles) {
              const parts = f.relativePath.split('/');
              for (let i = 1; i < parts.length; i++) {
                dirs.add(parts.slice(0, i).join('/'));
              }
            }
            for (const dir of [...dirs].sort()) {
              await conn.mkdir(remoteBase + '/' + dir);
            }

            // Upload files with conflict check
            for (const file of allFiles) {
              progress.report({ message: `${folderName}/${file.relativePath}` });
              const result = await this._uploadFileWithCheck(
                conn, file.localPath, remoteBase + '/' + file.relativePath, applyToAll
              );
              if (result === 'skipped') {
                totalSkipped++;
              } else {
                totalUploaded++;
              }
            }
          }
        }
      );

      const parts = [`${totalUploaded} file(s) uploaded`];
      if (totalSkipped > 0) parts.push(`${totalSkipped} skipped`);
      vscode.window.showInformationMessage(`SFTP Helper: ${parts.join(', ')}.`);
      this._onDidChangeTreeData.fire(target);
    } catch (err) {
      this._disconnect();
      vscode.window.showErrorMessage(`SFTP Helper: Upload failed — ${err.message}`);
    }
  }

  /**
   * Upload a single file with duplicate check.
   * Returns: 'uploaded', 'renamed', 'skipped'
   * applyToAll: { action: 'overwrite'|'rename'|'skip' } — shared across batch
   */
  async _uploadFileWithCheck(conn, localPath, remoteDest, applyToAll) {
    const fileName = path.basename(remoteDest);

    // Check if file exists on server
    const exists = await conn.exists(remoteDest);

    if (exists) {
      let action;

      if (applyToAll.action) {
        action = applyToAll.action;
      } else {
        const choice = await vscode.window.showWarningMessage(
          `"${fileName}" already exists on the server.`,
          { modal: true },
          'Overwrite',
          'Rename',
          'Skip',
          'Overwrite All',
          'Skip All'
        );

        if (!choice || choice === 'Skip') {
          return 'skipped';
        } else if (choice === 'Skip All') {
          applyToAll.action = 'skip';
          return 'skipped';
        } else if (choice === 'Overwrite All') {
          applyToAll.action = 'overwrite';
          action = 'overwrite';
        } else if (choice === 'Overwrite') {
          action = 'overwrite';
        } else if (choice === 'Rename') {
          action = 'rename';
        }
      }

      if (action === 'skip') {
        return 'skipped';
      }

      if (action === 'rename') {
        // Generate unique name: file(1).ext, file(2).ext, ...
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        const dir = path.posix.dirname(remoteDest);
        let counter = 1;
        let newDest;
        do {
          newDest = path.posix.join(dir, `${base}(${counter})${ext}`);
          counter++;
        } while (await conn.exists(newDest));

        await conn.upload(localPath, newDest);
        return 'renamed';
      }
    }

    // Overwrite or no conflict
    await conn.upload(localPath, remoteDest);
    return 'uploaded';
  }

  dispose() {
    this._disconnect();
  }
}

module.exports = { RemoteTreeProvider, RemoteFileItem };
