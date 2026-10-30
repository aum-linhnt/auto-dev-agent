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
import { DiagramService } from '../services/diagramService';
import { DocxService } from '../services/docxService';
import config from '../config/env';

export type MoodleDocType =
  | 'all'
  | 'yeu-cau-nghiep-vu'
  | 'dac-ta-chuc-nang'
  | 'phan-tich-thiet-ke'
  | 'huong-dan-su-dung';

export class DocGenSkill implements ISkill {
  public id = 'doc-gen';
  public name = 'Moodle 4.1 Multi-Document Generator (BRD, SRS, SAD, Guide)';
  public description =
    'Automatically generates 4 corporate enterprise documents for Moodle 4.1 (Phiếu yêu cầu nghiệp vụ, Tài liệu đặc tả chức năng, Tài liệu phân tích thiết kế, Hướng dẫn sử dụng) into exact Word (.docx) templates, preserving 100% styles and embedding Mermaid diagrams.';
  public version = '2.0.0';
  public type: 'built-in' = 'built-in';

  private llmService: LlmService;
  private diagramService: DiagramService;
  private docxService: DocxService;

  constructor() {
    this.llmService = new LlmService();
    this.diagramService = new DiagramService();
    this.docxService = new DocxService();
  }

  public async execute(context: UnifiedProjectContext, input: SkillInput): Promise<SkillResult> {
    const featureName = input.featureName || 'MoodleQuizProctoring';
    console.log(`[DocGenSkill] Starting document generation for Moodle 4.1 feature: "${featureName}"...`);

    // Determine document type to generate: 'all' or specific document
    let requestedType: MoodleDocType = 'all';
    const paramType = (input.customParams?.docType || '').toLowerCase();
    const reqText = (input.requirements || '').toLowerCase();

    if (paramType.includes('nghiep-vu') || paramType.includes('brd') || reqText.includes('yêu cầu nghiệp vụ') || reqText.includes('phiếu yêu cầu')) {
      requestedType = 'yeu-cau-nghiep-vu';
    } else if (paramType.includes('dac-ta') || paramType.includes('srs') || paramType.includes('fsd') || reqText.includes('đặc tả chức năng')) {
      requestedType = 'dac-ta-chuc-nang';
    } else if (paramType.includes('thiet-ke') || paramType.includes('sad') || paramType.includes('design') || reqText.includes('phân tích thiết kế')) {
      requestedType = 'phan-tich-thiet-ke';
    } else if (paramType.includes('huong-dan') || paramType.includes('guide') || reqText.includes('hướng dẫn sử dụng')) {
      requestedType = 'huong-dan-su-dung';
    } else if (paramType === 'all' || !paramType) {
      requestedType = 'all';
    }

    const timestamp = Date.now();
    const dateFormatted = new Date().toLocaleDateString('vi-VN');

    // 1. Synthesize content via Gemini with Moodle 4.1 system instructions
    const prompt = this.buildMoodlePrompt(context, input, featureName);
    console.log(`[DocGenSkill] Calling Gemini for Moodle 4.1 specification synthesis...`);
    const docData = await this.llmService.generateStructured<any>({
      prompt,
      systemInstruction:
        'You are a Principal Software Architect & Moodle 4.1 LMS Core Engineer. Generate formal, highly detailed specifications, architectural designs, and user guides strictly tailored for Moodle 4.1 (PHP 8.1+, XMLDB mdl_ tables, Capabilities, Roles: Teacher/Student/Admin, Mustache templates, Web Services).',
    });

    // 2. Generate and Render Mermaid Diagrams
    const workflowMermaid = docData.workflowMermaid || this.generateDefaultWorkflowDiagram(featureName);
    const archMermaid = docData.architectureMermaid || this.generateDefaultArchitectureDiagram();
    const erdMermaid = docData.erdMermaid || this.generateDefaultErdDiagram(context);

    console.log(`[DocGenSkill] Rendering Mermaid diagrams to PNG via Kroki API...`);
    const [workflowPng, archPng, erdPng] = await Promise.all([
      this.diagramService.renderMermaidToPng(workflowMermaid),
      this.diagramService.renderMermaidToPng(archMermaid),
      this.diagramService.renderMermaidToPng(erdMermaid),
    ]);

    // Save diagram images
    const wfImgPath = path.join(config.paths.outputDir, `${featureName}_workflow_${timestamp}.png`);
    const archImgPath = path.join(config.paths.outputDir, `${featureName}_arch_${timestamp}.png`);
    const erdImgPath = path.join(config.paths.outputDir, `${featureName}_erd_${timestamp}.png`);
    fs.writeFileSync(wfImgPath, workflowPng);
    fs.writeFileSync(archImgPath, archPng);
    fs.writeFileSync(erdImgPath, erdPng);

    const artifacts: SkillArtifact[] = [
      { type: 'diagram', filePath: wfImgPath, description: 'Workflow Diagram PNG' },
      { type: 'diagram', filePath: archImgPath, description: 'Architecture Diagram PNG' },
      { type: 'diagram', filePath: erdImgPath, description: 'Moodle ERD Diagram PNG' },
    ];

    const generatedDocs: string[] = [];

    // Unified Data Payload for Template Binding
    const baseData = {
      featureName: docData.featureName || featureName,
      featureCode: docData.featureCode || `MDL-${featureName.toUpperCase().slice(0, 8)}`,
      system: docData.system || 'Moodle 4.1 LMS',
      author: docData.author || 'CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ TH VIỆT NAM',
      date: dateFormatted,
      version: docData.version || '1.0',
      category: docData.category || 'Tính năng mới cho Moodle 4.1',
      targetUsers: docData.targetUsers || 'Giảng viên (Teacher), Học viên (Student), Quản trị viên (Admin), Phòng Đào tạo',
      newFeatureDescription: docData.newFeatureDescription || docData.objective || input.requirements,
      oldFeatureDescription: docData.oldFeatureDescription || 'Hiện trạng trên Moodle 4.1 cần được bổ sung tính năng này.',
      objective: docData.objective || `Nâng cao hiệu quả quản lý và học tập trên Moodle 4.1 cho ${featureName}`,
      scopeIn: docData.scopeIn || 'Áp dụng cho các khóa học và hoạt động liên quan trên Moodle 4.1.',
      scopeOut: docData.scopeOut || 'Không thay đổi cấu hình SSO ngoại vi hoặc hệ thống LMS khác.',
      processOverview: docData.processOverview || 'Quy trình xử lý tự động trong Moodle 4.1.',
      workflowDiagram: workflowPng,
      architectureDiagram: archPng,
      erdDiagram: erdPng,
      requirements: docData.requirements || [
        { id: 'R001', name: 'Khởi tạo và cấu hình', description: 'Cho phép Giảng viên cấu hình trong Moodle.' },
        { id: 'R002', name: 'Xử lý tương tác', description: 'Tiếp nhận telemetry từ Client qua Web Service.' }
      ],
      functionalRequirements: docData.functionalRequirements || [
        { id: 'FR-01', name: 'Cài đặt Plugin Moodle', priority: 'High', description: 'Tích hợp vào Moodle 4.1 qua plugin hook.' },
        { id: 'FR-02', name: 'Ghi nhận sự kiện', priority: 'High', description: 'Lưu log vào bảng mdl_ tương ứng.' }
      ],
      businessRules: docData.businessRules || [
        { id: 'BR-01', name: 'Quyền truy cập', description: 'Yêu cầu kiểm tra capability has_capability() trước khi thao tác.' },
        { id: 'BR-02', name: 'Bảo mật phiên', description: 'Mỗi học viên chỉ hoạt động trên một phiên thi duy nhất.' }
      ],
      acceptanceStandards: docData.acceptanceStandards || 'Độ trễ API < 200ms, tương thích Moodle 4.1 PHP 8.1+ và MySQL 8.0.',
      workflowDescription: docData.workflowDescription || 'Luồng hoạt động giữa Moodle Theme, Web Services API và $DB.',
      systemRequirements: docData.systemRequirements || 'Moodle Core >= 4.1, PHP >= 8.1, MySQL >= 8.0.',
      accessControl: docData.accessControl || 'Capabilities mod/...:view, mod/...:manage phân quyền cho các Roles Moodle.',
      databaseDesign: docData.databaseDesign || 'Bảng dữ liệu chuẩn XMLDB Moodle (mdl_).',
      apiDesign: docData.apiDesign || 'Định nghĩa Web Service API trong db/services.php.',
      uiDesign: docData.uiDesign || 'Giao diện xây dựng bằng Moodle Mustache Templates.',
      architectureDesign: docData.architectureDesign || 'Kiến trúc Moodle 4.1 Modular Plugin.',
      securityAndPerformance: docData.securityAndPerformance || 'Chống SQL Injection qua $DB API, tận dụng MUC Cache.',
      userGuideSections: docData.userGuideSections || [
        { sectionTitle: '1. Dành cho Giảng viên (Teacher)', sectionContent: 'Đăng nhập Moodle, vào khóa học, bật chỉnh sửa và thêm tính năng.' },
        { sectionTitle: '2. Dành cho Học viên (Student)', sectionContent: 'Truy cập vào bài học/bài thi và làm theo hướng dẫn hiển thị.' }
      ],
      useCaseGoal: docData.useCaseGoal || 'Hoàn thành thao tác trên Moodle an toàn',
      useCaseActor: docData.useCaseActor || 'Học viên (Student), Giảng viên (Teacher)',
      useCasePreCondition: docData.useCasePreCondition || 'Đã ghi danh vào khóa học Moodle',
      useCaseMainFlow: docData.useCaseMainFlow || '1) Truy cập. 2) Thực hiện. 3) Hoàn tất.',
      useCaseExceptionFlow: docData.useCaseExceptionFlow || 'Mất kết nối: Hệ thống tự động thử lại khi có mạng.',
      useCaseResult: docData.useCaseResult || 'Kết quả ghi nhận vào Sổ điểm và cơ sở dữ liệu Moodle.',
      acceptanceCriteria: docData.acceptanceCriteria || [
        { id: 'AC-01', description: 'Ghi nhận chính xác 100% sự kiện thao tác.' },
        { id: 'AC-02', description: 'Hiển thị báo cáo trực quan trong Moodle Course Report.' }
      ]
    };

    // 3. Render Requested Templates
    const templatesDir = config.paths.templatesDir;

    // Doc 1: Phiếu yêu cầu nghiệp vụ (BRD)
    if (requestedType === 'all' || requestedType === 'yeu-cau-nghiep-vu') {
      const templatePath = path.join(templatesDir, 'Phiếu yêu cầu nghiệp vụ.docx');
      if (fs.existsSync(templatePath)) {
        const outDocx = path.join(config.paths.outputDir, `Phieu_yeu_cau_nghiep_vu_${featureName}_${timestamp}.docx`);
        const outMd = path.join(config.paths.outputDir, `Phieu_yeu_cau_nghiep_vu_${featureName}_${timestamp}.md`);
        await this.docxService.renderDocx({ templatePath, data: baseData, outputPath: outDocx });
        fs.writeFileSync(outMd, this.formatBrdMarkdown(baseData, workflowMermaid), 'utf-8');

        artifacts.push({ type: 'docx', filePath: outDocx, description: 'Phiếu yêu cầu nghiệp vụ (Word .docx)' });
        artifacts.push({ type: 'markdown', filePath: outMd, description: 'Phiếu yêu cầu nghiệp vụ (Markdown .md)' });
        generatedDocs.push('Phiếu yêu cầu nghiệp vụ');
      }
    }

    // Doc 2: Tài liệu đặc tả chức năng (SRS / FSD)
    if (requestedType === 'all' || requestedType === 'dac-ta-chuc-nang') {
      const templatePath = path.join(templatesDir, 'Tài liệu đặc tả chức năng.docx');
      if (fs.existsSync(templatePath)) {
        const outDocx = path.join(config.paths.outputDir, `Tai_lieu_dac_ta_chuc_nang_${featureName}_${timestamp}.docx`);
        const outMd = path.join(config.paths.outputDir, `Tai_lieu_dac_ta_chuc_nang_${featureName}_${timestamp}.md`);
        await this.docxService.renderDocx({ templatePath, data: baseData, outputPath: outDocx });
        fs.writeFileSync(outMd, this.formatSrsMarkdown(baseData, workflowMermaid), 'utf-8');

        artifacts.push({ type: 'docx', filePath: outDocx, description: 'Tài liệu đặc tả chức năng (Word .docx)' });
        artifacts.push({ type: 'markdown', filePath: outMd, description: 'Tài liệu đặc tả chức năng (Markdown .md)' });
        generatedDocs.push('Tài liệu đặc tả chức năng');
      }
    }

    // Doc 3: Tài liệu phân tích thiết kế (SAD)
    if (requestedType === 'all' || requestedType === 'phan-tich-thiet-ke') {
      const templatePath = path.join(templatesDir, 'Tài liệu phân tích thiết kế.docx');
      if (fs.existsSync(templatePath)) {
        const outDocx = path.join(config.paths.outputDir, `Tai_lieu_phan_tich_thiet_ke_${featureName}_${timestamp}.docx`);
        const outMd = path.join(config.paths.outputDir, `Tai_lieu_phan_tich_thiet_ke_${featureName}_${timestamp}.md`);
        await this.docxService.renderDocx({ templatePath, data: baseData, outputPath: outDocx });
        fs.writeFileSync(outMd, this.formatSadMarkdown(baseData, archMermaid, erdMermaid), 'utf-8');

        artifacts.push({ type: 'docx', filePath: outDocx, description: 'Tài liệu phân tích thiết kế (Word .docx)' });
        artifacts.push({ type: 'markdown', filePath: outMd, description: 'Tài liệu phân tích thiết kế (Markdown .md)' });
        generatedDocs.push('Tài liệu phân tích thiết kế');
      }
    }

    // Doc 4: Hướng dẫn sử dụng (User Guide)
    if (requestedType === 'all' || requestedType === 'huong-dan-su-dung') {
      const templatePath = path.join(templatesDir, 'Hướng dẫn sử dụng.docx');
      if (fs.existsSync(templatePath)) {
        const outDocx = path.join(config.paths.outputDir, `Huong_dan_su_dung_${featureName}_${timestamp}.docx`);
        const outMd = path.join(config.paths.outputDir, `Huong_dan_su_dung_${featureName}_${timestamp}.md`);
        await this.docxService.renderDocx({ templatePath, data: baseData, outputPath: outDocx });
        fs.writeFileSync(outMd, this.formatGuideMarkdown(baseData, workflowMermaid), 'utf-8');

        artifacts.push({ type: 'docx', filePath: outDocx, description: 'Hướng dẫn sử dụng (Word .docx)' });
        artifacts.push({ type: 'markdown', filePath: outMd, description: 'Hướng dẫn sử dụng (Markdown .md)' });
        generatedDocs.push('Hướng dẫn sử dụng');
      }
    }

    return {
      success: true,
      skillName: this.name,
      message: `Đã sinh thành công ${generatedDocs.length} tài liệu cho Moodle 4.1 (${generatedDocs.join(', ')}) theo đúng 100% định dạng template gốc.`,
      artifacts,
      data: {
        featureName: baseData.featureName,
        system: baseData.system,
        generatedDocuments: generatedDocs,
      },
    };
  }

