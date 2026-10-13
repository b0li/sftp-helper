const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/**
 * Reads the sftp.json config from the workspace .vscode folder.
 * Supports single config or array (multi-profile) — returns first entry or single object.
 */
function readSftpConfig() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return null;
  }

  // Try each workspace folder
  for (const folder of workspaceFolders) {
    const configPath = path.join(folder.uri.fsPath, '.vscode', 'sftp.json');
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8');
        // Remove comments (sftp.json sometimes has // comments)
        const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const parsed = JSON.parse(cleaned);
        // If array, return first entry
        const config = Array.isArray(parsed) ? parsed[0] : parsed;
        config._workspaceFolder = folder.uri.fsPath;
        return config;
      } catch (e) {
        vscode.window.showErrorMessage(`SFTP Helper: Error reading sftp.json: ${e.message}`);
        return null;
      }
    }
  }

  vscode.window.showWarningMessage('SFTP Helper: No .vscode/sftp.json found. Create one with the SFTP extension first.');
  return null;
}

module.exports = { readSftpConfig };
