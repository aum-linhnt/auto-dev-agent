# Auto-Dev-Agent 🚀

**Autonomous AI Development Agent built with Node.js & TypeScript**  
Hệ thống AI Agent phát triển phần mềm tự động dựa trên kiến trúc **Shared Context Engine + Pluggable Skill Architecture**.

---

## 🌟 TÍNH NĂNG NỔI BẬT

1. **Shared Context Engine (Lõi bóc tách ngữ cảnh chuyên sâu)**:
   - **AST & Code Analyzer (`ts-morph`)**: Quét tự động toàn bộ API Endpoints (Express, NestJS), Call-Graph giữa Controller-Service-Repository, DTOs & Interfaces, Coding Conventions và câu truy vấn SQL thô trong mã nguồn.
   - **Database & Implicit Joins (`mysql2` + `node-sql-parser`)**: Bóc tách Tables, Columns, Indexes, Hard Foreign Keys từ `INFORMATION_SCHEMA`, đồng thời bóc tách **Implicit Joins** từ các câu SQL `WHERE` và `JOIN` không khai báo Foreign Key ràng buộc cứng.
   - **Git Diff & Impact Analyzer (`simple-git`)**: Đối chiếu Git Diff giữa các commit/branch/working tree với AST để xác định chính xác các hàm, lớp, endpoint bị ảnh hưởng.
   - **Unified Context Builder**: Hợp nhất toàn bộ Code + DB + Git thành `UnifiedProjectContext` phục vụ mọi Skill.

2. **Pluggable Skill Architecture (Kiến trúc kỹ năng mở rộng)**:
   - **3 Built-in Skills trọng tâm**:
     - `doc-gen`: Sinh tài liệu Đặc tả Yêu cầu (SRS) & Phân tích Thiết kế hệ thống, tự động vẽ sơ đồ Kiến trúc & ERD qua Kroki API (Mermaid.js -> PNG) và bind trực tiếp vào Word (`.docx`) giữ nguyên 100% định dạng template.
     - `code-gen`: Sinh code đầy đủ chức năng mới (Routes, Controllers, Services, Models/Queries, DTOs, Frontend components) tuân thủ tuyệt đối quy chuẩn dự án, tích hợp **In-memory TypeScript Compile Check** trước khi ghi đĩa an toàn (hỗ trợ dry-run & backup).
     - `code-review`: Review code từ Git Diff hoặc module, đối chiếu DB Schema/Indexes và Call-Graph để phát hiện lỗi **N+1 Query**, **thiếu Index khi JOIN/WHERE**, **lệch kiểu dữ liệu TypeScript vs MySQL**, và vi phạm kiến trúc.
   - **Dynamic Markdown Skills**: Tự động quét thư mục `/skills/*/SKILL.md` (YAML frontmatter + Prompt instructions via `gray-matter`) và nạp nóng vào hệ thống không cần sửa code. Đã tích hợp sẵn 2 skill mẫu:
     - `sql-optimizer`: Phân tích câu truy vấn SQL, gợi ý Composite Index và viết lại query tối ưu.
     - `api-security-audit`: Kiểm toán bảo mật API theo tiêu chuẩn OWASP API Security Top 10 (BOLA/IDOR, Injection, Unchecked Input).

3. **Giao diện Kép (CLI Tương tác & Express REST API)**:
   - Điều khiển nhanh qua dòng lệnh hoặc tích hợp vào CI/CD, Web UI thông qua REST API.

---

## 📁 CẤU TRÚC DỰ ÁN