  private buildMoodlePrompt(context: UnifiedProjectContext, input: SkillInput, featureName: string): string {
    return `
BẠN LÀ PRINCIPAL SOFTWARE ARCHITECT CHUYÊN SÂU HỆ THỐNG MOODLE 4.1 LMS.
Hãy tạo nội dung đặc tả, phân tích thiết kế và hướng dẫn sử dụng chuyên nghiệp cho:
- Tên tính năng: "${featureName}"
- Hệ thống: Moodle 4.1 LMS
- Yêu cầu chức năng: "${input.requirements || 'Phát triển module tính năng mới trên nền tảng Moodle 4.1'}"

CÁC NGUYÊN TẮC THIẾT KẾ MOODLE 4.1:
1. Cơ sở dữ liệu: Các bảng có tiền tố mdl_ (vd: mdl_course, mdl_quiz, mdl_quiz_attempts, mdl_user), sử dụng chuẩn XMLDB.
2. Phân quyền (Access Control): Sử dụng Capabilities (vd: mod/...:view, mod/...:manage) và Roles (Teacher, Student, Manager).
3. API & Web Service: Định nghĩa external functions theo chuẩn Moodle 4.1 (classes/external/*.php, db/services.php).
4. Giao diện (UI/UX): Moodle Mustache Templates (.mustache) và AMD JavaScript (amd/src/*.js) tương thích theme Boost Bootstrap 5.
5. Bảo mật & Hiệu năng: Chống SQL Injection bằng Moodle $DB API parameterized queries, tận dụng MUC Cache.

TRẢ VỀ JSON FORMAT CHUẨN ĐỂ ĐIỀN VÀO 4 MẪU TÀI LIỆU WORD:
{
  "title": "Tiêu đề tài liệu",
  "featureName": "${featureName}",
  "featureCode": "MDL-QC-41",
  "system": "Moodle 4.1 LMS",
  "version": "1.0",
  "author": "CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ TH VIỆT NAM",
  "category": "Tính năng mới cho Moodle 4.1",
  "targetUsers": "Giảng viên (Teacher), Học viên (Student), Quản trị viên (Admin)",
  "newFeatureDescription": "Mô tả tóm tắt tính năng mới",
  "oldFeatureDescription": "Hiện trạng và đề xuất bổ sung",
  "objective": "Mục tiêu xây dựng chức năng",
  "scopeIn": "Phạm vi thực hiện",
  "scopeOut": "Ngoài phạm vi",
  "processOverview": "Tổng quan luồng xử lý Moodle",
  "requirements": [
    { "id": "R001", "name": "Tên yêu cầu", "description": "Mô tả chi tiết" }
  ],
  "functionalRequirements": [
    { "id": "FR-01", "name": "Tên yêu cầu", "priority": "High", "description": "Mô tả" }
  ],
  "businessRules": [
    { "id": "BR-01", "name": "Tên quy tắc", "description": "Nội dung quy tắc" }
  ],
  "acceptanceStandards": "Tiêu chuẩn chấp nhận (hiệu suất, SLA)",
  "workflowDescription": "Mô tả quy trình hoạt động",
  "systemRequirements": "Yêu cầu hệ thống Moodle 4.1, PHP, DB",
  "accessControl": "Phân quyền Capabilities & Roles Moodle",
  "databaseDesign": "Thiết kế bảng dữ liệu XMLDB",
  "apiDesign": "Thiết kế Web Service Moodle API",
  "uiDesign": "Thiết kế giao diện Mustache Templates",
  "architectureDesign": "Kiến trúc hệ thống Moodle Plugin",
  "securityAndPerformance": "Bảo mật và tối ưu hiệu suất",
  "userGuideSections": [
    { "sectionTitle": "1. Dành cho Giảng viên", "sectionContent": "Các bước thao tác..." },
    { "sectionTitle": "2. Dành cho Học viên", "sectionContent": "Các bước thao tác..." }
  ],
  "useCaseGoal": "Mục tiêu Use Case",
  "useCaseActor": "Tác nhân",
  "useCasePreCondition": "Điều kiện tiên quyết",
  "useCaseMainFlow": "1) Bước 1. 2) Bước 2.",
  "useCaseExceptionFlow": "Ngoại lệ xử lý",
  "useCaseResult": "Kết quả đạt được",
  "acceptanceCriteria": [
    { "id": "AC-01", "description": "Tiêu chí nghiệm thu" }
  ],
  "workflowMermaid": "sequenceDiagram\\n  ...",
  "architectureMermaid": "graph TD\\n  ...",
  "erdMermaid": "erDiagram\\n  ..."
}
`;
  }

