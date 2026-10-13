# SFTP Helper — Rename & Upload

VS Code extension for remote file management via **SFTP and FTP**. It reads your existing `.vscode/sftp.json` config (Natizyskunk format) and adds a sidebar tree view for browsing, uploading, downloading, renaming, moving, and deleting remote files.

- **Publisher:** `lake-studio`
- **Version:** 2.6.0
- **VS Code:** `^1.80.0`

## Features

- Sidebar tree view of the remote filesystem (SFTP or FTP/FTPS)
- Browse directories, open files locally (`Edit in Local` via double-click)
- Rename, move, delete (multi-select, recursive for folders)
  — delete also via keyboard (<kbd>Delete</kbd> / <kbd>Cmd</kbd>+<kbd>Backspace</kbd>) when the tree is focused
- Download files and folders (recursive) to a chosen local folder, with overwrite check
- Upload files and folders (recursive) with duplicate detection
  (Overwrite / Rename / Skip / Overwrite All / Skip All)
- Drag & drop: internal moves inside the tree, and external upload from the OS
- Create new files and folders

## Config

The extension reads the same `.vscode/sftp.json` as the Natizyskunk SFTP extension:

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

Array format (multi-profile) is supported; the first entry is used.

## Commands

All commands are prefixed with `SFTP Helper:` — `Edit in Local`, `Rename`,
`Download to...`, `Move to...`, `Delete`, `Upload File Here`,
`Upload Folder Here`, `New File`, `New Folder`, `Refresh`.

## Build

```bash
npm install
npm run package   # vsce package --allow-missing-repository
```

Produces `sftp-helper-{version}.vsix`, installable via VS Code's *Install from VSIX…*.

## License

GPLv2 — see [LICENSE](LICENSE).