```text
auto-dev-agent/
├── templates/                       # Chứa các file Word mẫu (.docx) cho đặc tả, thiết kế, review
│   ├── srs-template.docx
│   └── review-template.docx
├── skills/                          # Thư mục Custom Skills dạng Markdown (Hot-plug)
│   ├── sql-optimizer/
│   │   └── SKILL.md                 # Tối ưu SQL & gợi ý đánh Index
│   └── api-security-audit/
│       └── SKILL.md                 # Kiểm toán bảo mật API & OWASP
├── output/                          # Xuất file Word (.docx), báo cáo (.md), diagram (.png)
├── src/
│   ├── config/
│   │   └── env.ts                   # Quản lý cấu hình & biến môi trường
│   ├── context/                     # CORE CONTEXT ENGINE
│   │   ├── codeAnalyzer.ts          # Quét AST: Endpoints, Call-Graph, DTOs, Conventions
│   │   ├── dbAnalyzer.ts            # Quét Tables, Columns, Indexes, Hard FK & Implicit Joins
│   │   ├── gitAnalyzer.ts           # Trích xuất Git Diff và xác định phần tử code bị ảnh hưởng
│   │   └── contextBuilder.ts        # Hợp nhất thành UnifiedProjectContext
│   ├── core/                        # SKILL FRAMEWORK
│   │   ├── types.ts                 # Interfaces ISkill, SkillInput, SkillResult, UnifiedProjectContext
│   │   ├── skillRegistry.ts         # Quản lý & điều phối Built-in + Markdown Skills
│   │   └── markdownSkillLoader.ts   # Đọc /skills/*/SKILL.md thành thực thể ISkill
│   ├── built-in-skills/             # 3 SKILL TRỌNG TÂM
│   │   ├── docGenSkill.ts           # Sinh SRS & Thiết kế hệ thống ra Word (.docx)
│   │   ├── codeGenSkill.ts          # Sinh code chức năng mới + verify TypeScript
│   │   └── codeReviewSkill.ts       # Review code đối chiếu DB Schema/Index
│   ├── services/
│   │   ├── llmService.ts            # Google Gemini SDK (@google/genai) + Structured Outputs
│   │   ├── diagramService.ts        # Chuyển Mermaid sang PNG qua Kroki API
│   │   ├── docxService.ts           # Bind JSON + PNG vào template .docx giữ 100% format
│   │   └── fileWriterService.ts     # Ghi file an toàn (hỗ trợ dry-run / backup)
│   ├── api/
│   │   └── server.ts                # Express REST API
│   └── cli.ts                       # Giao diện CLI điều khiển
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 🚀 HƯỚNG DẪN CÀI ĐẶT & CHẠY

### 1. Cài đặt Dependencies
```bash
npm install
```

### 2. Cấu hình biến môi trường (`.env`)
Tạo file `.env` từ `.env.example`:
```env
# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-pro

# Server Configuration
PORT=3000

# Target Project Root for Analysis
PROJECT_ROOT=.

# MySQL Database (Tùy chọn nếu muốn kết nối DB trực tiếp)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=your_db_name

# Kroki Diagram Rendering API
KROKI_URL=https://kroki.io/mermaid/png
```

> **Lưu ý**: Nếu chưa cấu hình `GEMINI_API_KEY` hoặc MySQL Database, hệ thống sẽ tự động kích hoạt **Intelligent Mock Fallback** và quét các file SQL/DDL cục bộ, đảm bảo kiểm thử và minh họa không bị gián đoạn.

### 3. Biên dịch TypeScript
```bash
npm run build
```

---

## 💻 SỬ DỤNG QUA CLI

### Danh sách Skills có sẵn
```bash
npx tsx src/cli.ts list
```

### Xem tổng quan Unified Project Context (AST + DB + Git)
```bash
npx tsx src/cli.ts context
```

### 1. Chạy Skill `doc-gen` (Hỗ trợ Moodle 4.1 & 4 Mẫu Tài liệu Doanh nghiệp)
Hệ thống hỗ trợ sinh trọn bộ 4 tài liệu chuẩn của công ty:
- **Phiếu yêu cầu nghiệp vụ.docx** (BRD)
- **Tài liệu đặc tả chức năng.docx** (SRS / FSD)
- **Tài liệu phân tích thiết kế.docx** (SAD)
- **Hướng dẫn sử dụng.docx** (User Guide)

```bash
# Sinh trọn bộ cả 4 loại tài liệu cùng lúc:
npx tsx src/cli.ts run doc-gen -f "QuizProctoring" -r "Module giám sát thi trắc nghiệm chống gian lận trên Moodle 4.1 LMS" -T all

