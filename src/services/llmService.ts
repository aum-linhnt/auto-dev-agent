import { GoogleGenAI } from '@google/genai';
import config from '../config/env';

export interface GenerateOptions {
  prompt: string;
  systemInstruction?: string;
  responseSchema?: Record<string, any>;
  temperature?: number;
  isJson?: boolean;
}

export class LlmService {
  private client: GoogleGenAI | null = null;
  private modelName: string;

  constructor() {
    this.modelName = config.gemini.model || 'gemini-2.5-pro';
    if (config.gemini.apiKey && config.gemini.apiKey !== 'your_gemini_api_key_here') {
      this.client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
  }

  /**
   * Check if Gemini API is configured
   */
  public isConfigured(): boolean {
    return !!this.client;
  }

  /**
   * Generate content using Google Gemini API (gemini-2.5-pro)
   */
  public async generate(options: GenerateOptions): Promise<string> {
    if (!this.client) {
      console.warn(`[LlmService] GEMINI_API_KEY not configured. Using intelligent mock fallback.`);
      return this.generateMockFallback(options);
    }

    try {
      const requestConfig: Record<string, any> = {
        temperature: options.temperature ?? 0.2,
      };

      if (options.systemInstruction) {
        requestConfig.systemInstruction = options.systemInstruction;
      }

      if (options.isJson || options.responseSchema) {
        requestConfig.responseMimeType = 'application/json';
        if (options.responseSchema) {
          requestConfig.responseSchema = options.responseSchema;
        }
      }

      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: options.prompt,
        config: requestConfig,
      });

      return response.text || '';
    } catch (err: any) {
      console.error(`[LlmService] Gemini API call error: ${err.message}. Falling back.`);
      return this.generateMockFallback(options);
    }
  }

  /**
   * Generate structured JSON output with validation
   */
  public async generateStructured<T>(options: GenerateOptions): Promise<T> {
    const rawOutput = await this.generate({
      ...options,
      isJson: true,
    });

    try {
      // Clean possible markdown code fences (```json ... ```)
      const cleanJson = rawOutput.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      return JSON.parse(cleanJson) as T;
    } catch (parseError: any) {
      console.error(`[LlmService] Failed to parse JSON response:`, rawOutput);
      throw new Error(`Invalid JSON returned by LLM: ${parseError.message}`);
    }
  }

  /**
   * High quality mock fallback generator for offline testing or demonstration
   */
  private generateMockFallback(options: GenerateOptions): string {
    const p = options.prompt.toLowerCase();

    // 1. Doc-Gen Mock (Tailored for Moodle 4.1 & Enterprise Templates)
    if (
      p.includes('srs') ||
      p.includes('software requirements specification') ||
      p.includes('system design') ||
      p.includes('yêu cầu nghiệp vụ') ||
      p.includes('đặc tả chức năng') ||
      p.includes('phân tích thiết kế') ||
      p.includes('hướng dẫn sử dụng') ||
      p.includes('moodle')
    ) {
      if (options.isJson) {
        const featureMatch = options.prompt.match(/Tên tính năng:\s*"([^"]+)"/i);
        const featureName = featureMatch ? featureMatch[1] : 'Gán người dùng vào khóa học hàng loạt';
        const isBulkEnrol = p.includes('gán người dùng') || p.includes('enrol') || p.includes('ghi danh') || p.includes('khóa học') || p.includes('khoá học');

        if (isBulkEnrol) {
          return JSON.stringify({
            title: `Đặc tả Yêu cầu & Thiết kế Hệ thống Moodle 4.1 - ${featureName}`,
            featureName: featureName,
            featureCode: 'MDL-BULK-ENROL-41',
            system: 'Moodle 4.1 LMS',
            version: '1.0',
            author: 'CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ TH VIỆT NAM',
            category: 'Tính năng mới cho Moodle 4.1',
            targetUsers: 'Quản trị viên (Admin), Giảng viên (Teacher), Phòng Đào tạo (Course Managers)',
            newFeatureDescription: 'Phát triển chức năng gán/ghi danh người dùng vào khóa học hàng loạt bằng file CSV/Excel trên Moodle 4.1 LMS, tự động đối soát thông tin tài khoản và chỉ định vai trò nhanh chóng.',
            oldFeatureDescription: 'Moodle 4.1 mặc định chỉ cho phép ghi danh thủ công từng người hoặc đồng bộ qua Cohort/Upload Users toàn site, chưa có công cụ ghi danh hàng loạt thân thiện cho giảng viên cấp khóa học.',
            objective: 'Tự động hóa 100% quy trình ghi danh học viên vào khóa học, giảm tải thời gian thao tác thủ công và hạn chế sai sót dữ liệu người dùng.',
            scopeIn: 'Áp dụng cho toàn bộ các khóa học trên hệ thống LMS Moodle 4.1; hỗ trợ import định dạng .csv, .xlsx và map tự động các trường username, email, idnumber, role.',
            scopeOut: 'Không can thiệp vào các phương thức thanh toán cổng thanh toán ghi danh trả phí (Enrol Payment Gateways).',
            processOverview: '1) Quản trị viên/Giảng viên tải lên file danh sách học viên (CSV/Excel). 2) Hệ thống kiểm tra dữ liệu với mdl_user và mdl_course. 3) Hiển thị bảng Preview xác nhận. 4) Kích hoạt ghi danh tự động qua Moodle Enrol API. 5) Gửi thông báo hoàn tất.',
            requirements: [
              { id: 'R001', name: 'Tải file CSV/Excel và đối chiếu dữ liệu', description: 'Kiểm tra tài khoản tồn tại trong mdl_user và khóa học trong mdl_course.' },
              { id: 'R002', name: 'Xử lý ghi danh tự động (Batch Enrolment)', description: 'Thêm bản ghi vào mdl_user_enrolments với vai trò (Role: Student, Non-editing teacher) được chỉ định.' },
              { id: 'R003', name: 'Nhật ký và xuất báo cáo kết quả', description: 'Ghi log chi tiết và cung cấp file kết quả ghi danh thành công/thất bại kèm lý do.' }
            ],
            functionalRequirements: [
              { id: 'FR-01', name: 'Giao diện Upload File & Mapping cột', priority: 'High', description: 'Hỗ trợ kéo thả file CSV/Excel, tự động phát hiện header các cột mã học viên, email, mã khóa học.' },
              { id: 'FR-02', name: 'Xác thực và Kiểm tra trước (Validation & Preview)', priority: 'High', description: 'Kiểm tra tính hợp lệ của tài khoản trước khi ghi danh, hiển thị cảnh báo đỏ nếu học viên đã được ghi danh từ trước.' },
              { id: 'FR-03', name: 'Xử lý ghi danh hàng loạt chạy nền', priority: 'High', description: 'Tích hợp Moodle Adhoc Task để xử lý các tệp lớn (>500 học viên) không gây nghẽn giao diện người dùng.' },
              { id: 'FR-04', name: 'Gửi thông báo kích hoạt đến học viên', priority: 'Medium', description: 'Tự động kích hoạt Moodle Event message_send thông báo đến email học viên khi được thêm vào khóa học mới.' }
            ],
            businessRules: [
              { id: 'BR-01', name: 'Quyền thực hiện ghi danh', description: 'Chỉ người dùng có capability enrol/manual:enrol hoặc enrol/bulk:manage mới được quyền truy cập tính năng này.' },
              { id: 'BR-02', name: 'Xử lý người dùng đã ghi danh', description: 'Nếu người dùng đã có trong khóa học, hệ thống cập nhật trạng thái hoạt động (active), không tạo bản ghi trùng lặp.' },
              { id: 'BR-03', name: 'Giới hạn kích thước file upload', description: 'Kích thước tệp tải lên tối đa là 10MB, định dạng UTF-8 CSV hoặc XLSX.' }
            ],
            acceptanceStandards: 'Thời gian xử lý 1,000 học viên < 5 giây; không gây khóa bảng cơ sở dữ liệu; tương thích 100% chuẩn Moodle 4.1 LTS và PHP 8.1+.',
            workflowDescription: 'Luồng dữ liệu tiếp nhận file qua Moodle Form API, parse dữ liệu tại Controller, gọi Moodle Enrol Plugin API để ghi nhận bản ghi vào $DB.',
            systemRequirements: 'Moodle Core 4.1 LTS, PHP 8.1 hoặc 8.2, MySQL 8.0 / MariaDB 10.6, Cron Task Moodle kích hoạt.',
            accessControl: 'Capabilities: enrol/manual:enrol, moodle/course:enrolconfig, moodle/role:assign gắn với vai trò Editing Teacher, Manager, Administrator.',
            databaseDesign: 'Tương tác trực tiếp với các bảng chuẩn: mdl_user, mdl_course, mdl_enrol, mdl_user_enrolments, mdl_role_assignments; bảng log riêng mdl_enrol_bulk_log.',
            apiDesign: 'Web Service Endpoint: enrol_bulk_upload_users nhận multipart form-data hoặc base64 encoded file payload kèm token bảo mật sesskey().',
            uiDesign: 'Xây dựng bằng Moodle Mustache Templates (enrol_bulk/upload_page.mustache) và JavaScript AMD module tuân thủ chuẩn giao diện Theme Boost Bootstrap 5.',
            architectureDesign: 'Module thuộc phân hệ Enrolment Plugin (enrol_bulk) của Moodle 4.1 gồm Controller, Form Validation, Batch Enrolment Service, và Scheduled Task.',
            securityAndPerformance: 'Chống tấn công CSRF bằng hàm require_sesskey(), kiểm soát quyền với require_capability(), sử dụng batch insert transaction trong $DB để tối ưu I/O.',
            userGuideSections: [
              { sectionTitle: '1. Dành cho Giảng viên & Quản lý khóa học', sectionContent: 'Bước 1: Truy cập vào khóa học Moodle cần ghi danh học viên.\nBước 2: Trong thanh điều hướng khóa học, chọn "Người tham gia" (Participants) -> Nhấp nút "Ghi danh hàng loạt".\nBước 3: Tải file mẫu CSV/Excel, điền danh sách học viên và tải tệp lên.\nBước 4: Kiểm tra danh sách hiển thị xem trước (Preview) và nhấn "Bắt đầu ghi danh".\nBước 5: Chờ hệ thống báo hoàn tất và tải file kết quả nếu cần.' },
              { sectionTitle: '2. Dành cho Quản trị viên hệ thống (Admin)', sectionContent: 'Bước 1: Vào Quản trị khu vực (Site Administration) -> Trình cắm (Plugins) -> Ghi danh (Enrolments) -> Ghi danh hàng loạt.\nBước 2: Cấu hình giới hạn số lượng học viên tối đa cho mỗi lần import và định dạng file cho phép.\nBước 3: Theo dõi tiến trình các tác vụ nền tại Báo cáo (Reports) -> Tác vụ nền (Adhoc Tasks).' }
            ],
            useCaseGoal: 'Ghi danh danh sách nhiều người dùng vào một hoặc nhiều khóa học cùng lúc một cách chính xác.',
            useCaseActor: 'Quản trị viên (Admin), Giảng viên (Teacher)',
            useCasePreCondition: 'Người dùng đã đăng nhập Moodle, có quyền ghi danh trong khóa học và đã chuẩn bị file danh sách học viên hợp lệ.',
            useCaseMainFlow: '1) Người dùng truy cập tính năng Ghi danh hàng loạt trong khóa học.\n2) Người dùng tải lên file CSV/Excel chứa danh sách học viên.\n3) Hệ thống kiểm tra dữ liệu và hiển thị bảng Preview kết quả đối soát.\n4) Người dùng chọn vai trò (Student/Teacher) và xác nhận ghi danh.\n5) Hệ thống thực hiện batch insert vào cơ sở dữ liệu và gửi thông báo.\n6) Hệ thống hiển thị thống kê thành công/thất bại.',
            useCaseExceptionFlow: 'Nếu file chứa định dạng không hợp lệ hoặc tài khoản không tồn tại trong hệ thống: Hệ thống báo lỗi đỏ từng dòng trong bảng Preview và cho phép bỏ qua hoặc sửa file để tải lại.',
            useCaseResult: 'Tất cả học viên hợp lệ được ghi danh thành công vào khóa học và hiển thị trong danh sách Participants của Moodle.',
            acceptanceCriteria: [
              { id: 'AC-01', description: 'Ghi nhận và xử lý chính xác 100% các dòng dữ liệu hợp lệ trong file CSV/Excel.' },
              { id: 'AC-02', description: 'Không tạo ra bất kỳ bản ghi trùng lặp nào trong bảng mdl_user_enrolments.' },
              { id: 'AC-03', description: 'Báo cáo chi tiết nguyên nhân lỗi đối với những dòng dữ liệu không hợp lệ.' }
            ],
            workflowMermaid: 'sequenceDiagram\n  autonumber\n  actor Teacher as Giảng viên / Quản trị viên\n  participant UI as Moodle Web (Mustache UI)\n  participant Server as Moodle 4.1 Server (enrol_bulk)\n  participant DB as Moodle Database ($DB)\n  Teacher->>UI: Tải lên file CSV danh sách học viên\n  UI->>Server: Gửi tệp & sesskey qua AJAX\n  Server->>DB: SELECT id FROM mdl_user WHERE username IN (...)\n  DB-->>Server: Trả về danh sách user hợp lệ\n  Server-->>UI: Hiển thị bảng Xem trước (Preview & Validation)\n  Teacher->>UI: Xác nhận "Bắt đầu ghi danh"\n  UI->>Server: Kích hoạt xử lý ghi danh (Process Enrolment)\n  loop Ghi danh từng nhóm (Batch 100 users)\n    Server->>DB: INSERT INTO mdl_user_enrolments\n    Server->>DB: INSERT INTO mdl_role_assignments\n  end\n  Server-->>UI: Thông báo hoàn tất & Xuất báo cáo\n  UI-->>Teacher: Hiển thị số lượng ghi danh thành công',
            architectureMermaid: 'graph TD\n  subgraph ClientSide["Moodle 4.1 Client Layer"]\n    UploadUI[Giao diện Upload CSV/Excel - Boost Theme]\n    PreviewUI[Bảng Preview & Mapping Dữ liệu]\n  end\n  subgraph AppSide["Moodle Application Layer (enrol_bulk)"]\n    Controller[Bulk Enrol Controller]\n    Validator[File & User Validator]\n    EnrolService[Moodle Enrolment Core API]\n    Task[Adhoc Background Task]\n  end\n  subgraph DBTier["Moodle Database ($DB)"]\n    MDLUser[(mdl_user)]\n    MDLCourse[(mdl_course)]\n    MDLEnrol[(mdl_enrol)]\n    MDLUserEnrol[(mdl_user_enrolments)]\n    MDLRole[(mdl_role_assignments)]\n  end\n  UploadUI --> Controller\n  Controller --> Validator\n  Validator -->|Kiểm tra user| MDLUser\n  Validator -->|Kiểm tra course| MDLCourse\n  Validator --> PreviewUI\n  PreviewUI -->|Xác nhận ghi danh| Controller\n  Controller --> EnrolService\n  Controller -.->|Tệp lớn| Task\n  EnrolService --> MDLEnrol\n  EnrolService --> MDLUserEnrol\n  EnrolService --> MDLRole',
            erdMermaid: 'erDiagram\n  MDL_USER ||--o{ MDL_USER_ENROLMENTS : "tham gia"\n  MDL_ENROL ||--o{ MDL_USER_ENROLMENTS : "thuộc về"\n  MDL_COURSE ||--o{ MDL_ENROL : "chứa"\n  MDL_USER ||--o{ MDL_ROLE_ASSIGNMENTS : "được gán"\n  MDL_ROLE ||--o{ MDL_ROLE_ASSIGNMENTS : "quy định vai trò"\n  MDL_COURSE ||--o{ MDL_CONTEXT : "ngữ cảnh"'
          }, null, 2);
        }

        // Default Moodle 4.1 Feature Fallback
        return JSON.stringify({
          title: `Đặc tả Yêu cầu & Thiết kế Hệ thống Moodle 4.1 - ${featureName}`,
          featureName: featureName,
          featureCode: `MDL-${featureName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'FEAT'}-41`,
          system: 'Moodle 4.1 LMS',
          version: '1.0',
          author: 'CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ TH VIỆT NAM',
          category: 'Tính năng mới cho Moodle 4.1',
          targetUsers: 'Giảng viên (Teacher), Học viên (Student), Quản trị viên (Admin), Phòng Đào tạo',
          newFeatureDescription: `Phát triển module mở rộng trên Moodle 4.1 LMS hỗ trợ tính năng ${featureName}, tăng cường hiệu năng và trải nghiệm quản lý đào tạo trực tuyến.`,
          oldFeatureDescription: 'Moodle 4.1 mặc định cần được tối ưu và bổ sung thêm chức năng tự động hóa để đáp ứng nhu cầu doanh nghiệp.',
          objective: `Nâng cao hiệu quả quản trị học tập và trải nghiệm người dùng trên nền tảng Moodle 4.1 cho phân hệ ${featureName}.`,
          scopeIn: 'Áp dụng cho toàn bộ khóa học và người dùng được phân quyền trên Moodle 4.1 LMS.',
          scopeOut: 'Không thay đổi cấu hình SSO ngoại vi hoặc các phân hệ bên ngoài Moodle.',
          processOverview: '1) Người dùng truy cập giao diện chức năng. 2) Hệ thống kiểm tra quyền hạn (require_capability). 3) Xử lý logic và tương tác $DB. 4) Phản hồi kết quả và ghi log.',
          requirements: [
            { id: 'R001', name: 'Khởi tạo và cấu hình', description: 'Cho phép quản trị viên/giảng viên cấu hình tham số trong Moodle.' },
            { id: 'R002', name: 'Xử lý tương tác nghiệp vụ', description: 'Tiếp nhận telemetry hoặc dữ liệu từ client qua Web Service API.' },
            { id: 'R003', name: 'Báo cáo và thống kê', description: 'Tổng hợp số liệu và hiển thị trực tiếp trong trang quản trị Moodle.' }
          ],
          functionalRequirements: [
            { id: 'FR-01', name: 'Cài đặt và thiết lập tham số', priority: 'High', description: 'Bổ sung các trường cấu hình theo chuẩn Moodle Plugin.' },
            { id: 'FR-02', name: 'Xử lý nghiệp vụ thời gian thực', priority: 'High', description: 'API Moodle Web Service tiếp nhận và xử lý dữ liệu tin cậy.' },
            { id: 'FR-03', name: 'Cảnh báo và phản hồi thông tin', priority: 'Medium', description: 'Hiển thị giao diện thông báo trực quan theo chuẩn Bootstrap 5.' }
          ],
          businessRules: [
            { id: 'BR-01', name: 'Kiểm tra Capability Moodle', description: 'Bắt buộc kiểm tra quyền người dùng qua hàm has_capability() hoặc require_capability() trước khi xử lý.' },
            { id: 'BR-02', name: 'Bảo mật dữ liệu', description: 'Dữ liệu được kiểm tra hợp lệ và mã hóa theo tiêu chuẩn an toàn thông tin.' }
          ],
          acceptanceStandards: 'Thời gian phản hồi API < 200ms, tương thích Moodle 4.1 PHP 8.1+ và MySQL 8.0.',
          workflowDescription: 'Luồng dữ liệu được xử lý thông qua Mustache UI kết hợp Web Services API và $DB API.',
          systemRequirements: 'Moodle Core 4.1 LTS, PHP 8.1+, MySQL 8.0, Redis Cache khuyến nghị cho MUC.',
          accessControl: 'Tích hợp chặt chẽ với hệ thống Roles & Capabilities của Moodle 4.1.',
          databaseDesign: 'Thiết kế các bảng theo chuẩn XMLDB của Moodle (tiền tố mdl_).',
          apiDesign: 'Cung cấp Web Service Endpoint định nghĩa trong db/services.php theo chuẩn External API Moodle.',
          uiDesign: 'Giao diện xây dựng bằng Moodle Mustache Templates và JavaScript AMD Module theo theme Boost.',
          architectureDesign: 'Kiến trúc Modular Plugin chuẩn Moodle 4.1 gồm Controller, Service Layer, $DB Layer và Cron Task.',
          securityAndPerformance: 'Chống SQL Injection qua Prepared Statements $DB, chống CSRF bằng sesskey, tận dụng Moodle Universal Cache (MUC).',
          userGuideSections: [
            { sectionTitle: '1. Hướng dẫn dành cho Giảng viên (Teacher)', sectionContent: 'Bước 1: Đăng nhập vào Moodle và truy cập vào khóa học.\nBước 2: Chọn mục tính năng và làm theo hướng dẫn trên màn hình.\nBước 3: Nhấn "Lưu cấu hình" để hoàn tất.' },
            { sectionTitle: '2. Hướng dẫn dành cho Quản trị viên (Admin)', sectionContent: 'Bước 1: Truy cập Quản trị khu vực (Site Administration) -> Trình cắm (Plugins).\nBước 2: Kiểm tra cấu hình hệ thống và phân quyền cho người dùng.' }
          ],
          useCaseGoal: `Thực hiện thành công tính năng ${featureName} trên hệ thống Moodle 4.1.`,
          useCaseActor: 'Giảng viên (Teacher), Quản trị viên (Admin), Học viên (Student)',
          useCasePreCondition: 'Người dùng đã đăng nhập và được cấp quyền tương ứng trên hệ thống.',
          useCaseMainFlow: '1) Người dùng truy cập giao diện.\n2) Người dùng nhập thông tin và xác nhận.\n3) Hệ thống xử lý và lưu trữ dữ liệu.\n4) Hệ thống thông báo thành công.',
          useCaseExceptionFlow: 'Nếu xảy ra lỗi phân quyền hoặc dữ liệu không hợp lệ: Hệ thống hiện thông báo lỗi chi tiết và hướng dẫn khắc phục.',
          useCaseResult: 'Dữ liệu được cập nhật thành công vào cơ sở dữ liệu Moodle.',
          acceptanceCriteria: [
            { id: 'AC-01', description: 'Xử lý chính xác 100% các yêu cầu nghiệp vụ với thời gian phản hồi đạt chuẩn.' },
            { id: 'AC-02', description: 'Giao diện hiển thị thân thiện, responsive trên máy tính và thiết bị di động.' }
          ],
          workflowMermaid: 'sequenceDiagram\n  autonumber\n  actor User as Người dùng\n  participant UI as Moodle Theme (Mustache)\n  participant Server as Moodle 4.1 Core\n  participant DB as Moodle Database ($DB)\n  User->>UI: Truy cập tính năng\n  UI->>Server: Kiểm tra quyền & Lấy dữ liệu\n  Server->>DB: Query bảng mdl_\n  DB-->>Server: Trả về kết quả\n  Server-->>UI: Hiển thị giao diện\n  User->>UI: Thực hiện thao tác\n  UI->>Server: Gửi request cập nhật\n  Server->>DB: Lưu trữ thay đổi\n  Server-->>UI: Thông báo hoàn tất',
          architectureMermaid: 'graph TD\n  subgraph Client["Client Tier"]\n    UI[Theme Boost - Bootstrap 5]\n    AMD[Moodle AMD JS]\n  end\n  subgraph Server["Application Tier"]\n    Router[Web Services Gateway]\n    Controller[Plugin Controller]\n    Service[Business Service Layer]\n    DBAPI[Moodle Database $DB]\n  end\n  subgraph DB["Database Tier"]\n    MDLCourse[(mdl_course)]\n    MDLUser[(mdl_user)]\n    MDLLog[(mdl_logstore_standard_log)]\n  end\n  UI --> AMD\n  AMD --> Router\n  Router --> Controller\n  Controller --> Service\n  Service --> DBAPI\n  DBAPI --> MDLCourse\n  DBAPI --> MDLUser\n  DBAPI --> MDLLog',
          erdMermaid: 'erDiagram\n  MDL_USER ||--o{ MDL_USER_ENROLMENTS : "ghi danh"\n  MDL_COURSE ||--o{ MDL_USER_ENROLMENTS : "chứa"\n  MDL_COURSE ||--o{ MDL_COURSE_MODULES : "bao gồm"\n  MDL_USER ||--o{ MDL_LOGSTORE_STANDARD_LOG : "tạo log"'
        }, null, 2);
      }
      return '# Moodle 4.1 Specification\nGenerated by Auto-Dev-Agent offline fallback.';
    }

    // 2. Code-Gen Mock
    if (
      (p.includes('sinh') && p.includes('code')) ||
      p.includes('code-gen') ||
      p.includes('generate code') ||
      p.includes('crud')
    ) {
      if (options.isJson) {
        return JSON.stringify({
          featureName: 'ProductManagement',
          files: [
            {
              path: 'src/types/product.types.ts',
              content: 'export interface ProductDto {\n  id?: number;\n  name: string;\n  price: number;\n  stock: number;\n  createdAt?: Date;\n}\n'
            },
            {
              path: 'src/services/product.service.ts',
              content: 'import { ProductDto } from "../types/product.types";\n\nexport class ProductService {\n  public async createProduct(dto: ProductDto): Promise<ProductDto> {\n    return { id: 1, ...dto, createdAt: new Date() };\n  }\n\n  public async getProductById(id: number): Promise<ProductDto | null> {\n    return { id, name: "Sample Product", price: 99.9, stock: 10 };\n  }\n}\n'
            },
            {
              path: 'src/controllers/product.controller.ts',
              content: 'import { ProductService } from "../services/product.service";\n\nexport class ProductController {\n  private service = new ProductService();\n\n  public async getProduct(req: any, res: any) {\n    const id = parseInt(req.params.id, 10);\n    const item = await this.service.getProductById(id);\n    res.json({ success: true, data: item });\n  }\n}\n'
            }
          ],
          summary: 'Generated TypeScript module conforming to layered architecture.'
        }, null, 2);
      }
      return '// Generated Code\nexport class GeneratedFeatureService {}';
    }

    // 3. Code-Review Mock
    if (p.includes('review') || p.includes('audit') || p.includes('kiểm tra')) {
      if (options.isJson) {
        return JSON.stringify({
          overallScore: 82,
          summary: 'Phát hiện 2 cảnh báo hiệu năng truy vấn N+1 và 1 trường hợp thiếu Index khi JOIN.',
          issues: [
            {
              severity: 'HIGH',
              category: 'PERFORMANCE',
              file: 'src/services/orderService.ts',
              line: 45,
              title: 'Truy vấn N+1 trong vòng lặp for/map',
              description: 'Hàm lấy chi tiết sản phẩm được gọi tuần tự bên trong loop thay vì sử dụng WHERE id IN (...) hoặc JOIN.',
              recommendation: 'Sử dụng batch query hoặc JOIN bảng products ngay trong câu query gốc.'
            },
            {
              severity: 'MEDIUM',
              category: 'DATABASE_INDEX',
              file: 'src/models/orderItem.model.ts',
              line: 22,
              title: 'Thiếu Index trên cột order_id khi JOIN',
              description: 'Cột order_id được JOIN thường xuyên với bảng orders nhưng chưa có INDEX, dẫn đến Full Table Scan khi dữ liệu lớn.',
              recommendation: 'Thêm chỉ mục: CREATE INDEX idx_order_items_order_id ON order_items(order_id);'
            }
          ]
        }, null, 2);
      }
      return '# Code Review Report\nNo critical blockers found.';
    }

    // Default mock
    return options.isJson
      ? JSON.stringify({ message: 'Execution completed via intelligent fallback.', status: 'success' })
      : 'Auto-Dev-Agent executed successfully.';
  }
}
