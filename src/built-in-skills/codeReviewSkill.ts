import path from 'path';
import fs from 'fs';
import {
  ISkill,
  SkillInput,
  SkillResult,
  UnifiedProjectContext,
  SkillArtifact,
} from '../core/types';
import { LlmService } from '../services/llmService';
import { DocxService } from '../services/docxService';
import config from '../config/env';

interface ReviewIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'PERFORMANCE' | 'DATABASE_INDEX' | 'DATA_TYPE' | 'SECURITY' | 'ARCHITECTURE';
  file: string;
  line: number;
  title: string;
  description: string;
  recommendation: string;
}

interface CodeReviewResponse {
  overallScore: number;
  summary: string;
  issues: ReviewIssue[];
}

export class CodeReviewSkill implements ISkill {
  public id = 'code-review';
  public name = 'Intelligent Code Review & Architectural Audit';
  public description =
    'Reviews code changes from Git diff or specified modules, cross-referencing against database schema, indexes, and AST call-graphs to detect N+1 queries, missing JOIN indexes, data type mismatches, and architectural violations.';
  public version = '1.0.0';
  public type: 'built-in' = 'built-in';

  private llmService: LlmService;
  private docxService: DocxService;

  constructor() {
    this.llmService = new LlmService();
    this.docxService = new DocxService();
  }

  public async execute(context: UnifiedProjectContext, input: SkillInput): Promise<SkillResult> {
    console.log(`[CodeReviewSkill] Executing code review against DB Schema and AST...`);

    const timestamp = new Date().toISOString().slice(0, 10);
    const outputFileName = input.outputFileName || `Review_Report_${Date.now()}`;
    const outputDocxPath = path.join(config.paths.outputDir, `${outputFileName}.docx`);
    const outputMdPath = path.join(config.paths.outputDir, `${outputFileName}.md`);

    // 1. Build prompt cross-referencing Git Diff, AST, and DB
    const prompt = this.buildPrompt(context, input);

    // 2. Call Gemini for Structured Review Findings
    console.log(`[CodeReviewSkill] Calling Gemini for comprehensive audit analysis...`);
    const reviewData = await this.llmService.generateStructured<CodeReviewResponse>({
      prompt,
      systemInstruction:
        'You are a Principal Software Architect & Database Performance Expert. Thoroughly cross-reference code changes with MySQL table structures, column types, and indexes. Be rigorous in finding N+1 queries, missing indexes on JOIN/WHERE, data type mismatches, and architectural violations.',
    });

    const issues = reviewData.issues || [];
    const overallScore = reviewData.overallScore ?? 85;

    // 3. Render Word .docx report
    const templatePath =
      input.templatePath || path.join(config.paths.templatesDir, 'review-template.docx');

    const templateData = {
      title: `BÁO CÁO REVIEW CODE & KIỂM ĐỊNH KIẾN TRÚC`,
      overallScore,
      date: timestamp,
      summary: reviewData.summary,
      issues: issues.map((iss) => ({
        ...iss,
        file: iss.file || 'Unknown',
        line: iss.line || 1,
      })),
    };

    console.log(`[CodeReviewSkill] Generating Word review report: ${outputDocxPath}...`);
    await this.docxService.renderDocx({
      templatePath,
      data: templateData,
      outputPath: outputDocxPath,
    });

    // 4. Generate companion Markdown report
    const mdContent = this.formatMarkdownReport(reviewData, context);
    fs.writeFileSync(outputMdPath, mdContent, 'utf-8');

    const artifacts: SkillArtifact[] = [
      {
        type: 'docx',
        filePath: outputDocxPath,
        description: 'Word (.docx) Code Review Report.',
      },
      {
        type: 'markdown',
        filePath: outputMdPath,
        description: 'Markdown formatted Code Review Report.',
      },
    ];

    return {
      success: true,
      skillName: this.name,
      message: `Đã hoàn thành kiểm tra mã nguồn. Điểm: ${overallScore}/100. Tìm thấy ${issues.length} vấn đề cần lưu ý.`,
      artifacts,
      data: {
        overallScore,
        summary: reviewData.summary,
        issuesCount: issues.length,
        outputDocx: outputDocxPath,
        outputMd: outputMdPath,
      },
    };
  }