# Sinh từng loại tài liệu riêng lẻ:
npx tsx src/cli.ts run doc-gen -f "QuizProctoring" -T brd    # Phiếu yêu cầu nghiệp vụ
npx tsx src/cli.ts run doc-gen -f "QuizProctoring" -T srs    # Tài liệu đặc tả chức năng
npx tsx src/cli.ts run doc-gen -f "QuizProctoring" -T sad    # Tài liệu phân tích thiết kế
npx tsx src/cli.ts run doc-gen -f "QuizProctoring" -T guide  # Hướng dẫn sử dụng
```
*Kết quả xuất tại:* `output/` với các file Word `.docx` tương ứng và bản Markdown `.md` xem trước, kèm sơ đồ luồng hoạt động, kiến trúc và Moodle ERD `.png`. Toàn bộ định dạng tiêu đề công ty, logo, viền bảng và font chữ của template gốc được bảo toàn 100%.

### 2. Chạy Skill `code-gen` (Sinh code mới + kiểm tra TypeScript)
```bash
# Chế độ xem trước (Dry-run không ghi file)
npx tsx src/cli.ts run code-gen -f "ProductCatalog" -r "Quản lý danh mục sản phẩm và tồn kho" --dry-run

# Chế độ ghi file thực tế (tự động tạo backup nếu file đã tồn tại)
npx tsx src/cli.ts run code-gen -f "ProductCatalog" -r "Quản lý danh mục sản phẩm và tồn kho"
```

### 3. Chạy Skill `code-review` (Review code đối chiếu DB Schema & AST)
```bash
npx tsx src/cli.ts run code-review -m "orderService"
```
*Kết quả xuất tại:* `output/Review_Report_<timestamp>.docx` và file Markdown chi tiết.

### 4. Chạy Dynamic Markdown Skills
```bash
# Tối ưu hóa truy vấn SQL
npx tsx src/cli.ts run sql-optimizer -f "orders"

# Kiểm toán bảo mật API & OWASP
npx tsx src/cli.ts run api-security-audit
```

---

## 🌐 SỬ DỤNG QUA REST API

Khởi động server:
```bash
npm run server
```

### Endpoints chính:
| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/api/health` | Kiểm tra trạng thái hệ thống & LLM |
| `GET` | `/api/skills` | Lấy danh sách toàn bộ Skill (Built-in + Markdown) |
| `GET` | `/api/context` | Lấy dữ liệu Unified Context (AST, DB, Git) |
| `POST` | `/api/skills/execute` | Thực thi một Skill bất kỳ |
| `GET` | `/output/*` | Tải trực tiếp các file Word, Markdown, Diagram sinh ra |

#### Ví dụ Body gọi `POST /api/skills/execute`:
```json
{
  "skillId": "doc-gen",
  "input": {
    "featureName": "PaymentService",
    "requirements": "Tích hợp cổng thanh toán VNPay và Momo",
    "dryRun": false
  }
}
```

---

## 🧩 THÊM SKILL TÙY CHỈNH (DYNAMIC MARKDOWN SKILL)

Để thêm một skill mới, chỉ cần tạo thư mục trong `/skills/<tên-skill>/SKILL.md`:

```markdown
---
id: custom-performance-audit
name: Custom Performance Audit
description: Phân tích hiệu năng bộ nhớ và CPU của service.
version: 1.0.0
tags:
  - performance
  - memory
author: DevOps Team
systemInstruction: Bạn là chuyên gia hiệu năng hệ thống Node.js.
---

# HƯỚNG DẪN THỰC THI (PROMPT INSTRUCTIONS)
Đọc hiểu Call-Graph và các hàm được bóc tách từ AST.
Chỉ ra các đoạn code có nguy cơ Memory Leak (Event Listener không hủy, Closure giữ biến lớn).
```

Hệ thống sẽ **tự động nạp nóng** skill này mà không cần cấu hình lại!

