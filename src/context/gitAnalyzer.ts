import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import {
  GitContext,
  GitFileDiff,
  GitHunk,
  AffectedElement,
  CodeContext,
} from '../core/types';

export class GitAnalyzer {
  private git: SimpleGit;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    this.git = simpleGit(this.projectRoot);
  }

  /**
   * Analyze git status, extract diff, and determine affected code elements
   */
  public async analyze(targetCommitOrBranch?: string, codeContext?: CodeContext): Promise<GitContext | undefined> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      return undefined;
    }

    try {
      const status = await this.git.status();
      const branchSummary = await this.git.branch();
      const currentBranch = branchSummary.current || 'unknown';

      let commitHash = 'HEAD';
      try {
        const log = await this.git.log({ maxCount: 1 });
        if (log.latest) {
          commitHash = log.latest.hash.substring(0, 8);
        }
      } catch {
        commitHash = 'initial';
      }

      // Determine diff arguments
      let diffOutput = '';
      if (targetCommitOrBranch) {
        diffOutput = await this.git.diff([targetCommitOrBranch]);
      } else {
        // Working tree diff (staged + unstaged)
        const unstagedDiff = await this.git.diff();
        const stagedDiff = await this.git.diff(['--cached']);
        diffOutput = unstagedDiff + '\n' + stagedDiff;

        // If no working tree diff, compare with HEAD~1 if exists
        if (!diffOutput.trim()) {
          try {
            diffOutput = await this.git.diff(['HEAD~1']);
          } catch {
            // Only 1 commit or clean working tree
            diffOutput = '';
          }
        }
      }

      const changedFiles = this.parseDiff(diffOutput);
      const affectedElements = codeContext ? this.findAffectedElements(changedFiles, codeContext) : [];

      const rawDiffSummary = this.buildSummary(currentBranch, commitHash, changedFiles, affectedElements);

      return {
        branch: currentBranch,
        commitHash,
        baseBranch: targetCommitOrBranch,
        changedFiles,
        affectedElements,
        rawDiffSummary,
      };
    } catch (err: any) {
      console.warn(`[GitAnalyzer] Git analysis encountered an issue: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Parse unified git diff output into structured file diffs and hunks
   */
  private parseDiff(diffText: string): GitFileDiff[] {
    const files: GitFileDiff[] = [];
    if (!diffText.trim()) return files;

    const fileChunks = diffText.split(/^diff --git /m).filter((c) => c.trim().length > 0);

    for (const chunk of fileChunks) {
      const lines = chunk.split('\n');
      const headerLine = lines[0] || '';
      const pathMatch = headerLine.match(/a\/(.*?)\s+b\/(.*)/);
      const filePath = pathMatch ? pathMatch[2] : headerLine.split(' ')[1] || 'unknown';

      let status: GitFileDiff['status'] = 'modified';
      if (chunk.includes('new file mode')) status = 'added';
      else if (chunk.includes('deleted file mode')) status = 'deleted';

      const hunks: GitHunk[] = [];
      let currentHunk: GitHunk | null = null;
      let additions = 0;
      let deletions = 0;

      for (const line of lines) {
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
          if (currentHunk) hunks.push(currentHunk);
          currentHunk = {
            oldStart: parseInt(hunkMatch[1], 10),
            oldLines: parseInt(hunkMatch[2] || '1', 10),
            newStart: parseInt(hunkMatch[3], 10),
            newLines: parseInt(hunkMatch[4] || '1', 10),
            lines: [],
          };
          continue;
        }

        if (currentHunk) {
          currentHunk.lines.push(line);
          if (line.startsWith('+') && !line.startsWith('+++')) additions++;
          if (line.startsWith('-') && !line.startsWith('---')) deletions++;
        }
      }
      if (currentHunk) hunks.push(currentHunk);

      files.push({
        filePath,
        status,
        additions,
        deletions,
        hunks,
        diffText: chunk,
      });
    }

    return files;
  }

  /**
   * Cross-reference diff line numbers with AST elements to locate impacted code
   */
  private findAffectedElements(changedFiles: GitFileDiff[], codeContext: CodeContext): AffectedElement[] {
    const affected: AffectedElement[] = [];

    for (const fileDiff of changedFiles) {
      // Collect modified line ranges
      const modifiedLines: number[] = [];
      for (const hunk of fileDiff.hunks) {
        let currentLine = hunk.newStart;
        for (const line of hunk.lines) {
          if (line.startsWith('+') || line.startsWith(' ')) {
            modifiedLines.push(currentLine);
            currentLine++;
          }
        }
      }

      // Normalize file paths for cross-referencing
      const normDiffPath = fileDiff.filePath.replace(/\\/g, '/');

      // Check Endpoints
      for (const ep of codeContext.endpoints) {
        const normEpPath = ep.filePath.replace(/\\/g, '/');
        if (normDiffPath.endsWith(normEpPath) || normEpPath.endsWith(normDiffPath)) {
          if (modifiedLines.some((l) => Math.abs(l - ep.line) <= 10)) {
            affected.push({
              type: 'endpoint',
              name: `${ep.method} ${ep.path}`,
              filePath: ep.filePath,
              lineRange: { start: ep.line, end: ep.line + 5 },
            });
          }
        }
      }

      // Check Functions / Methods
      for (const fn of codeContext.functions) {
        const normFnPath = fn.filePath.replace(/\\/g, '/');
        if (normDiffPath.endsWith(normFnPath) || normFnPath.endsWith(normDiffPath)) {
          const overlaps = modifiedLines.some((l) => l >= fn.startLine && l <= fn.endLine);
          if (overlaps) {
            affected.push({
              type: 'function',
              name: fn.name,
              filePath: fn.filePath,
              lineRange: { start: fn.startLine, end: fn.endLine },
            });
          }
        }
      }

      // Check Classes
      for (const cls of codeContext.classes) {
        const normClsPath = cls.filePath.replace(/\\/g, '/');
        if (normDiffPath.endsWith(normClsPath) || normClsPath.endsWith(normDiffPath)) {
          for (const method of cls.methods) {
            const overlaps = modifiedLines.some((l) => l >= method.startLine && l <= method.endLine);
            if (overlaps) {
              affected.push({
                type: 'method',
                name: `${cls.name}.${method.name}`,
                filePath: cls.filePath,
                lineRange: { start: method.startLine, end: method.endLine },
              });
            }
          }
        }
      }
    }

    return affected;
  }

  private buildSummary(
    branch: string,
    commitHash: string,
    files: GitFileDiff[],
    affected: AffectedElement[]
  ): string {
    const totalAdd = files.reduce((acc, f) => acc + f.additions, 0);
    const totalDel = files.reduce((acc, f) => acc + f.deletions, 0);
    return (
      `Git Changes Overview:\n` +
      `- Branch: ${branch} (Commit: ${commitHash})\n` +
      `- Changed Files: ${files.length} files (+${totalAdd} / -${totalDel})\n` +
      `- Affected Code Elements: ${affected.length} (${affected.map((a) => `${a.type}:${a.name}`).slice(0, 5).join(', ')}${affected.length > 5 ? '...' : ''})`
    );
  }
}