  private buildPrompt(context: UnifiedProjectContext, input: SkillInput): string {
    // Collect Diff info
    let diffContext = '';
    if (context.git && context.git.changedFiles.length > 0) {
      diffContext = context.git.changedFiles
        .slice(0, 10)
        .map((f) => `File: ${f.filePath} (${f.status})\n${f.diffText.slice(0, 500)}`)
        .join('\n---\n');
    } else {
      diffContext = `Không có Git Diff. Tiến hành review theo các hàm và endpoint đã phân tích trong AST.`;
    }

    // Database tables, columns and indexes
    const dbDetails = context.db.tables
      .slice(0, 15)
      .map((t) => {
        const cols = t.columns.map((c) => `${c.name}: ${c.type}`).join(', ');
        const idxs = t.indexes.map((i) => `${i.name}(${i.columns.join(',')})`).join(', ');
        return `Table: ${t.name}\n  Columns: [${cols}]\n  Indexes: [${idxs || 'NONE'}]`;
      })
      .join('\n');

    // Extracted SQLs
    const sqlDetails = context.code.extractedSqls
      .slice(0, 10)
      .map((s) => `[${s.filePath}:${s.line}] ${s.query}`)
      .join('\n');

    // Call-Graph
    const callGraphSnippet = context.code.callGraph
      .slice(0, 15)
      .map((c) => `${c.caller} -> ${c.callee}`)
      .join('\n');

    return `
TIẾN HÀNH KIỂM ĐỊNH MÃ NGUỒN (CODE REVIEW & ARCHITECTURE AUDIT):
Mục tiêu/Module: "${input.moduleName || 'Toàn bộ thay đổi gần nhất'}"
Yêu cầu bổ sung: "${input.requirements || 'Tập trung kiểm tra N+1 query, Index, Lệch kiểu DB, Bảo mật'}"

THÔNG TIN GIT DIFF & THAY ĐỔI:
${diffContext}

THÔNG TIN DATABASE SCHEMA & INDEXES:
${dbDetails || 'Không có thông tin DB schema.'}

CÁC CÂU TRUY VẤN SQL BÓC TÁCH TỪ CODE:
${sqlDetails || 'Không tìm thấy SQL thô.'}

CALL-GRAPH PHÂN TÍCH:
${callGraphSnippet || 'Không có call-graph.'}

QUY TẮC BẮT BUỘC ĐỐI CHIẾU:
1. Hiệu năng (PERFORMANCE): Kiểm tra N+1 query (gọi truy vấn DB lặp trong vòng lặp), câu truy vấn thiếu LIMIT/PAGINATION.
2. Chỉ mục DB (DATABASE_INDEX): Kiểm tra các cột trong mệnh đề WHERE hoặc JOIN có index tương ứng trong bảng không.
3. Lệch kiểu dữ liệu (DATA_TYPE): Đối chiếu kiểu dữ liệu TypeScript (number, string, Date) với kiểu cột MySQL (VARCHAR, INT, DATETIME, JSON).
4. Kiến trúc (ARCHITECTURE): Controller có gọi trực tiếp DB không (vi phạm phân tầng), thiếu Transaction khi ghi nhiều bảng liên tiếp.
5. Bảo mật (SECURITY): SQL Injection, thiếu xác thực endpoint, lộ thông tin nhạy cảm.

TRẢ VỀ JSON FORMAT:
{
  "overallScore": 85,
  "summary": "Tóm tắt kết quả review",
  "issues": [
    {
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "category": "PERFORMANCE" | "DATABASE_INDEX" | "DATA_TYPE" | "SECURITY" | "ARCHITECTURE",
      "file": "path/to/file.ts",
      "line": 12,
      "title": "Tên ngắn gọn vấn đề",
      "description": "Giải thích chi tiết nguyên nhân và nguy cơ",
      "recommendation": "Đoạn code sửa đổi hoặc hướng dẫn khắc phục cụ thể"
    }
  ]
}
`;
  }

  private formatMarkdownReport(reviewData: CodeReviewResponse, context: UnifiedProjectContext): string {
    const issues = reviewData.issues || [];
    return `# Báo cáo Review Mã Nguồn & Kiểm định Kiến trúc
**Điểm chất lượng:** ${reviewData.overallScore}/100  
**Dự án:** ${path.basename(context.projectRoot)}  
**Thời gian kiểm tra:** ${new Date().toLocaleString('vi-VN')}  

---

## 1. Tóm tắt đánh giá
${reviewData.summary}

## 2. Thống kê lỗi theo phân loại
- **Số lượng vấn đề phát hiện:** ${issues.length}
- **Mức độ Critical/High:** ${issues.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length}
- **Mức độ Medium/Low:** ${issues.filter((i) => i.severity === 'MEDIUM' || i.severity === 'LOW').length}

---

## 3. Danh sách chi tiết các vấn đề (Findings)

${issues
  .map(
    (iss, idx) => `
### ${idx + 1}. [${iss.severity}] ${iss.title}
- **Vị trí:** \`${iss.file}:${iss.line}\`
- **Phân loại:** \`${iss.category}\`
- **Mô tả chi tiết:** ${iss.description}
- **Khuyến nghị khắc phục:**
${iss.recommendation}
`
  )
  .join('\n')}
`;
  }
}

