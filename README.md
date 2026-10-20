# SFTP Helper — Rename & Upload for VS Code

A lightweight VS Code extension that adds a **remote file browser** for **SFTP and FTP/FTPS** right in the sidebar — browse, upload, download, rename, move, delete and create files/folders on your server, without leaving the editor.

It reads the **same `.vscode/sftp.json`** that the popular [Natizyskunk SFTP](https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp) extension uses, so you can drop it alongside your existing setup — no extra config.

> **Why?** Natizyskunk SFTP is great for sync/upload-on-save, but it has no real remote file *management* UI. SFTP Helper fills that gap: a proper tree view where you can rename, move, delete, download and drag & drop — the things a desktop FTP client gives you, inside VS Code.

---

## Features

- **Sidebar tree view** of the remote filesystem (SFTP or FTP/FTPS)
- **Download** files and folders (recursive) to any local folder, with overwrite handling
- **Upload** files and folders (recursive) with duplicate detection (Overwrite / Rename / Skip / …-All)
- **Rename**, **Move to…**, **Delete** — multi-select aware, recursive for folders
- **New File** / **New Folder** — in any folder *or at the root* (toolbar buttons)
- **Drag & drop** — move items inside the tree, or drop files from your OS to upload
- **Keyboard shortcuts** — Delete and Rename like the native Explorer
- Works with **SFTP** (password / private key / passphrase) and **FTP / FTPS**

### Keyboard shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| Delete | <kbd>Fn</kbd>+<kbd>Delete</kbd> / <kbd>⌘</kbd>+<kbd>⌫</kbd> / <kbd>⌫</kbd> | <kbd>Delete</kbd> / <kbd>Backspace</kbd> |
| Rename | <kbd>Fn</kbd>+<kbd>F2</kbd> | <kbd>F2</kbd> |

*(active when the SFTP Helper tree has focus)*

---

## Installation

This extension is distributed as a `.vsix` (not on the Marketplace).

1. Download the latest `sftp-helper-x.y.z.vsix` from the [**Releases**](https://github.com/b0li/sftp-helper/releases) page.
2. In VS Code: **Extensions** panel → `…` menu → **Install from VSIX…** → pick the file.
   Or via CLI:
   ```bash
   code --install-extension sftp-helper-x.y.z.vsix
   ```

### Or build from source

```bash
git clone https://github.com/b0li/sftp-helper.git
cd sftp-helper
npm install
npm run package   # produces sftp-helper-{version}.vsix
```

---

## Setup

SFTP Helper activates as soon as your workspace contains a `.vscode/sftp.json`. It uses the same format as Natizyskunk SFTP:

```jsonc
{
  "protocol": "sftp",                 // "sftp" (default) or "ftp"
  "host": "example.com",
  "port": 22,                         // 22 for SFTP, 21 for FTP
  "username": "user",
  "password": "pass",                 // optional — prompts if missing
  "privateKeyPath": "~/.ssh/id_rsa",  // SFTP only, optional
  "passphrase": "...",                // for encrypted keys, optional
  "remotePath": "/var/www",           // root path shown in the sidebar
  "secure": false,                    // FTP only — enables FTPS
  "secureOptions": {}                 // FTP only — TLS options
}
```

Multi-profile (array) configs are supported — the first entry is used.

Open the **SFTP Helper** view from the Activity Bar (cloud-upload icon) to see your remote files.

---

## Commands

All commands are prefixed with `SFTP Helper:` and available via the tree's context menu / title bar.

| Command | Where | What it does |
|---|---|---|
| `Edit in Local` | file (double-click) | Downloads the file into the workspace and opens it |
| `Download to…` | file / folder | Downloads selection to a chosen local folder (recursive) |
| `Upload File Here` | folder | Uploads a picked file into the folder |
| `Upload Folder Here` | folder | Uploads a picked folder (recursive) |
| `New File` | folder / toolbar | Creates an empty file and opens it |
| `New Folder` | folder / toolbar | Creates a folder |
| `Rename` | file / folder | Renames (also <kbd>F2</kbd>) |
| `Move to…` | file / folder | Moves to a remote path (multi-select) |
| `Delete` | file / folder | Deletes (also <kbd>Delete</kbd>, multi-select, recursive) |
| `Refresh` | toolbar | Re-reads config and reloads the tree |

---

## Relationship to Natizyskunk SFTP

SFTP Helper is **complementary**, not a replacement:

- Keep **Natizyskunk SFTP** for `uploadOnSave` and sync workflows.
- Use **SFTP Helper** for the remote **file management** UI (browse / rename / move / delete / download / drag & drop).

Both read the same `.vscode/sftp.json`, so no duplicate configuration.

> Note: `Edit in Local` only **downloads** a file; it does not auto-upload on save. Saving-to-server is handled by Natizyskunk's watcher (`"uploadOnSave": true`).

---

## Requirements

- VS Code `^1.80.0`
- Node dependencies (bundled in the `.vsix`): [`ssh2-sftp-client`](https://www.npmjs.com/package/ssh2-sftp-client), [`basic-ftp`](https://www.npmjs.com/package/basic-ftp)

## License

[GPLv2](LICENSE) © Markus Bäck · [lake-studio.de](https://www.lake-studio.de)
