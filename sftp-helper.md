# SFTP Helper — VS Code Extension

## Overview

VS Code extension for remote file management via SFTP and FTP. Reads the existing `.vscode/sftp.json` config (Natizyskunk format) and provides a sidebar tree view for browsing, uploading, downloading, renaming, moving, and deleting remote files.

**Publisher:** `lake-studio`
**Current version:** `2.3.0`
**VS Code compatibility:** `^1.80.0`

## Project Structure

```
sftp-helper/
├── package.json          # Extension manifest (commands, menus, views, dependencies)
├── src/
│   ├── extension.js      # Main entry — activate/deactivate, all command registrations
│   ├── config.js         # Reads .vscode/sftp.json from workspace (supports comments, arrays)
│   ├── connection.js     # SFTPConnection class — abstraction over ssh2-sftp-client and basic-ftp
│   └── treeProvider.js   # RemoteTreeProvider (TreeDataProvider + DragAndDropController)
├── package-lock.json
└── .vscodeignore         # (missing — should be created, see TODOs)
```

## Architecture

### Config (`config.js`)
- Reads `.vscode/sftp.json` from the first workspace folder that has one
- Strips `//` and `/* */` comments before parsing (sftp.json often has comments)
- Supports array format (multi-profile) — returns the first entry
- Attaches `_workspaceFolder` to the returned config for local path resolution

### Connection (`connection.js`)
- `SFTPConnection` class wraps both protocols behind a unified API
- Protocol is determined by `config.protocol` (`'sftp'` default, or `'ftp'`)
- **SFTP:** Uses `ssh2-sftp-client`. Supports password, private key (with `~` expansion), and passphrase auth. Falls back to interactive password prompt.
- **FTP:** Uses `basic-ftp`. Supports `secure` (FTPS) with `secureOptions`.
- Unified methods: `connect()`, `disconnect()`, `list()`, `rename()`, `delete()`, `mkdir()`, `download()`, `upload()`, `exists()`
- `exists()` returns `false`, `'d'`, `'-'`, or `'l'` (SFTP native). FTP emulates this via `size()` and `list()` fallback.

### Tree Provider (`treeProvider.js`)
- `RemoteTreeProvider` implements `TreeDataProvider` and `TreeDragAndDropController`
- `RemoteFileItem` extends `TreeItem` — carries `name`, `type`, `remotePath`
- Files get a click command routed through `sftpHelper._onClick` (double-click detector in extension.js)
- Directories are collapsible, files are not
- Connection lifecycle: lazy connect via factory, cached until `refresh()` or error
- **Drag & Drop:**
  - Internal MIME: `application/vnd.sftp-helper.items+json`
  - `handleDrag()`: Serializes selected items as JSON
  - `handleDrop()`: Handles internal moves (with confirmation) and external file uploads (from OS)
  - External drops: Parses `text/uri-list`, falls back to iterating all DataTransfer entries
  - Separates files vs folders via `fs.statSync()`, uploads folders recursively
- `_uploadFileWithCheck()`: Duplicate detection — checks `conn.exists()` before upload, shows modal with Overwrite/Rename/Skip/Overwrite All/Skip All. Rename auto-generates `file(1).ext` pattern. Shared `applyToAll` object for batch operations.

### Extension (`extension.js`)
- `activate()`: Reads config, creates tree provider, registers all commands
- **Connection factory pattern**: Each command creates a fresh connection from current config, then disconnects after use. The tree provider keeps its own cached connection separately.
- **Double-click detector**: Tracks `lastClickPath` + `lastClickTime` with 500ms threshold. Single click = remember, double click = `editLocal`
- **Commands registered:**
  - `sftpHelper._onClick` — internal click router (not in command palette)
  - `sftpHelper.refresh` — re-reads config, refreshes tree
  - `sftpHelper.editLocal` — downloads file to local workspace (mirroring remote path structure), opens in editor
  - `sftpHelper.rename` — input box for new name, uses `conn.rename()`
  - `sftpHelper.delete` — multi-select aware, modal confirmation, recursive for directories
  - `sftpHelper.upload` — file picker dialog, uploads to selected remote folder, duplicate check
  - `sftpHelper.uploadFolder` — folder picker, recursive upload with directory creation, duplicate check
  - `sftpHelper.newFolder` — input box, `conn.mkdir()`
  - `sftpHelper.moveTo` — multi-select aware, input box for destination path, uses `conn.rename()`

