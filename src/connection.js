const vscode = require('vscode');
const SftpClient = require('ssh2-sftp-client');
const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs');
const os = require('os');

class SFTPConnection {
  constructor(config) {
    this.config = config;
    this.protocol = (config.protocol || 'sftp').toLowerCase();
    this.client = null;
  }

  async connect() {
    if (this.protocol === 'sftp') {
      return this._connectSftp();
    } else {
      return this._connectFtp();
    }
  }

  async _connectSftp() {
    this.client = new SftpClient();
    const opts = {
      host: this.config.host,
      port: this.config.port || 22,
      username: this.config.username,
    };

    if (this.config.privateKeyPath) {
      let keyPath = this.config.privateKeyPath;
      if (keyPath.startsWith('~')) {
        keyPath = path.join(os.homedir(), keyPath.slice(1));
      }
      opts.privateKey = fs.readFileSync(keyPath, 'utf8');
      if (this.config.passphrase) {
        opts.passphrase = this.config.passphrase;
      }
    } else if (this.config.password) {
      opts.password = this.config.password;
    } else {
      // Ask for password
      const pw = await vscode.window.showInputBox({
        prompt: `Password for ${this.config.username}@${this.config.host}`,
        password: true,
      });
      if (!pw) throw new Error('No password provided');
      opts.password = pw;
    }

    await this.client.connect(opts);
    return this;
  }

  async _connectFtp() {
    this.client = new ftp.Client();
    this.client.ftp.verbose = false;

    const secure = this.config.secure || false;

    await this.client.access({
      host: this.config.host,
      port: this.config.port || 21,
      user: this.config.username,
      password: this.config.password || await this._askPassword(),
      secure,
      secureOptions: this.config.secureOptions || { rejectUnauthorized: false },
    });

    return this;
  }

  async _askPassword() {
    const pw = await vscode.window.showInputBox({
      prompt: `Password for ${this.config.username}@${this.config.host}`,
      password: true,
    });
    if (!pw) throw new Error('No password provided');
    return pw;
  }

  async list(remotePath) {
    if (this.protocol === 'sftp') {
      const items = await this.client.list(remotePath);
      return items
        .filter(i => i.name !== '.' && i.name !== '..')
        .map(i => ({
          name: i.name,
          type: i.type === 'd' ? 'directory' : 'file',
          size: i.size,
          modifyTime: i.modifyTime,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } else {
      const items = await this.client.list(remotePath);
      return items
        .filter(i => i.name !== '.' && i.name !== '..')
        .map(i => ({
          name: i.name,
          type: i.isDirectory ? 'directory' : 'file',
          size: i.size,
          modifyTime: i.modifiedAt,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    }
  }

  async rename(oldPath, newPath) {
    if (this.protocol === 'sftp') {
      await this.client.rename(oldPath, newPath);
    } else {
      await this.client.rename(oldPath, newPath);
    }
  }

  async delete(remotePath, isDirectory) {
    if (this.protocol === 'sftp') {
      if (isDirectory) {
        await this.client.rmdir(remotePath, true);
      } else {
        await this.client.delete(remotePath);
      }
    } else {
      if (isDirectory) {
        await this.client.removeDir(remotePath);
      } else {
        await this.client.remove(remotePath);
      }
    }
  }

  async mkdir(remotePath) {
    if (this.protocol === 'sftp') {
      await this.client.mkdir(remotePath, true);
    } else {
      await this.client.ensureDir(remotePath);
    }
  }

  async download(remotePath, localPath) {
    if (this.protocol === 'sftp') {
      await this.client.fastGet(remotePath, localPath);
    } else {
      await this.client.downloadTo(localPath, remotePath);
    }
  }

  /**
   * Check if a remote path exists. Returns 'file', 'directory', or false.
   */
  async exists(remotePath) {
    if (this.protocol === 'sftp') {
      return await this.client.exists(remotePath); // returns false, 'd', '-', 'l'
    } else {
      // FTP: try to get size (file) or list (directory)
      try {
        await this.client.size(remotePath);
        return '-'; // file exists
      } catch {
        try {
          await this.client.list(remotePath);
          return 'd'; // directory exists
        } catch {
          return false;
        }
      }
    }
  }

  async upload(localPath, remotePath) {
    if (this.protocol === 'sftp') {
      await this.client.put(localPath, remotePath);
    } else {
      await this.client.uploadFrom(localPath, remotePath);
    }
  }

  async disconnect() {
    try {
      if (this.protocol === 'sftp' && this.client) {
        await this.client.end();
      } else if (this.client) {
        this.client.close();
      }
    } catch (e) {
      // ignore disconnect errors
    }
    this.client = null;
  }
}

module.exports = { SFTPConnection };
