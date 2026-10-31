import path from 'path';
import fs from 'fs';
import {
  ISkill,
  SkillInput,
  SkillResult,
  UnifiedProjectContext,
  SkillArtifact,
  MoodlePluginDetail,
} from '../core/types';
import { LlmService } from '../services/llmService';
import { DiagramService } from '../services/diagramService';
import { DocxService } from '../services/docxService';
import { WordXmlBuilder } from '../services/wordXmlBuilder';
import { MoodlePluginAnalyzer } from '../context/moodlePluginAnalyzer';
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
    'Automatically generates enterprise documentation for Moodle 4.1 plugins and features (Phiếu yêu cầu nghiệp vụ, Tài liệu đặc tả chức năng, Tài liệu phân tích thiết kế, Hướng dẫn sử dụng) directly into exact Word (.docx) templates, extracting full context from Moodle source code.';
  public version = '2.1.0';
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
    // 1. Deep Moodle Plugin Code Reading & Semantic Extraction
    let pluginDetail: MoodlePluginDetail | undefined;
    const pluginPath =
      input.customParams?.pluginPath ||
      (input.targetDir && input.targetDir !== '.' ? input.targetDir : undefined);

    if (pluginPath) {
      try {
        console.log(`[DocGenSkill] Đang đọc và bóc tách mã nguồn plugin Moodle tại: "${pluginPath}"...`);
        pluginDetail = await MoodlePluginAnalyzer.analyzePlugin(context.projectRoot, pluginPath);
        console.log(
          `[DocGenSkill] Bóc tách thành công plugin "${pluginDetail.component}" (${pluginDetail.name}): ` +
            `${pluginDetail.capabilities.length} capabilities, ${pluginDetail.services.length} services, ` +
            `${pluginDetail.tables.length} tables, ${pluginDetail.classes.length} classes.`
        );
      } catch (err: any) {
        console.warn(`[DocGenSkill] Cảnh báo: Không thể phân tích plugin tại "${pluginPath}":`, err.message);
      }
    } else if (input.featureName) {
      // Check if featureName corresponds to a known plugin
      try {
        const plugins = await MoodlePluginAnalyzer.listPlugins(context.projectRoot);
        const matched = plugins.find(
          (p) =>
            p.component.toLowerCase() === input.featureName!.toLowerCase() ||
            p.path.toLowerCase() === input.featureName!.toLowerCase() ||
            path.basename(p.path).toLowerCase() === input.featureName!.toLowerCase()
        );
        if (matched) {
          console.log(`[DocGenSkill] Tự động phát hiện plugin Moodle từ tên tính năng: "${matched.path}"...`);
          pluginDetail = await MoodlePluginAnalyzer.analyzePlugin(context.projectRoot, matched.path);
        }
      } catch {
        // Ignore
      }
    }

    // Determine feature title
    let featureName = input.featureName;
    if (!featureName || featureName === 'MoodleQuizProctoring') {
      if (pluginDetail) {
        featureName = `${pluginDetail.name} (${pluginDetail.component})`;
      } else {
        featureName = 'MoodleQuizProctoring';
      }
    }

    console.log(`[DocGenSkill] Starting document generation for feature: "${featureName}"...`);

    // Determine document type to generate: specific template document (defaults to dac-ta-chuc-nang)
    let requestedType: MoodleDocType = 'dac-ta-chuc-nang';
    const paramType = (input.customParams?.docType || '').toLowerCase();
    const reqText = (input.requirements || '').toLowerCase();

    if (
      paramType.includes('nghiep-vu') ||
      paramType.includes('brd') ||
      reqText.includes('yêu cầu nghiệp vụ') ||
      reqText.includes('phiếu yêu cầu')
    ) {
      requestedType = 'yeu-cau-nghiep-vu';
    } else if (
      paramType.includes('thiet-ke') ||
      paramType.includes('sad') ||
      paramType.includes('design') ||
      reqText.includes('phân tích thiết kế')
    ) {
      requestedType = 'phan-tich-thiet-ke';
    } else if (
      paramType.includes('huong-dan') ||
      paramType.includes('guide') ||
      reqText.includes('hướng dẫn sử dụng')
    ) {
      requestedType = 'huong-dan-su-dung';
    } else if (
      paramType.includes('dac-ta') ||
      paramType.includes('srs') ||
      paramType.includes('fsd') ||
      reqText.includes('đặc tả chức năng')
    ) {
      requestedType = 'dac-ta-chuc-nang';
    } else if (paramType === 'all') {
      requestedType = 'all';
    }

    const timestamp = Date.now();
    const dateFormatted = new Date().toLocaleDateString('vi-VN');

    // 2. Synthesize content via Gemini with Moodle 4.1 system instructions + parsed plugin context
    const prompt = this.buildMoodlePrompt(context, input, featureName, pluginDetail);
    console.log(`[DocGenSkill] Calling Gemini for Moodle 4.1 specification synthesis...`);
    const docData = await this.llmService.generateStructured<any>({
      prompt,
      systemInstruction:
        'You are a Principal Software Architect & Moodle 4.1 LMS Core Engineer. Generate formal, highly detailed specifications, architectural designs, and user guides strictly tailored for Moodle 4.1 (PHP 8.1+, XMLDB mdl_ tables, Capabilities, Roles: Teacher/Student/Admin, Mustache templates, Web Services).',
    });

    // 3. Diagrams: only render if explicitly requested (disabled by default to focus on words & tables)
    const shouldRenderDiagrams = !!input.customParams?.includeDiagrams;
    let workflowPng: Buffer | undefined;
    let archPng: Buffer | undefined;
    let erdPng: Buffer | undefined;

    if (shouldRenderDiagrams) {
      console.log(`[DocGenSkill] Rendering Mermaid diagrams to PNG via Kroki API...`);
      const workflowMermaid = docData.workflowMermaid || this.generateDefaultWorkflowDiagram(featureName);
      const archMermaid = docData.architectureMermaid || this.generateDefaultArchitectureDiagram();
      const erdMermaid = docData.erdMermaid || this.generateDefaultErdDiagram(context);

      [workflowPng, archPng, erdPng] = await Promise.all([
        this.diagramService.renderMermaidToPng(workflowMermaid),
        this.diagramService.renderMermaidToPng(archMermaid),
        this.diagramService.renderMermaidToPng(erdMermaid),
      ]);
    } else {
      console.log(`[DocGenSkill] Bỏ qua vẽ sơ đồ; tập trung diễn giải từ ngữ và kẻ bảng chi tiết.`);
    }

    const artifacts: SkillArtifact[] = [];
    const generatedDocs: string[] = [];

    // Synthesize single unified content string for {@content} (native OpenXML formatted with WordXmlBuilder)
    const content = this.buildUnifiedContent(docData, requestedType, featureName, input, pluginDetail);

    // Unified Data Payload for Template Binding (all document content bound to single {content} variable)
    const docFeatureCode =
      docData.featureCode ||
      (pluginDetail ? pluginDetail.component.toUpperCase() : `MDL-${featureName.toUpperCase().slice(0, 8)}`);

    const docTargetUsers =
      docData.targetUsers ||
      (pluginDetail?.capabilities.some((c) => 'student' in c.archetypes)
        ? 'Giảng viên (Teacher), Học viên (Student), Quản trị viên (Admin), Phòng Đào tạo'
        : 'Giảng viên (Teacher), Quản trị viên hệ thống (Admin), Cán bộ quản lý đào tạo');

    const baseData = {
      featureName: docData.featureName || featureName,
      featureCode: docFeatureCode,
      system: docData.system || 'Moodle 4.1 LMS TNU',
      author: docData.author || 'CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ TH VIỆT NAM',
      date: dateFormatted,
      version: docData.version || pluginDetail?.release || '1.0',
      category: docData.category || (pluginDetail ? `Phân hệ Moodle: ${pluginDetail.type}` : 'Tính năng Moodle 4.1'),
      targetUsers: docTargetUsers,
      newFeatureDescription:
        docData.newFeatureDescription ||
        docData.objective ||
        pluginDetail?.description ||
        input.requirements ||
        `Module ${featureName} trên hệ thống Moodle 4.1`,
      oldFeatureDescription:
        docData.oldFeatureDescription || 'Hiện trạng quy trình quản lý trước đây cần được số hóa và tự động hóa trên Moodle 4.1.',
      content,
      noiDung: content,
      documentContent: content,
      workflowDiagram: workflowPng,
      architectureDiagram: archPng,
      erdDiagram: erdPng,
    };

    // 4. Render Requested Template Document (strictly 1 template document to keep output clean)
    const templatesDir = config.paths.templatesDir;

    const docTemplates: Record<string, { templateFile: string; outputPrefix: string; title: string }> = {
      'dac-ta-chuc-nang': {
        templateFile: 'Tài liệu đặc tả chức năng.docx',
        outputPrefix: 'Tai_lieu_dac_ta_chuc_nang',
        title: 'Tài liệu đặc tả chức năng',
      },
      'phan-tich-thiet-ke': {
        templateFile: 'Tài liệu phân tích thiết kế.docx',
        outputPrefix: 'Tai_lieu_phan_tich_thiet_ke',
        title: 'Tài liệu phân tích thiết kế',
      },
      'yeu-cau-nghiep-vu': {
        templateFile: 'Phiếu yêu cầu nghiệp vụ.docx',
        outputPrefix: 'Phieu_yeu_cau_nghiep_vu',
        title: 'Phiếu yêu cầu nghiệp vụ',
      },
      'huong-dan-su-dung': {
        templateFile: 'Hướng dẫn sử dụng.docx',
        outputPrefix: 'Huong_dan_su_dung',
        title: 'Hướng dẫn sử dụng',
      },
    };

    const sanitizedFilePart = pluginDetail
      ? pluginDetail.component
      : featureName.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (input.templatePath && fs.existsSync(input.templatePath)) {
      const templateBaseName = path.basename(input.templatePath, path.extname(input.templatePath));
      const outDocx = path.join(
        config.paths.outputDir,
        `${templateBaseName}_${sanitizedFilePart}_${timestamp}.docx`
      );
      await this.docxService.renderDocx({ templatePath: input.templatePath, data: baseData, outputPath: outDocx });
      artifacts.push({
        type: 'docx',
        filePath: outDocx,
        description: `Tài liệu Word theo template: ${path.basename(input.templatePath)}`,
      });
      generatedDocs.push(templateBaseName);
    } else {
      const typesToRender =
        requestedType === 'all'
          ? Object.keys(docTemplates)
          : [requestedType in docTemplates ? requestedType : 'dac-ta-chuc-nang'];

      for (const tKey of typesToRender) {
        const item = docTemplates[tKey];
        if (!item) continue;
        const templatePath = path.join(templatesDir, item.templateFile);
        if (fs.existsSync(templatePath)) {
          const outDocx = path.join(
            config.paths.outputDir,
            `${item.outputPrefix}_${sanitizedFilePart}_${timestamp}.docx`
          );
          await this.docxService.renderDocx({ templatePath, data: baseData, outputPath: outDocx });

          artifacts.push({
            type: 'docx',
            filePath: outDocx,
            description: `${item.title} (Word .docx)`,
          });
          generatedDocs.push(item.title);
        }
      }
    }

    const docNameSummary = generatedDocs.join(', ');
    const pluginInfoStr = pluginDetail ? ` cho plugin [${pluginDetail.component}]` : '';

    return {
      success: true,
      skillName: this.name,
      message: `Đã sinh thành công tài liệu: ${docNameSummary}${pluginInfoStr} theo đúng template Word (.docx).`,
      artifacts,
      data: {
        featureName: baseData.featureName,
        system: baseData.system,
        plugin: pluginDetail
          ? {
              component: pluginDetail.component,
              path: pluginDetail.path,
              version: pluginDetail.version,
            }
          : null,
        generatedDocuments: generatedDocs,
      },
    };
  }

  private buildMoodlePrompt(
    context: UnifiedProjectContext,
    input: SkillInput,
    featureName: string,
    pluginDetail?: MoodlePluginDetail
  ): string {
    const pluginSection = pluginDetail
      ? `\nTHÔNG TIN BÓC TÁCH MÃ NGUỒN PLUGIN THỰC TẾ TRONG HỆ THỐNG:\n${pluginDetail.sourceSummary}\n`
      : '';

    return `
BẠN LÀ PRINCIPAL SOFTWARE ARCHITECT CHUYÊN SÂU HỆ THỐNG MOODLE 4.1 LMS.
Hãy tạo nội dung đặc tả / thiết kế / hướng dẫn sử dụng chuyên nghiệp cho:
- Tên tính năng: "${featureName}"
- Hệ thống: Moodle 4.1 LMS TNU
- Yêu cầu chức năng: "${input.requirements || pluginDetail?.description || 'Phát triển module tính năng trên nền tảng Moodle 4.1'}"
${pluginSection}
LƯU Ý QUAN TRỌNG VỀ ĐỊNH DẠNG:
- PHẠM VI GỌN GÀNG, KHÔNG CẦN VẼ SƠ ĐỒ HÌNH ẢNH PHỨC TẠP. TUYỆT ĐỐI HẠN CHẾ SƠ ĐỒ.
- TẬP TRUNG VIẾT DIỄN GIẢI BẰNG TỪ NGỮ CHUYÊN NGHIỆP, RÕ RÀNG VÀ KẺ BẢNG ĐỊNH DẠNG VĂN BẢN (Text Table: +---+---+ hoặc |...|...) CHO CÁC MỤC: Danh sách yêu cầu chức năng, Quy tắc nghiệp vụ, Ma trận phân quyền, Bảng cấu trúc CSDL, Tiêu chí nghiệm thu, Kịch bản Use Case.
- NẾU CÓ DỮ LIỆU BÓC TÁCH MÃ NGUỒN CỦA PLUGIN (Capabilities, Web Services, Tables, Classes), BẮT BUỘC SỬ DỤNG CHÍNH XÁC CÁC TÊN BẢNG, HÀM, VAI TRÒ VÀ TRƯỜNG THỰC TẾ TRONG SOURCE ĐÓ.
- TOÀN BỘ NỘI DUNG TÀI LIỆU ĐƯỢC CHÈN VÀO TRƯỜNG "content".

CÁC NGUYÊN TẮC THIẾT KẾ MOODLE 4.1:
1. Cơ sở dữ liệu: Các bảng có tiền tố mdl_ (vd: mdl_course, mdl_quiz, mdl_user), sử dụng chuẩn XMLDB.
2. Phân quyền (Access Control): Sử dụng Capabilities (vd: mod/...:view, local/...:manage) và Roles (Teacher, Student, Manager).
3. API & Web Service: Định nghĩa external functions theo chuẩn Moodle 4.1 (classes/external/*.php, db/services.php).
4. Giao diện (UI/UX): Moodle Mustache Templates (.mustache) và AMD JavaScript (amd/src/*.js) tương thích theme Boost Bootstrap 5.
5. Bảo mật & Hiệu năng: Chống SQL Injection bằng Moodle $DB API parameterized queries, CSRF require_sesskey(), MUC Cache.

TRẢ VỀ JSON FORMAT CHUẨN:
{
  "featureName": "${featureName}",
  "featureCode": "${pluginDetail ? pluginDetail.component.toUpperCase() : 'MDL-QC-41'}",
  "system": "Moodle 4.1 LMS TNU",
  "version": "${pluginDetail?.release || '1.0'}",
  "author": "CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ TH VIỆT NAM",
  "category": "Phân hệ tính năng Moodle 4.1",
  "targetUsers": "Giảng viên (Teacher), Học viên (Student), Quản trị viên (Admin)",
  "content": "Toàn bộ nội dung tài liệu chi tiết đầy đủ với các đề mục rõ ràng (2.1, 2.2, 2.3...), diễn giải từ ngữ gãy gọn và các bảng kẻ chi tiết..."
}
`;
  }

  /**
   * Build comprehensive unified OpenXML document content using native Word tables (<w:tbl>)
   */
  private buildUnifiedContent(
    docData: any,
    requestedType: MoodleDocType,
    featureName: string,
    input: SkillInput,
    pluginDetail?: MoodlePluginDetail
  ): string {
    const parts: string[] = [];

    if (requestedType === 'dac-ta-chuc-nang' || requestedType === 'all') {
      // 2.1. Mục tiêu và phạm vi hệ thống
      parts.push(WordXmlBuilder.heading2('2.1. Mục tiêu và phạm vi hệ thống'));
      const objectiveText =
        docData.objective ||
        (pluginDetail
          ? `Triển khai phân hệ "${pluginDetail.name}" (${pluginDetail.component}) trên hệ thống Moodle 4.1 LMS TNU, nhằm ${pluginDetail.description || 'nâng cao tính tự động hóa và tối ưu quy trình quản trị đào tạo'}.`
          : `Phát triển và hoàn thiện tính năng "${featureName}" trên nền tảng Moodle 4.1 LMS, tối ưu hóa quy trình quản trị đào tạo và nâng cao tính tự động hóa.`);
      parts.push(WordXmlBuilder.bullet('Mục tiêu xây dựng', objectiveText));
      parts.push(
        WordXmlBuilder.bullet(
          'Phạm vi áp dụng',
          docData.scopeIn ||
            (pluginDetail
              ? `Áp dụng trong phạm vi plugin \`${pluginDetail.path}\` trên toàn hệ thống Moodle 4.1 LMS TNU.`
              : 'Áp dụng cho toàn bộ các khóa học và phân hệ liên quan trên hệ thống Moodle 4.1 LMS TNU.')
        )
      );
      parts.push(
        WordXmlBuilder.bullet(
          'Ngoài phạm vi thực hiện',
          docData.scopeOut ||
            'Không can thiệp vào các hệ thống bên ngoài hoặc thay đổi cấu hình lõi Moodle Core không liên quan.'
        )
      );

      // 2.2. Tổng quan quy trình nghiệp vụ
      parts.push(WordXmlBuilder.heading2('2.2. Tổng quan quy trình nghiệp vụ'));
      let procText = '';
      if (pluginDetail && pluginDetail.services.length > 0) {
        procText =
          `Quy trình vận hành: 1) Người dùng truy cập phân hệ từ khóa học hoặc bảng điều khiển Moodle; ` +
          `2) Hệ thống kiểm tra Capability phân quyền (${pluginDetail.capabilities.map((c) => c.name).join(', ') || 'require_login()'}); ` +
          `3) Giao diện Mustache kết hợp AMD JavaScript gửi yêu cầu qua Web Service/AJAX (${pluginDetail.services.map((s) => s.name).join(', ')}); ` +
          `4) Lớp xử lý PHP (${pluginDetail.classes.map((c) => c.name).slice(0, 3).join(', ') || 'external_api'}) tiếp nhận, validate tham số PARAM_* và tương tác cơ sở dữ liệu qua $DB; ` +
          `5) Phản hồi JSON kết quả trực quan đến người dùng.`;
      } else {
        procText =
          docData.processOverview ||
          docData.workflowDescription ||
          'Quy trình vận hành: 1) Người dùng truy cập chức năng từ khóa học; 2) Hệ thống kiểm tra capability phân quyền; 3) Người dùng thực hiện thao tác nhập liệu/xác nhận; 4) Moodle Web Service tiếp nhận, kiểm tra dữ liệu và lưu trữ an toàn vào cơ sở dữ liệu $DB; 5) Phản hồi kết quả trực quan đến người dùng.';
      }
      parts.push(WordXmlBuilder.paragraph(procText));

      // 2.3. Danh sách yêu cầu chức năng (Functional Requirements)
      parts.push(WordXmlBuilder.heading2('2.3. Danh sách yêu cầu chức năng (Functional Requirements)'));
      parts.push(WordXmlBuilder.paragraph('Dưới đây là bảng tổng hợp các yêu cầu chức năng cần phát triển:'));

      let frs: Array<{ id: string; name: string; priority: string; description: string }> = [];
      if (pluginDetail) {
        let frIdx = 1;
        if (pluginDetail.settings.length > 0) {
          frs.push({
            id: `FR-${String(frIdx++).padStart(2, '0')}`,
            name: 'Quản trị Cấu hình Phân hệ',
            priority: 'Cao',
            description: `Thiết lập các tham số hệ thống (${pluginDetail.settings.map((s) => s.title || s.name).slice(0, 2).join(', ')})`,
          });
        }
        for (const s of pluginDetail.services) {
          frs.push({
            id: `FR-${String(frIdx++).padStart(2, '0')}`,
            name: s.description || s.name,
            priority: 'Cao',
            description: `Web Service [${s.name}]: ${s.classname}::${s.methodname}`,
          });
        }
        if (pluginDetail.tasks.length > 0) {
          for (const t of pluginDetail.tasks) {
            frs.push({
              id: `FR-${String(frIdx++).padStart(2, '0')}`,
              name: 'Tiến trình Chạy ngầm (Cron)',
              priority: 'Trung bình',
              description: `Scheduled Task: ${t.classname} (${t.schedule})`,
            });
          }
        }
        frs.push({
          id: `FR-${String(frIdx++).padStart(2, '0')}`,
          name: 'Giao diện & Tương tác Người dùng',
          priority: 'Trung bình',
          description: `Template Mustache & AMD JavaScript xử lý tương tác thời gian thực`,
        });
      } else {
        frs = docData.functionalRequirements || [
          { id: 'FR-01', name: 'Khởi tạo & Cấu hình Plugin', priority: 'Cao', description: 'Tích hợp vào Moodle 4.1 qua chuẩn Frankenstyle' },
          { id: 'FR-02', name: 'Xử lý tương tác thời gian thực', priority: 'Cao', description: 'Nhận telemetry qua AJAX/Web Service, validate và lưu vào $DB' },
          { id: 'FR-03', name: 'Hiển thị thông báo & Giao diện', priority: 'Trung bình', description: 'Render giao diện Mustache, thông báo trực quan Bootstrap 5' },
        ];
      }

      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Mã YC', align: 'center', width: 1200, dataBold: true },
            { title: 'Tên chức năng', align: 'left', width: 2800, dataBold: true },
            { title: 'Ưu tiên', align: 'center', width: 1200 },
            { title: 'Mô tả chi tiết hành vi hệ thống', align: 'left', width: 4400 },
          ],
          frs.map((fr) => [fr.id || 'FR', fr.name || '', fr.priority || 'Cao', fr.description || '']),
          { colWidths: [1200, 2800, 1200, 4400] }
        )
      );

      // 2.4. Quy tắc nghiệp vụ & Ràng buộc kỹ thuật (Business Rules)
      parts.push(WordXmlBuilder.heading2('2.4. Quy tắc nghiệp vụ & Ràng buộc kỹ thuật (Business Rules)'));
      parts.push(WordXmlBuilder.paragraph('Các nguyên tắc ràng buộc nghiệp vụ bắt buộc tuân thủ:'));

      let brs: Array<{ id: string; name: string; description: string }> = [];
      if (pluginDetail) {
        let brIdx = 1;
        if (pluginDetail.capabilities.length > 0) {
          brs.push({
            id: `BR-${String(brIdx++).padStart(2, '0')}`,
            name: 'Kiểm soát Phân quyền (Access)',
            description: `Bắt buộc kiểm tra capability: ${pluginDetail.capabilities[0].name}`,
          });
        }
        if (pluginDetail.securityChecks.hasSesskeyCheck) {
          brs.push({
            id: `BR-${String(brIdx++).padStart(2, '0')}`,
            name: 'Bảo mật Chống tấn công CSRF',
            description: 'Yêu cầu kiểm tra require_sesskey() cho mọi thao tác ghi dữ liệu',
          });
        }
        if (pluginDetail.securityChecks.requiredParams.length > 0) {
          brs.push({
            id: `BR-${String(brIdx++).padStart(2, '0')}`,
            name: 'Xác thực Tham số Đầu vào',
            description: `Kiểm tra hợp lệ bắt buộc các tham số: ${pluginDetail.securityChecks.requiredParams.slice(0, 4).join(', ')}`,
          });
        }
        brs.push({
          id: `BR-${String(brIdx++).padStart(2, '0')}`,
          name: 'Toàn vẹn Dữ liệu CSDL $DB',
          description: 'Sử dụng transaction và parameterized queries, rollback khi có lỗi',
        });
      } else {
        brs = docData.businessRules || [
          { id: 'BR-01', name: 'Kiểm soát quyền truy cập', description: 'Bắt buộc kiểm tra has_capability() hoặc require_capability()' },
          { id: 'BR-02', name: 'Bảo mật phiên & Chống CSRF', description: 'Yêu cầu kiểm tra require_sesskey() cho mọi thao tác ghi dữ liệu' },
          { id: 'BR-03', name: 'Kiểm tra toàn vẹn dữ liệu', description: 'Validate tham số PARAM_*; rollback giao dịch nếu có lỗi phát sinh' },
        ];
      }

      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Mã QT', align: 'center', width: 1200, dataBold: true },
            { title: 'Tên quy tắc nghiệp vụ', align: 'left', width: 2800, dataBold: true },
            { title: 'Ràng buộc kỹ thuật & Xử lý ngoại lệ', align: 'left', width: 5600 },
          ],
          brs.map((br) => [br.id || 'BR', br.name || '', br.description || '']),
          { colWidths: [1200, 2800, 5600] }
        )
      );

      // 2.5. Ma trận phân quyền vai trò (Role Permission Matrix)
      parts.push(WordXmlBuilder.heading2('2.5. Ma trận phân quyền vai trò (Role Permission Matrix)'));
      parts.push(WordXmlBuilder.paragraph('Bảng phân định quyền hạn theo từng vai trò trong hệ thống Moodle:'));

      let roleRows: (string | number)[][] = [];
      if (pluginDetail && pluginDetail.capabilities.length > 0) {
        const hasManager = pluginDetail.capabilities.some((c) => c.archetypes['manager'] === 'CAP_ALLOW');
        const hasTeacher = pluginDetail.capabilities.some((c) => c.archetypes['editingteacher'] === 'CAP_ALLOW');
        const hasStudent = pluginDetail.capabilities.some((c) => c.archetypes['student'] === 'CAP_ALLOW');

        roleRows = [
          ['Quản trị viên hệ thống (Admin)', 'Cho phép', 'Cho phép', 'Cho phép', 'Cho phép'],
          [
            'Quản lý phân hệ (Manager)',
            hasManager ? 'Cho phép' : 'Từ chối',
            hasManager ? 'Cho phép' : 'Từ chối',
            hasManager ? 'Cho phép' : 'Từ chối',
            hasManager ? 'Cho phép' : 'Từ chối',
          ],
          [
            'Giảng viên quản lý khóa (Teacher)',
            hasTeacher ? 'Cho phép' : 'Từ chối',
            hasTeacher ? 'Cho phép' : 'Từ chối',
            hasTeacher ? 'Cho phép' : 'Từ chối',
            'Từ chối',
          ],
          ['Học viên tham gia (Student)', hasStudent ? 'Cho phép' : 'Từ chối', 'Từ chối', 'Từ chối', 'Từ chối'],
        ];
      } else {
        roleRows = [
          ['Quản trị viên hệ thống (Admin)', 'Cho phép', 'Cho phép', 'Cho phép', 'Cho phép'],
          ['Giảng viên quản lý khóa (Teacher)', 'Cho phép', 'Cho phép', 'Cho phép', 'Từ chối'],
          ['Giảng viên trợ giảng (Non-editing)', 'Cho phép', 'Từ chối', 'Từ chối', 'Từ chối'],
          ['Học viên tham gia (Student)', 'Cho phép', 'Tùy mục', 'Từ chối', 'Từ chối'],
        ];
      }

      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Vai trò người dùng (Roles)', align: 'left', width: 3600, dataBold: true },
            { title: 'Xem (View)', align: 'center', width: 1500 },
            { title: 'Tạo (Add)', align: 'center', width: 1500 },
            { title: 'Sửa (Edit)', align: 'center', width: 1500 },
            { title: 'Xóa (Del)', align: 'center', width: 1500 },
          ],
          roleRows,
          { colWidths: [3600, 1500, 1500, 1500, 1500] }
        )
      );

      // 2.6. Đặc tả kịch bản Use Case chi tiết
      parts.push(WordXmlBuilder.heading2('2.6. Đặc tả kịch bản Use Case chi tiết'));
      const ucActor =
        docData.useCaseActor ||
        (pluginDetail?.capabilities.some((c) => 'student' in c.archetypes)
          ? 'Giảng viên (Teacher), Học viên (Student), Quản trị viên (Admin)'
          : 'Giảng viên quản trị khóa (Teacher), Quản trị viên hệ thống (Admin)');
      const ucPre =
        docData.useCasePreCondition ||
        `Người dùng đã đăng nhập Moodle, có quyền hạn phù hợp (${pluginDetail?.capabilities[0]?.name || 'has_capability'})`;

      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Hạng mục đặc tả', align: 'left', width: 2800, dataBold: true },
            { title: 'Nội dung chi tiết', align: 'left', width: 6800 },
          ],
          [
            ['Tên Use Case', `Thực hiện chức năng ${featureName}`],
            ['Tác nhân (Actor)', ucActor],
            ['Điều kiện tiên quyết', ucPre],
            [
              'Luồng sự kiện chính',
              '1. Người dùng truy cập phân hệ qua menu hoặc URL khóa học\n' +
                '2. Hệ thống kiểm tra quyền hạn và tải dữ liệu giao diện tương ứng\n' +
                '3. Người dùng nhập thông tin và nhấn nút xác nhận thực thi\n' +
                '4. Hệ thống validate, lưu trữ vào CSDL $DB và thông báo thành công',
            ],
            [
              'Luồng ngoại lệ',
              '• Dữ liệu sai định dạng: Hệ thống báo lỗi cụ thể, giữ nguyên form nhập liệu\n' +
                '• Mất kết nối CSDL: Báo lỗi hệ thống, tự động rollback giao dịch an toàn',
            ],
            ['Kết quả đạt được', 'Dữ liệu được ghi nhận chính xác vào cơ sở dữ liệu Moodle TNU'],
          ],
          { colWidths: [2800, 6800] }
        )
      );

      // 2.7 CSDL Schema
      if (pluginDetail && pluginDetail.tables.length > 0) {
        parts.push(WordXmlBuilder.heading2('2.7. Cấu trúc Cơ sở dữ liệu Thực tế (XMLDB Tables)'));
        parts.push(WordXmlBuilder.paragraph('Các bảng dữ liệu được định nghĩa trực tiếp trong mã nguồn của plugin:'));

        for (const tbl of pluginDetail.tables) {
          parts.push(WordXmlBuilder.heading3(`Bảng CSDL: mdl_${tbl.name}`));
          const tblRows = tbl.fields.map((f) => {
            const fType = `${f.type}${f.length ? `(${f.length})` : ''}`;
            const fNull = f.notNull ? 'NOT NULL' : 'NULL';
            const fComment = (f.isPrimaryKey ? '[PK] ' : '') + (f.comment || '');
            return [f.name, fType, fNull, fComment];
          });
          parts.push(
            WordXmlBuilder.table(
              [
                { title: 'Tên cột (Field)', align: 'left', width: 2400, dataBold: true },
                { title: 'Kiểu dữ liệu', align: 'center', width: 2000 },
                { title: 'Nullable', align: 'center', width: 1400 },
                { title: 'Ý nghĩa & Ràng buộc', align: 'left', width: 3800 },
              ],
              tblRows,
              { colWidths: [2400, 2000, 1400, 3800] }
            )
          );
        }
      }

      // 2.8. Tiêu chí nghiệm thu & Kiểm thử (Acceptance Criteria)
      parts.push(WordXmlBuilder.heading2('2.8. Tiêu chí nghiệm thu & Kiểm thử (Acceptance Criteria)'));
      const acs = docData.acceptanceCriteria || [
        { id: 'AC-01', name: 'Tính chính xác nghiệp vụ', description: 'Xử lý đúng 100% logic, không phát sinh lỗi dữ liệu' },
        { id: 'AC-02', name: 'Bảo mật & Phân quyền', description: 'Chặn truy cập trái phép khi người dùng không đủ quyền' },
        { id: 'AC-03', name: 'Hiệu năng phản hồi', description: 'Thời gian xử lý < 500ms đối với thao tác thông thường' },
        { id: 'AC-04', name: 'Tương thích giao diện', description: 'Hiển thị chuẩn trên giao diện Moodle Boost (Responsive)' },
      ];
      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Mã TC', align: 'center', width: 1200, dataBold: true },
            { title: 'Hạng mục kiểm thử', align: 'left', width: 2800, dataBold: true },
            { title: 'Kết quả mong đợi & Tiêu chí đạt (Pass)', align: 'left', width: 5600 },
          ],
          acs.map((ac: any) => [ac.id || 'AC', ac.name || ac.description || '', ac.description || '']),
          { colWidths: [1200, 2800, 5600] }
        )
      );
    } else if (requestedType === 'phan-tich-thiet-ke') {
      // 2.1. Tiêu chuẩn chấp nhận & Yêu cầu phi chức năng
      parts.push(WordXmlBuilder.heading2('2.1. Tiêu chuẩn chấp nhận & Yêu cầu phi chức năng'));
      parts.push(
        WordXmlBuilder.paragraph(
          docData.acceptanceStandards ||
            'Độ trễ phản hồi API < 200ms, hỗ trợ tải đồng thời cao, tương thích chuẩn Moodle 4.1 LTS, PHP 8.1+ và MySQL 8.0/MariaDB 10.6.'
        )
      );

      // 2.2. Luồng xử lý dữ liệu và tương tác các tầng
      parts.push(WordXmlBuilder.heading2('2.2. Luồng xử lý dữ liệu và tương tác các tầng'));
      let flowText = '';
      if (pluginDetail && pluginDetail.services.length > 0) {
        flowText =
          `Luồng tương tác: Giao diện Mustache (${pluginDetail.templates.join(', ') || 'index'}) -> ` +
          `AMD JavaScript Module (${pluginDetail.amdModules.join(', ') || 'main'}) -> ` +
          `Moodle Routing -> Web Service Controller (${pluginDetail.services.map((s) => s.classname).join(', ')}) -> ` +
          `Kiểm tra Capability (${pluginDetail.capabilities.map((c) => c.name).join(', ') || 'has_capability'}) -> ` +
          `Thao tác cơ sở dữ liệu qua $DB Abstraction Layer.`;
      } else {
        flowText =
          docData.workflowDescription ||
          'Luồng tương tác: Giao diện Mustache -> AMD JavaScript AJAX -> Moodle Routing -> External Service Controller -> Kiểm tra Capability -> Thao tác cơ sở dữ liệu qua $DB Abstraction Layer.';
      }
      parts.push(WordXmlBuilder.paragraph(flowText));

      // 2.3. Yêu cầu môi trường & Cấu hình Moodle 4.1
      parts.push(WordXmlBuilder.heading2('2.3. Yêu cầu môi trường & Cấu hình Moodle 4.1'));
      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Thành phần', align: 'left', width: 2600, dataBold: true },
            { title: 'Yêu cầu kỹ thuật & Phiên bản tương thích', align: 'left', width: 7000 },
          ],
          [
            ['Moodle Core', `Moodle 4.1 LTS (Build 20221128 trở lên, require: ${pluginDetail?.requires || '4.1'})`],
            ['Ngôn ngữ PHP', 'PHP 8.1 hoặc PHP 8.2 (extensions: pdo, mysqli, mbstring, zip, xml)'],
            ['Cơ sở dữ liệu', 'MySQL 8.0 hoặc MariaDB 10.6+ (Collation: utf8mb4_unicode_ci)'],
            ['Trình duyệt', 'Chrome, Edge, Firefox, Safari phiên bản mới nhất'],
          ],
          { colWidths: [2600, 7000] }
        )
      );

      // 2.4. Bảng định nghĩa Capabilities & Quyền hạn (db/access.php)
      parts.push(WordXmlBuilder.heading2('2.4. Bảng định nghĩa Capabilities & Quyền hạn (db/access.php)'));
      let capRows: (string | number)[][] = [];
      if (pluginDetail && pluginDetail.capabilities.length > 0) {
        capRows = pluginDetail.capabilities.map((cap) => {
          const roles = Object.keys(cap.archetypes).slice(0, 3).join(', ');
          const ctx = cap.contextlevel.replace('CONTEXT_', '');
          return [cap.name, cap.captype, ctx, roles || 'Admin'];
        });
      } else {
        capRows = [
          ['local/th_plugin:view', 'read', 'COURSE', 'Teacher, Student'],
          ['local/th_plugin:manage', 'write', 'COURSE', 'Manager, Teacher'],
        ];
      }
      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Tên Capability', align: 'left', width: 3400, dataBold: true },
            { title: 'Loại quyền', align: 'center', width: 1400 },
            { title: 'Context Level', align: 'center', width: 2000 },
            { title: 'Phân quyền mặc định', align: 'left', width: 2800 },
          ],
          capRows,
          { colWidths: [3400, 1400, 2000, 2800] }
        )
      );

      // 2.5. Thiết kế Cơ sở dữ liệu (Database Schema)
      parts.push(WordXmlBuilder.heading2('2.5. Thiết kế Cơ sở dữ liệu (Database Schema)'));
      parts.push(WordXmlBuilder.paragraph('Bảng lưu trữ được thiết kế theo chuẩn XMLDB Moodle:'));
      if (pluginDetail && pluginDetail.tables.length > 0) {
        for (const tbl of pluginDetail.tables) {
          parts.push(WordXmlBuilder.heading3(`Bảng CSDL: mdl_${tbl.name}`));
          const tblRows = tbl.fields.map((f) => {
            const fType = `${f.type}${f.length ? `(${f.length})` : ''}`;
            const fNull = f.notNull ? 'NOT NULL' : 'NULL';
            const fComment = (f.isPrimaryKey ? '[PK] ' : '') + (f.comment || '');
            return [f.name, fType, fNull, fComment];
          });
          parts.push(
            WordXmlBuilder.table(
              [
                { title: 'Tên cột (Field)', align: 'left', width: 2400, dataBold: true },
                { title: 'Kiểu dữ liệu', align: 'center', width: 2000 },
                { title: 'Nullable', align: 'center', width: 1400 },
                { title: 'Ý nghĩa & Ràng buộc', align: 'left', width: 3800 },
              ],
              tblRows,
              { colWidths: [2400, 2000, 1400, 3800] }
            )
          );
        }
      } else {
        parts.push(
          WordXmlBuilder.table(
            [
              { title: 'Tên cột (Field)', align: 'left', width: 2400, dataBold: true },
              { title: 'Kiểu dữ liệu', align: 'center', width: 2000 },
              { title: 'Nullable', align: 'center', width: 1400 },
              { title: 'Ý nghĩa & Ràng buộc', align: 'left', width: 3800 },
            ],
            [
              ['id', 'BIGINT(10)', 'NOT NULL', 'Khóa chính (Primary Key, Auto Inc)'],
              ['courseid', 'BIGINT(10)', 'NOT NULL', 'ID khóa học (Foreign key: mdl_course)'],
              ['userid', 'BIGINT(10)', 'NOT NULL', 'ID người dùng (Foreign key: mdl_user)'],
              ['status', 'VARCHAR(50)', 'NOT NULL', 'Trạng thái xử lý bản ghi'],
              ['timecreated', 'BIGINT(10)', 'NOT NULL', 'Thời điểm khởi tạo (Timestamp)'],
              ['timemodified', 'BIGINT(10)', 'NOT NULL', 'Thời điểm cập nhật cuối (Timestamp)'],
            ],
            { colWidths: [2400, 2000, 1400, 3800] }
          )
        );
      }

      // 2.6. Thiết kế Web Service API (db/services.php)
      parts.push(WordXmlBuilder.heading2('2.6. Thiết kế Web Service API (db/services.php)'));
      let serviceRows: (string | number)[][] = [];
      if (pluginDetail && pluginDetail.services.length > 0) {
        serviceRows = pluginDetail.services.map((s) => [
          s.name,
          s.isAjax ? 'AJAX' : 'External',
          s.classname.split('\\').pop() || s.classname,
          s.description || s.name,
        ]);
      } else {
        serviceRows = [
          ['get_data_service', 'AJAX (read)', 'external\\get_data', 'Tải dữ liệu hiển thị giao diện'],
          ['save_data_service', 'AJAX (write)', 'external\\save_data', 'Lưu trữ thông tin và cập nhật $DB'],
        ];
      }
      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Tên hàm Web Service', align: 'left', width: 3200, dataBold: true },
            { title: 'Giao thức', align: 'center', width: 1400 },
            { title: 'Lớp thực thi (Classname)', align: 'left', width: 2600 },
            { title: 'Mô tả chức năng API', align: 'left', width: 2400 },
          ],
          serviceRows,
          { colWidths: [3200, 1400, 2600, 2400] }
        )
      );

      // 2.7. Chiến lược Bảo mật & Tối ưu hiệu năng
      parts.push(WordXmlBuilder.heading2('2.7. Chiến lược Bảo mật & Tối ưu hiệu năng'));
      parts.push(
        WordXmlBuilder.bullet(
          'Chống SQL Injection',
          '100% truy vấn thực hiện qua $DB API parameterized queries (:param hoặc ?), tuyệt đối không nối chuỗi biến trực tiếp.'
        )
      );
      parts.push(
        WordXmlBuilder.bullet(
          'Chống tấn công CSRF',
          'Bắt buộc gọi require_sesskey() đối với tất cả các thao tác thay đổi dữ liệu hoặc AJAX write request.'
        )
      );
      parts.push(
        WordXmlBuilder.bullet(
          'Kiểm soát phân quyền',
          'Kiểm tra chặt chẽ require_capability() tại controller và Web Service API.'
        )
      );
      parts.push(
        WordXmlBuilder.bullet(
          'Bộ nhớ đệm Caching',
          'Sử dụng Moodle Universal Cache (MUC) để cache cấu hình và metadata, tối ưu hiệu năng phản hồi < 200ms.'
        )
      );
    } else if (requestedType === 'yeu-cau-nghiep-vu') {
      // 2.1. Thông tin hiện trạng & Sự cần thiết
      parts.push(WordXmlBuilder.heading2('2.1. Thông tin hiện trạng & Sự cần thiết'));
      parts.push(
        WordXmlBuilder.bullet(
          'Hiện trạng hệ thống',
          docData.oldFeatureDescription ||
            'Quy trình hiện tại trên Moodle 4.1 còn phụ thuộc vào thao tác thủ công, tốn nhiều thời gian và tiềm ẩn rủi ro sai sót.'
        )
      );
      parts.push(
        WordXmlBuilder.bullet(
          'Nhu cầu thực tế',
          docData.newFeatureDescription ||
            pluginDetail?.description ||
            input.requirements ||
            `Cần giải pháp tự động hóa tập trung cho phân hệ ${featureName} trên hệ thống Moodle 4.1 LMS.`
        )
      );

      // 2.2. Mục tiêu kinh doanh & Nghiệp vụ
      parts.push(WordXmlBuilder.heading2('2.2. Mục tiêu kinh doanh & Nghiệp vụ'));
      parts.push(
        WordXmlBuilder.paragraph(
          docData.objective ||
            `Nâng cao hiệu suất xử lý, tự động hóa 90% thao tác định kỳ và bảo đảm tính toàn vẹn dữ liệu cho ${featureName}.`
        )
      );

      // 2.3. Bảng tổng hợp yêu cầu nghiệp vụ chi tiết
      parts.push(WordXmlBuilder.heading2('2.3. Bảng tổng hợp yêu cầu nghiệp vụ chi tiết'));
      let reqs: Array<{ id: string; name: string; description: string }> = [];
      if (pluginDetail) {
        let rIdx = 1;
        if (pluginDetail.settings.length > 0) {
          reqs.push({
            id: `R${String(rIdx++).padStart(3, '0')}`,
            name: 'Thiết lập tham số quản trị',
            description: `Cung cấp giao diện cấu hình tham số cho quản trị viên (${pluginDetail.settings.map((s) => s.title || s.name).slice(0, 2).join(', ')})`,
          });
        }
        for (const s of pluginDetail.services) {
          reqs.push({
            id: `R${String(rIdx++).padStart(3, '0')}`,
            name: s.description || s.name,
            description: `Thực thi tác vụ: ${s.description || s.name} qua giao diện web`,
          });
        }
        reqs.push({
          id: `R${String(rIdx++).padStart(3, '0')}`,
          name: 'Phân quyền & Kiểm soát truy cập',
          description: 'Đảm bảo chỉ người dùng có quyền hạn phù hợp mới được thao tác',
        });
      } else {
        reqs = docData.requirements || [
          { id: 'R001', name: 'Tự động hóa xử lý dữ liệu', description: 'Tự động đối soát và cập nhật dữ liệu vào khóa học' },
          { id: 'R002', name: 'Nhật ký & Báo cáo kết quả', description: 'Cung cấp báo cáo xuất file Excel chi tiết các lượt xử lý' },
          { id: 'R003', name: 'Phân quyền người dùng', description: 'Chỉ cán bộ có thẩm quyền mới được truy cập tính năng' },
        ];
      }

      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Mã YC', align: 'center', width: 1200, dataBold: true },
            { title: 'Tên yêu cầu nghiệp vụ', align: 'left', width: 2800, dataBold: true },
            { title: 'Nội dung chi tiết & Kết quả mong muốn', align: 'left', width: 5600 },
          ],
          reqs.map((r) => [r.id || 'R', r.name || '', r.description || '']),
          { colWidths: [1200, 2800, 5600] }
        )
      );

      // 2.4. Tiêu chí nghiệm thu nghiệp vụ
      parts.push(WordXmlBuilder.heading2('2.4. Tiêu chí nghiệm thu nghiệp vụ'));
      parts.push(
        WordXmlBuilder.bullet(
          'Nghiệp vụ chính xác',
          'Xử lý đúng 100% dữ liệu theo các quy tắc nghiệp vụ đã thống nhất.'
        )
      );
      parts.push(
        WordXmlBuilder.bullet(
          'Dễ sử dụng',
          'Giao diện trực quan, người dùng có thể thao tác thành thạo sau 5 phút hướng dẫn.'
        )
      );
      parts.push(
        WordXmlBuilder.bullet(
          'Báo cáo rõ ràng',
          'Thống kê kết quả rõ ràng, minh bạch, bảo đảm an toàn dữ liệu.'
        )
      );
    } else if (requestedType === 'huong-dan-su-dung') {
      // 2.1. Hướng dẫn dành cho Cán bộ Quản trị & Giảng viên (Teacher / Admin)
      parts.push(WordXmlBuilder.heading2('2.1. Hướng dẫn dành cho Cán bộ Quản trị & Giảng viên (Teacher / Admin)'));
      parts.push(WordXmlBuilder.numberedStep(1, 'Đăng nhập vào hệ thống LMS Moodle 4.1 với tài khoản có quyền hạn phù hợp.'));
      if (pluginDetail) {
        parts.push(WordXmlBuilder.numberedStep(2, `Truy cập vào phân hệ tại đường dẫn: \`${pluginDetail.path}\` hoặc từ menu khóa học.`));
        if (pluginDetail.settings.length > 0) {
          parts.push(WordXmlBuilder.numberedStep(3, 'Kiểm tra và thiết lập các thông số trong Cài đặt Quản trị Site (Site Administration):'));
          for (const s of pluginDetail.settings.slice(0, 3)) {
            parts.push(WordXmlBuilder.bullet(s.title || s.name, s.description || 'Theo dõi và điều chỉnh giá trị phù hợp'));
          }
        }
      } else {
        parts.push(WordXmlBuilder.numberedStep(2, 'Truy cập vào khóa học hoặc bảng điều khiển cần quản trị.'));
        parts.push(WordXmlBuilder.numberedStep(3, `Chọn menu tính năng "${featureName}".`));
      }
      parts.push(WordXmlBuilder.numberedStep(4, 'Điền các tham số hoặc chọn các hoạt động/khóa học cần áp dụng.'));
      parts.push(WordXmlBuilder.numberedStep(5, 'Nhấn nút "Lưu thay đổi" / "Xác nhận" và kiểm tra thông báo trạng thái trên màn hình.'));

      // 2.2. Hướng dẫn dành cho Người dùng cuối / Học viên (Student)
      parts.push(WordXmlBuilder.heading2('2.2. Hướng dẫn dành cho Người dùng cuối / Học viên (Student)'));
      parts.push(WordXmlBuilder.numberedStep(1, 'Đăng nhập vào hệ thống LMS Moodle 4.1 bằng tài khoản người dùng cá nhân.'));
      parts.push(WordXmlBuilder.numberedStep(2, 'Truy cập vào khóa học đang tham gia trên hệ thống.'));
      parts.push(WordXmlBuilder.numberedStep(3, 'Theo dõi các mốc thời gian, tài liệu bài học và bài kiểm tra.'));
      parts.push(WordXmlBuilder.numberedStep(4, 'Hoàn thành các hoạt động theo đúng kế hoạch học tập.'));

      // 2.3. Bảng xử lý sự cố thường gặp (Troubleshooting)
      parts.push(WordXmlBuilder.heading2('2.3. Bảng xử lý sự cố thường gặp (Troubleshooting)'));
      parts.push(
        WordXmlBuilder.table(
          [
            { title: 'Hiện tượng sự cố', align: 'left', width: 2800, dataBold: true },
            { title: 'Nguyên nhân khả dĩ', align: 'left', width: 3000 },
            { title: 'Cách khắc phục', align: 'left', width: 3800 },
          ],
          [
            ['Thông báo "Không có quyền truy cập"', 'Tài khoản chưa được gán capability phù hợp', 'Liên hệ Quản trị viên hệ thống để được cấp quyền'],
            ['Lỗi tệp không hợp lệ khi tải lên', 'Sai định dạng file (.xlsx / .csv) hoặc quá dung lượng', 'Tải đúng tệp mẫu và kiểm tra lại các cột dữ liệu'],
            ['Giao diện không phản hồi hoặc mất phiên', 'Phiên làm việc Moodle hết hạn (Sesskey timeout)', 'Nhấn F5 để tải lại trang hoặc đăng nhập lại hệ thống'],
            ['Dữ liệu cập nhật chưa hiển thị ngay', 'Bộ nhớ đệm MUC Cache đang lưu trạng thái cũ', 'Quản trị viên thực hiện xóa cache (Purge caches)'],
          ],
          { colWidths: [2800, 3000, 3800] }
        )
      );
    }

    return parts.join('\n');
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
  subgraph Core["Moodle 4.1 Application Layer"]
    Router[Routing / AJAX Gateway]
    WS[External API / Web Service]
    Auth[Access Control & Capabilities]
    Logic[Plugin Business Logic]
  end
  subgraph Data["Data & Persistence Layer"]
    MUC[Moodle Universal Cache - MUC]
    DB[($DB) MySQL 8.0 / MariaDB]
  end
  UI --> AMD
  AMD --> Router
  Router --> WS
  WS --> Auth
  Auth --> Logic
  Logic --> MUC
  Logic --> DB`;
  }

  private generateDefaultErdDiagram(context: UnifiedProjectContext): string {
    return `erDiagram
  mdl_course ||--o{ mdl_quiz : "contains"
  mdl_quiz ||--o{ mdl_quiz_attempts : "has"
  mdl_user ||--o{ mdl_quiz_attempts : "submits"
  mdl_course {
    bigint id PK
    string fullname
    string shortname
  }
  mdl_quiz {
    bigint id PK
    bigint course FK
    string name
    bigint timeopen
    bigint timeclose
  }
  mdl_quiz_attempts {
    bigint id PK
    bigint quiz FK
    bigint userid FK
    int attempt
    decimal sumgrades
  }`;
  }
}
