import { execaSync } from 'execa';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import prompts from 'prompts';
import https from 'https';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class FzfDetector {
  constructor(config = {}) {
    this.config = config;
    this.fzfPath = null;
    this.isAvailable = false;
    this.installPath = this.expandPath(config.completion?.fzf?.install_path || '~/.fzf');
  }

  expandPath(filePath) {
    if (!filePath) return filePath;
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
  }

  async detect() {
    const fzfConfig = this.config.completion?.fzf || {};
    
    // If explicitly disabled, don't detect
    if (fzfConfig.enabled === false) {
      if (process.env.AISH_DEBUG) {
        console.log(chalk.gray('[DEBUG] FZF explicitly disabled in config'));
      }
      return { available: false, path: null, source: 'disabled' };
    }

    // If path is explicitly configured
    if (fzfConfig.path && fzfConfig.path !== 'auto') {
      const explicitPath = this.expandPath(fzfConfig.path);
      if (await this.checkFzfPath(explicitPath)) {
        this.fzfPath = explicitPath;
        this.isAvailable = true;
        return { available: true, path: explicitPath, source: 'config' };
      } else {
        console.warn(chalk.yellow(`Warning: Configured fzf path not found: ${explicitPath}`));
      }
    }

    // 1. Check if fzf is on PATH
    try {
      const result = execaSync('which', ['fzf'], { shell: false });
      if (result.stdout) {
        this.fzfPath = result.stdout.trim();
        this.isAvailable = true;
        if (process.env.AISH_DEBUG) {
          console.log(chalk.gray(`[DEBUG] Found fzf on PATH: ${this.fzfPath}`));
        }
        return { available: true, path: this.fzfPath, source: 'system' };
      }
    } catch {
      // Not on PATH, continue checking
    }

    // 2. Check if ~/.fzf/bin/fzf exists
    const homeFzfPath = path.join(os.homedir(), '.fzf', 'bin', 'fzf');
    if (await this.checkFzfPath(homeFzfPath)) {
      this.fzfPath = homeFzfPath;
      this.isAvailable = true;
      if (process.env.AISH_DEBUG) {
        console.log(chalk.gray(`[DEBUG] Found fzf in ~/.fzf: ${this.fzfPath}`));
      }
      return { available: true, path: this.fzfPath, source: 'home' };
    }

    // 3. Not found - offer to install if configured
    if (fzfConfig.install_offer !== false && fzfConfig.enabled !== false) {
      const installed = await this.offerInstallation();
      if (installed) {
        return { available: true, path: this.fzfPath, source: 'installed' };
      }
    }

    return { available: false, path: null, source: 'not_found' };
  }

  async checkFzfPath(fzfPath) {
    try {
      await fs.access(fzfPath, fs.constants.X_OK);
      // Verify it's actually fzf by running --version
      const result = execaSync(fzfPath, ['--version'], { shell: false });
      return result.stdout && result.stdout.includes('fzf') || result.stdout.includes('(');
    } catch {
      return false;
    }
  }

  async offerInstallation() {
    console.log(chalk.cyan('\nFZF (fuzzy finder) is not installed.'));
    console.log(chalk.gray('FZF enhances history search and file navigation in aish.'));
    
    const response = await prompts({
      type: 'confirm',
      name: 'install',
      message: 'Would you like to install fzf?',
      initial: true
    });

    if (!response.install) {
      console.log(chalk.gray('You can install fzf later or configure its path in ~/.config/aish/config.yaml'));
      return false;
    }

    const spinner = ora('Installing fzf...').start();
    
    try {
      await this.installFzf();
      spinner.succeed('FZF installed successfully!');
      return true;
    } catch (error) {
      spinner.fail('Failed to install fzf');
      console.error(chalk.red('Error:'), error.message);
      console.log(chalk.gray('You can try installing fzf manually:'));
      console.log(chalk.gray('  - On macOS: brew install fzf'));
      console.log(chalk.gray('  - On Linux: Check your package manager or visit https://github.com/junegunn/fzf'));
      return false;
    }
  }

  async installFzf() {
    // Create installation directory
    const binDir = path.join(this.installPath, 'bin');
    await fs.mkdir(binDir, { recursive: true });

    // Detect architecture and OS
    const platform = os.platform();
    const arch = os.arch();
    
    let downloadUrl;
    let filename = 'fzf';
    
    // Determine download URL based on platform
    if (platform === 'darwin') {
      if (arch === 'arm64') {
        downloadUrl = 'https://github.com/junegunn/fzf/releases/latest/download/fzf-darwin_arm64.zip';
      } else {
        downloadUrl = 'https://github.com/junegunn/fzf/releases/latest/download/fzf-darwin_amd64.zip';
      }
    } else if (platform === 'linux') {
      if (arch === 'arm64' || arch === 'aarch64') {
        downloadUrl = 'https://github.com/junegunn/fzf/releases/latest/download/fzf-linux_arm64.tar.gz';
      } else {
        downloadUrl = 'https://github.com/junegunn/fzf/releases/latest/download/fzf-linux_amd64.tar.gz';
      }
    } else if (platform === 'win32') {
      filename = 'fzf.exe';
      downloadUrl = 'https://github.com/junegunn/fzf/releases/latest/download/fzf-windows_amd64.zip';
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // Download the binary
    const tempFile = path.join(binDir, `fzf-download-${Date.now()}`);
    await this.downloadFile(downloadUrl, tempFile);

    // Extract based on file type
    const fzfPath = path.join(binDir, filename);
    if (downloadUrl.endsWith('.zip')) {
      await execAsync(`unzip -o "${tempFile}" -d "${binDir}" && rm "${tempFile}"`);
    } else if (downloadUrl.endsWith('.tar.gz')) {
      await execAsync(`tar -xzf "${tempFile}" -C "${binDir}" && rm "${tempFile}"`);
    }

    // Make executable
    await fs.chmod(fzfPath, 0o755);

    // Also download shell integration scripts
    const shellDir = path.join(this.installPath, 'shell');
    await fs.mkdir(shellDir, { recursive: true });
    
    const shellFiles = ['key-bindings.zsh', 'key-bindings.bash', 'key-bindings.fish', 'completion.zsh', 'completion.bash'];
    for (const file of shellFiles) {
      try {
        const url = `https://raw.githubusercontent.com/junegunn/fzf/master/shell/${file}`;
        const dest = path.join(shellDir, file);
        await this.downloadFile(url, dest);
      } catch {
        // Some files might not exist, that's okay
      }
    }

    this.fzfPath = fzfPath;
    this.isAvailable = true;
  }

  async downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'aish' } }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        const fileStream = createWriteStream(dest);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(dest).catch(() => {});
          reject(err);
        });
      }).on('error', reject);
    });
  }

  // Get the path to add to PATH environment variable
  getFzfBinPath() {
    if (!this.fzfPath) return null;
    return path.dirname(this.fzfPath);
  }
}