  private generateDefaultWorkflowDiagram(feature: string): string {
    return `sequenceDiagram
  autonumber
  actor User as Học viên / Giảng viên
  participant Browser as Trình duyệt (Theme Boost)
  participant WS as Moodle 4.1 Web Service API
  participant Controller as Plugin Controller
  participant DB as Moodle Database ($DB)
  User->>Browser: Thao tác chức năng ${feature}
  Browser->>WS: Gửi request AJAX / REST
  WS->>Controller: Kiểm tra require_capability()
  Controller->>DB: Thực thi truy vấn qua $DB
  DB-->>Controller: Trả về bản ghi mdl_
  Controller-->>Browser: Trả về JSON Response
  Browser-->>User: Cập nhật giao diện Mustache Template`;
  }

  private generateDefaultArchitectureDiagram(): string {
    return `graph TD
  subgraph Client["Moodle 4.1 Client Layer"]
    UI[Bootstrap 5 / Theme Boost]
    AMD[AMD JavaScript Module]
  end
  subgraph Core["Moodle Core Application Tier"]
    Router[Moodle Routing & Web Services Gateway]
    Plugin[Moodle Activity / Local Plugin Controller]
    Access[Moodle Access Control - Capabilities & Roles]
    MUC[Moodle Universal Cache - Redis/MUC]
    DBAPI[Moodle Database Abstraction Layer - $DB]
  end
  subgraph DB["Moodle Database Tier (MySQL 8.0)"]
    TblCourse[(mdl_course)]
    TblQuiz[(mdl_quiz)]
    TblAttempts[(mdl_quiz_attempts)]
    TblCustom[(mdl_plugin_custom_logs)]
  end
  UI --> AMD
  AMD -->|REST / AJAX| Router
  Router --> Plugin
  Plugin --> Access
  Plugin --> MUC
  Plugin --> DBAPI
  DBAPI --> TblCourse
  DBAPI --> TblQuiz
  DBAPI --> TblAttempts
  DBAPI --> TblCustom`;
  }

