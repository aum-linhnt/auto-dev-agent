import { CodeAnalyzer } from './codeAnalyzer';
import { DbAnalyzer } from './dbAnalyzer';
import { GitAnalyzer } from './gitAnalyzer';
import { UnifiedProjectContext } from '../core/types';
import config from '../config/env';

export interface ContextBuildOptions {
  projectRoot?: string;
  gitDiffTarget?: string;
  skipGit?: boolean;
  skipDb?: boolean;
}

export class ContextBuilder {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || config.paths.projectRoot;
  }

  /**
   * Build complete UnifiedProjectContext from Code, Database, and Git
   */
  public async buildContext(options: ContextBuildOptions = {}): Promise<UnifiedProjectContext> {
    const targetRoot = options.projectRoot || this.projectRoot;
    const timestamp = new Date().toISOString();

    console.log(`[ContextBuilder] Scanning codebase AST at: ${targetRoot}...`);
    const codeAnalyzer = new CodeAnalyzer(targetRoot);
    const code = await codeAnalyzer.analyze();

    let db;
    if (options.skipDb) {
      db = {
        tables: [],
        relationships: [],
        implicitJoins: [],
        isConnected: false,
        summary: 'Database scanning skipped by option.',
      };
    } else {
      console.log(`[ContextBuilder] Analyzing database schema & implicit SQL joins...`);
      const dbAnalyzer = new DbAnalyzer();
      db = await dbAnalyzer.analyze(code.extractedSqls);
    }

    let git;
    if (!options.skipGit) {
      console.log(`[ContextBuilder] Inspecting Git changes...`);
      const gitAnalyzer = new GitAnalyzer(targetRoot);
      git = await gitAnalyzer.analyze(options.gitDiffTarget, code);
    }

    const summary = this.buildUnifiedSummary(code, db, git);

    return {
      timestamp,
      projectRoot: targetRoot,
      code,
      db,
      git,
      summary,
    };
  }

  /**
   * Produce comprehensive unified summary
   */
  private buildUnifiedSummary(code: any, db: any, git?: any): string {
    const sections: string[] = [
      `=== UNIFIED PROJECT CONTEXT ===`,
      `[CODE]: ${code.projectSummary}`,
      `[DATABASE]: ${db.summary}`,
    ];

    if (git) {
      sections.push(`[GIT]: ${git.rawDiffSummary}`);
    }

    return sections.join('\n\n');
  }
}