## Dependencies

| Package | Purpose |
|---|---|
| `ssh2-sftp-client` ^11.0.0 | SFTP protocol |
| `basic-ftp` ^5.0.5 | FTP/FTPS protocol |

Dev dependencies: `@types/vscode`, `@vscode/vsce` (for packaging)

## Building

```bash
npm install
npm run package    # runs: vsce package --allow-missing-repository
```

Produces `sftp-helper-{version}.vsix`.

## Config Format (sftp.json)

The extension reads the same `.vscode/sftp.json` as the Natizyskunk SFTP extension:

```jsonc
{
  "protocol": "sftp",        // "sftp" (default) or "ftp"
  "host": "example.com",
  "port": 22,                // 22 for SFTP, 21 for FTP
  "username": "user",
  "password": "pass",        // optional — prompts if missing
  "privateKeyPath": "~/.ssh/id_rsa",  // SFTP only, optional
  "passphrase": "...",       // for encrypted keys, optional
  "remotePath": "/var/www",  // root path shown in sidebar
  "secure": false,           // FTP only — enables FTPS
  "secureOptions": {}        // FTP only — TLS options
}
```

## Version History

| Version | Changes |
|---|---|
| 1.0.0 | Initial — sidebar tree, browse, rename, delete, upload file/folder, new folder, edit local |
| 1.1.0 | Minor improvements |
| 1.2.0 | Minor improvements |
| 2.0.0 | FTP/FTPS protocol support alongside SFTP |
| 2.0.1 | FTP bugfix |
| 2.1.0 | Drag & drop (internal tree moves) |
| 2.1.1 | Drag & drop fixes |
| 2.1.2 | Drag & drop fixes |
| 2.2.0 | Multi-select, bulk delete, Move to… command, external drag & drop from OS |
| 2.2.1 | Fixed external drag & drop (added `text/uri-list` to dropMimeTypes) |
| 2.3.0 | Duplicate file detection on upload (Overwrite/Rename/Skip/All variants) |

## TODOs / Known Issues

- **No `.vscodeignore`** — the .vsix bundles all of `node_modules` (13k+ files). Create a `.vscodeignore` to exclude `node_modules` dev files, test files, and old `.vsix` builds.
- **No `.gitignore`** — needs one before pushing to GitHub (exclude `node_modules/`, `*.vsix`, etc.)
- **No README.md** — needs a user-facing README for the GitHub repo / VS Code Marketplace
- **No LICENSE** — needs a license file
- **No tests** — no automated tests exist
- **No bundling** — consider webpack/esbuild to bundle into a single file for smaller .vsix
- **Connection reuse** — each command creates a fresh connection and disconnects. Could pool/reuse connections for faster operations.
- **Multi-profile support** — config reader takes only the first entry from array configs. Could add profile switching.
- **Upload progress** — large file uploads show no per-file byte progress, only file count
- **editLocal** — downloads to workspace but does not auto-upload on save (that's the job of the Natizyskunk extension's watcher)

## Code Conventions

- Plain CommonJS (`require`/`module.exports`), no TypeScript, no bundler
- Path handling: `path.posix` for remote paths, `path` (OS-native) for local paths
- Error handling: try/catch with `vscode.window.showErrorMessage()`, connection reset on tree errors
- All user-facing strings prefixed with `SFTP Helper:`
- German developer, English code and UI strings