  private generateDefaultErdDiagram(context: UnifiedProjectContext): string {
    return `erDiagram
  MDL_COURSE ||--o{ MDL_QUIZ : contains
  MDL_COURSE ||--o{ MDL_COURSE_MODULES : defines
  MDL_QUIZ ||--o{ MDL_QUIZ_ATTEMPTS : tracks
  MDL_USER ||--o{ MDL_QUIZ_ATTEMPTS : submits
  MDL_COURSE ||--o{ MDL_GRADE_ITEMS : calculates
  MDL_USER ||--o{ MDL_USER_ENROLMENTS : enrols`;
  }

  private formatBrdMarkdown(data: any, workflowMermaid: string): string {
    return `# PHIẾU YÊU CẦU NGHIỆP VỤ (BRD)
**Hệ thống:** ${data.system}  
**Tên tính năng:** ${data.featureName} (${data.featureCode})  
**Phiên bản:** ${data.version} | **Ngày tạo:** ${data.date}  
**Đơn vị thực hiện:** ${data.author}  

---

## 1. Thông tin tổng quan
- **Phân loại:** ${data.category}
- **Đối tượng sử dụng:** ${data.targetUsers}
- **Mô tả tính năng:** ${data.newFeatureDescription}
- **Hiện trạng & đề xuất:** ${data.oldFeatureDescription}

## 2. Danh sách yêu cầu nghiệp vụ
${(data.requirements || []).map((r: any) => `- **[${r.id}] ${r.name}**: ${r.description}`).join('\n')}

## 3. Sơ đồ quy trình hoạt động
\`\`\`mermaid
${workflowMermaid}
\`\`\`
`;
  }

