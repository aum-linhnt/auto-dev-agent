import fs from 'fs';
import path from 'path';
import config from '../config/env';

export interface WriteFileItem {
  path: string;
  content: string;
}

export interface WriteFileResult {
  filePath: string;
  status: 'created' | 'modified' | 'skipped' | 'dry-run';
  backupPath?: string;
  redirectedFrom?: string;
}

export class FileWriterService {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = path.resolve(baseDir);
  }

  /**
   * Safely write a batch of files with dry-run, read-only protection, and backup support
   */
  public async writeFiles(
    files: WriteFileItem[],
    options: { dryRun?: boolean; createBackup?: boolean } = {}
  ): Promise<WriteFileResult[]> {
    const results: WriteFileResult[] = [];
    const { dryRun = false, createBackup = true } = options;

    for (const file of files) {
      let fullPath = path.isAbsolute(file.path) ? file.path : path.resolve(this.baseDir, file.path);
      let redirectedFrom: string | undefined;

      // STRICT READ-ONLY SAFEGUARD: Never mutate files inside target project when readOnlyProjectRoot is active
      const isTargetingProjectRoot =
        config.paths.projectRoot !== process.cwd() &&
        (fullPath === config.paths.projectRoot || fullPath.startsWith(config.paths.projectRoot + path.sep));

      if (config.readOnlyProjectRoot && isTargetingProjectRoot) {
        const relativeToTarget = path.relative(config.paths.projectRoot, fullPath);
        redirectedFrom = fullPath;
        fullPath = path.resolve(config.paths.outputDir, 'generated_code', relativeToTarget);
        console.warn(
          `[FileWriterService] 🔒 READ-ONLY SAFEGUARD ACTIVE: Target project "${config.paths.projectRoot}" is protected.\n` +
          `   ↳ Prevented write to: ${redirectedFrom}\n` +
          `   ↳ Safely redirected to: ${fullPath}`
        );
      }

      const exists = fs.existsSync(fullPath);

      if (dryRun) {
        results.push({
          filePath: fullPath,
          status: 'dry-run',
          redirectedFrom,
        });
        continue;
      }

      let backupPath: string | undefined;

      // Create backup if modifying existing file
      if (exists && createBackup) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = `${fullPath}.bak.${timestamp}`;
        fs.copyFileSync(fullPath, backupPath);
      }

      // Ensure directory exists
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, file.content, 'utf-8');

      results.push({
        filePath: fullPath,
        status: exists ? 'modified' : 'created',
        backupPath,
        redirectedFrom,
      });
    }

    return results;
  }
}

