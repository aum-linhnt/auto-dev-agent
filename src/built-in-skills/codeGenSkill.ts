import path from 'path';
import { Project, ts } from 'ts-morph';
import {
  ISkill,
  SkillInput,
  SkillResult,
  UnifiedProjectContext,
  SkillArtifact,
} from '../core/types';
import { LlmService } from '../services/llmService';
import { FileWriterService, WriteFileItem } from '../services/fileWriterService';

interface GeneratedCodeResponse {
  featureName: string;
  files: Array<{
    path: string;
    content: string;
    description?: string;
  }>;
  summary: string;
}

export class CodeGenSkill implements ISkill {
  public id = 'code-gen';
  public name = 'Fullstack Code Generator';
  public description =
    'Generates production-ready Routes, Controllers, Services, Models/Queries, and Frontend components strictly adhering to project conventions, database schema, and AST patterns with in-memory TypeScript compile checks.';
  public version = '1.0.0';
  public type: 'built-in' = 'built-in';

  private llmService: LlmService;
  private fileWriter: FileWriterService;

  constructor() {
    this.llmService = new LlmService();
    this.fileWriter = new FileWriterService();
  }

  public async execute(context: UnifiedProjectContext, input: SkillInput): Promise<SkillResult> {
    const featureName = input.featureName || 'NewFeature';
    console.log(`[CodeGenSkill] Generating code for feature: ${featureName}...`);

    // 1. Build prompt incorporating AST conventions + DB Schema
    const prompt = this.buildPrompt(context, input, featureName);

    // 2. Call Gemini Structured Output
    console.log(`[CodeGenSkill] Calling Gemini for code generation...`);
    const codeResponse = await this.llmService.generateStructured<GeneratedCodeResponse>({
      prompt,
      systemInstruction:
        'You are a Senior Principal TypeScript Engineer. You write clean, modular, production-ready code with comprehensive error handling, strong types, and database safety adhering strictly to the provided project conventions.',
    });

    if (!codeResponse.files || codeResponse.files.length === 0) {
      throw new Error(`Code generation failed: No files returned by LLM.`);
    }

    // 3. In-memory TypeScript compilation & syntax check using ts-morph
    console.log(`[CodeGenSkill] Running in-memory TypeScript compilation check on generated files...`);
    const compileResult = this.verifyTypeScriptCompilation(codeResponse.files);

    const errors: string[] = [];
    if (!compileResult.passed) {
      console.warn(`[CodeGenSkill] Compilation warnings/errors detected:`, compileResult.diagnostics);
      errors.push(...compileResult.diagnostics);
    } else {
      console.log(`[CodeGenSkill] In-memory TypeScript verification PASSED.`);
    }

    // 4. Write files to disk (or dry-run)
    const filesToWrite: WriteFileItem[] = codeResponse.files.map((f) => ({
      path: path.resolve(context.projectRoot, f.path),
      content: f.content,
    }));

    const isDryRun = !!input.dryRun;
    console.log(`[CodeGenSkill] Writing ${filesToWrite.length} files (dryRun: ${isDryRun})...`);
    const writeResults = await this.fileWriter.writeFiles(filesToWrite, {
      dryRun: isDryRun,
      createBackup: true,
    });

    const artifacts: SkillArtifact[] = writeResults.map((r) => ({
      type: 'code',
      filePath: r.filePath,
      description: `Status: ${r.status}${r.backupPath ? ` (Backup: ${r.backupPath})` : ''}`,
    }));

    return {
      success: true,
      skillName: this.name,
      message: `Đã sinh thành công ${filesToWrite.length} tệp mã nguồn cho tính năng "${featureName}" (${isDryRun ? 'DRY-RUN' : 'Đã ghi ra đĩa'}).`,
      artifacts,
      data: {
        featureName,
        files: writeResults,
        compilationPassed: compileResult.passed,
        diagnostics: compileResult.diagnostics,
        summary: codeResponse.summary,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Run in-memory TS compilation check on generated files
   */
  private verifyTypeScriptCompilation(files: Array<{ path: string; content: string }>): {
    passed: boolean;
    diagnostics: string[];
  } {
    const diagnosticsList: string[] = [];

    try {
      const project = new Project({
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          noEmit: true,
          skipLibCheck: true,
          noImplicitAny: false,
          strictNullChecks: false,
        },
      });

      for (const file of files) {
        project.createSourceFile(file.path, file.content, { overwrite: true });
      }

      const preEmitDiagnostics = project.getPreEmitDiagnostics();

      for (const diag of preEmitDiagnostics) {
        const file = diag.getSourceFile();
        const line = diag.getLineNumber();
        const message = diag.getMessageText();
        const msgStr = typeof message === 'string' ? message : message.getMessageText();

        // Filter out unresolved module imports (since other project files or node_modules might not be in this memory sandbox)
        if (msgStr.includes('Cannot find module') || msgStr.includes('Cannot find name')) {
          continue;
        }

        diagnosticsList.push(`${file ? file.getBaseName() : 'unknown'}:${line || 0} - ${msgStr}`);
      }
    } catch (err: any) {
      diagnosticsList.push(`Compiler check exception: ${err.message}`);
    }

    return {
      passed: diagnosticsList.length === 0,
      diagnostics: diagnosticsList,
    };
  }

  private buildPrompt(context: UnifiedProjectContext, input: SkillInput, featureName: string): string {
    const conventions = context.code.conventions;
    const tablesSnippet = context.db.tables
      .map(
        (t) =>
          `Table: ${t.name}\n` +
          t.columns.map((c) => `  - ${c.name}: ${c.type} (PK: ${c.isPrimaryKey}, Nullable: ${c.nullable})`).join('\n')
      )
      .join('\n\n');

    const dtosSnippet = context.code.dtos
      .slice(0, 10)
      .map((d) => `DTO: ${d.name} (${d.properties.map((p) => `${p.name}: ${p.type}`).join(', ')})`)
      .join('\n');

    return `
HÃY SINH TOÀN BỘ CODE HOÀN CHỈNH CHO TÍNH NĂNG: "${featureName}".
Yêu cầu chức năng: "${input.requirements || 'Tạo CRUD chuẩn cho tính năng'}"
Mục tiêu thư mục: "${input.targetDir || 'src'}"

THÔNG TIN QUY CHUẨN DỰ ÁN (PROJECT CONVENTIONS):
- Framework: ${conventions.framework}
- Kiến trúc: ${conventions.architecture}
- ORM/DB Tool: ${conventions.ormOrDbTool}
- Quy tắc đặt tên: ${conventions.naming}
- Cấu trúc file: ${conventions.filePattern}

THÔNG TIN DATABASE HIỆN CÓ:
${tablesSnippet || 'Không có bảng DB nào. Tự động sinh bảng và migration phù hợp.'}

DANH SÁCH DTO / TYPE MẪU:
${dtosSnippet || 'Không có DTO sẵn.'}

YÊU CẦU ĐẦU RA:
Sinh đầy đủ các tầng theo đúng kiến trúc của dự án:
1. Types / DTOs (e.g. src/types/${featureName.toLowerCase()}.types.ts)
2. Models / Queries (e.g. src/models/${featureName.toLowerCase()}.model.ts)
3. Business Service (e.g. src/services/${featureName.toLowerCase()}.service.ts)
4. Controller / Handlers (e.g. src/controllers/${featureName.toLowerCase()}.controller.ts)
5. Route definitions (e.g. src/routes/${featureName.toLowerCase()}.routes.ts)

TRẢ VỀ JSON FORMAT:
{
  "featureName": "${featureName}",
  "summary": "Tóm tắt cấu trúc code sinh ra",
  "files": [
    {
      "path": "đường dẫn tương đối từ project root (vd: src/types/feature.types.ts)",
      "content": "toàn bộ mã nguồn TypeScript hoàn chỉnh, không cắt bớt, có type check đầy đủ",
      "description": "mô tả file"
    }
  ]
}
`;
  }
}