  private formatSrsMarkdown(data: any, workflowMermaid: string): string {
    return `# TÀI LIỆU ĐẶC TẢ YÊU CẦU HỆ THỐNG (SRS / FSD)
**Hệ thống:** ${data.system}  
**Tên tính năng:** ${data.featureName} (${data.featureCode})  
**Phiên bản:** ${data.version} | **Ngày tạo:** ${data.date}  

---

## 1. Mục tiêu và phạm vi
- **Mục tiêu:** ${data.objective}
- **Phạm vi thực hiện:** ${data.scopeIn}
- **Ngoài phạm vi:** ${data.scopeOut}

## 2. Tổng quan luồng xử lý
${data.processOverview}

\`\`\`mermaid
${workflowMermaid}
\`\`\`

## 3. Yêu cầu chức năng
| Mã | Tên yêu cầu | Mô tả chi tiết |
|---|---|---|
${(data.functionalRequirements || []).map((f: any) => `| ${f.id} | ${f.name} | ${f.description} |`).join('\n')}

## 4. Quy tắc nghiệp vụ
| Mã | Quy tắc | Nội dung |
|---|---|---|
${(data.businessRules || []).map((b: any) => `| ${b.id} | ${b.name} | ${b.description} |`).join('\n')}

## 5. Đặc tả Use Case: ${data.featureName}
- **Mục tiêu:** ${data.useCaseGoal}
- **Tác nhân:** ${data.useCaseActor}
- **Điều kiện trước:** ${data.useCasePreCondition}
- **Luồng chính:** ${data.useCaseMainFlow}
- **Luồng ngoại lệ:** ${data.useCaseExceptionFlow}
- **Kết quả:** ${data.useCaseResult}

## 6. Tiêu chí nghiệm thu
${(data.acceptanceCriteria || []).map((a: any) => `- **[${a.id}]**: ${a.description}`).join('\n')}
`;
  }

