import fs from 'fs';
import path from 'path';

export interface WriteFileItem {
  path: string;
  content: string;
}

export interface WriteFileResult {
  filePath: string;
  status: 'created' | 'modified' | 'skipped' | 'dry-run';
  backupPath?: string;
}

export class FileWriterService {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = path.resolve(baseDir);
  }

  /**
   * Safely write a batch of files with dry-run and backup support
   */
  public async writeFiles(
    files: WriteFileItem[],
    options: { dryRun?: boolean; createBackup?: boolean } = {}
  ): Promise<WriteFileResult[]> {
    const results: WriteFileResult[] = [];
    const { dryRun = false, createBackup = true } = options;

    for (const file of files) {
      const fullPath = path.isAbsolute(file.path) ? file.path : path.resolve(this.baseDir, file.path);
      const exists = fs.existsSync(fullPath);

      if (dryRun) {
        results.push({
          filePath: fullPath,
          status: 'dry-run',
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
      });
    }

    return results;
  }
}