  private formatSadMarkdown(data: any, archMermaid: string, erdMermaid: string): string {
    return `# TÀI LIỆU PHÂN TÍCH THIẾT KẾ HỆ THỐNG (SAD)
**Hệ thống:** ${data.system}  
**Tên tính năng:** ${data.featureName} (${data.featureCode})  
**Phiên bản:** ${data.version} | **Ngày tạo:** ${data.date}  

---

## 1. Tiêu chuẩn chấp nhận
${data.acceptanceStandards}

## 2. Danh sách yêu cầu hệ thống
${data.systemRequirements}

## 3. Quản lý quyền truy cập (Capabilities & Roles Moodle 4.1)
${data.accessControl}

## 4. Kiến trúc hệ thống
\`\`\`mermaid
${archMermaid}
\`\`\`
${data.architectureDesign}

## 5. Cơ sở dữ liệu (ERD & Moodle XMLDB Tables)
\`\`\`mermaid
${erdMermaid}
\`\`\`
${data.databaseDesign}

## 6. Thiết kế API & Web Services
${data.apiDesign}

## 7. Thiết kế giao diện (Mustache Templates)
${data.uiDesign}

## 8. Bảo mật và hiệu suất
${data.securityAndPerformance}
`;
  }

  private formatGuideMarkdown(data: any, workflowMermaid: string): string {
    return `# TÀI LIỆU HƯỚNG DẪN SỬ DỤNG
**Hệ thống:** ${data.system}  
**Tính năng:** ${data.featureName} (${data.featureCode})  
**Phiên bản:** ${data.version} | **Ngày tạo:** ${data.date}  

---

## 1. Sơ đồ quy trình thao tác
\`\`\`mermaid
${workflowMermaid}
\`\`\`

## 2. Hướng dẫn chi tiết từng đối tượng người dùng
${(data.userGuideSections || []).map((s: any) => `### ${s.sectionTitle}\n${s.content || s.sectionContent}\n`).join('\n')}
`;
  }
}
