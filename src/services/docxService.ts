import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
// @ts-ignore
import ImageModule from 'docxtemplater-image-module-free';
import config from '../config/env';

export interface DocxRenderOptions {
  templatePath: string;
  data: Record<string, any>;
  outputPath: string;
}

export class DocxService {
  constructor() {
    this.ensureStarterTemplates();
  }

  /**
   * Render data and images into a Word .docx template while preserving 100% styles
   */
  public async renderDocx(options: DocxRenderOptions): Promise<string> {
    const { templatePath, data, outputPath } = options;

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Word template not found at: ${templatePath}`);
    }

    const templateContent = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(templateContent);

    // Image module configuration
    const imageOptions = {
      getImage: (tagValue: any) => {
        if (Buffer.isBuffer(tagValue)) {
          return tagValue;
        }
        if (typeof tagValue === 'string') {
          if (tagValue.startsWith('data:image')) {
            const base64Data = tagValue.split(',')[1];
            return Buffer.from(base64Data, 'base64');
          }
          if (fs.existsSync(tagValue)) {
            return fs.readFileSync(tagValue);
          }
        }
        // Minimal fallback 1x1 png
        return Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        );
      },
      getSize: (img: any, tagValue: any, tagName: string) => {
        // High quality dimensions for architecture and ERD diagrams
        if (tagName.toLowerCase().includes('erd') || tagName.toLowerCase().includes('architecture')) {
          return [560, 320];
        }
        return [520, 280];
      },
    };

    const imageModule = new ImageModule(imageOptions);

    const doc = new Docxtemplater(zip, {
      modules: [imageModule],
      paragraphLoop: true,
      linebreaks: true,
    });

    // Render data
    doc.render(data);

    const buf = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, buf);
    return outputPath;
  }

  /**
   * Automatically bootstrap standard Word templates if missing in /templates
   */
  public ensureStarterTemplates(): void {
    const templatesDir = config.paths.templatesDir;
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }

    const srsPath = path.join(templatesDir, 'srs-template.docx');
    const reviewPath = path.join(templatesDir, 'review-template.docx');

    if (!fs.existsSync(srsPath)) {
      this.createStarterTemplate(
        srsPath,
        'ĐẶC TẢ YÊU CẦU & THIẾT KẾ HỆ THỐNG (SRS & DESIGN)',
        `
        <w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="1F497D"/></w:rPr><w:t>{title}</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="595959"/></w:rPr><w:t>Dự án: {projectName} | Phiên bản: {version} | Ngày tạo: {date}</w:t></w:r></w:p>
        <w:p><w:r><w:t></w:t></w:r></w:p>

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F497D"/></w:rPr><w:t>1. TỔNG QUAN HỆ THỐNG</w:t></w:r></w:p>
        <w:p><w:r><w:t>{overview}</w:t></w:r></w:p>

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F497D"/></w:rPr><w:t>2. YÊU CẦU CHỨC NĂNG (FUNCTIONAL REQUIREMENTS)</w:t></w:r></w:p>
        {#functionalRequirements}
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>• [{id}] {name} (Độ ưu tiên: {priority}): </w:t></w:r><w:r><w:t>{description}</w:t></w:r></w:p>
        {/functionalRequirements}

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F497D"/></w:rPr><w:t>3. YÊU CẦU PHI CHỨC NĂNG (NON-FUNCTIONAL REQUIREMENTS)</w:t></w:r></w:p>
        {#nonFunctionalRequirements}
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>• [{category}]: </w:t></w:r><w:r><w:t>{requirement}</w:t></w:r></w:p>
        {/nonFunctionalRequirements}

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F497D"/></w:rPr><w:t>4. KIẾN TRÚC TỔNG THỂ &amp; CALL-GRAPH</w:t></w:r></w:p>
        <w:p><w:r><w:t>{%architectureDiagram%}</w:t></w:r></w:p>

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F497D"/></w:rPr><w:t>5. CƠ SỞ DỮ LIỆU &amp; SƠ ĐỒ THỰC THỂ (ERD)</w:t></w:r></w:p>
        <w:p><w:r><w:t>{%erdDiagram%}</w:t></w:r></w:p>

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F497D"/></w:rPr><w:t>6. DANH SÁCH BẢNG DỮ LIỆU (DATABASE TABLES)</w:t></w:r></w:p>
        {#tables}
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bảng: {name} (Số cột: {columnCount})</w:t></w:r></w:p>
        {/tables}

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F497D"/></w:rPr><w:t>7. SƠ ĐỒ TUẦN TỰ (SEQUENCE FLOW)</w:t></w:r></w:p>
        <w:p><w:r><w:t>{%sequenceDiagram%}</w:t></w:r></w:p>
        `
      );
    }

    if (!fs.existsSync(reviewPath)) {
      this.createStarterTemplate(
        reviewPath,
        'BÁO CÁO REVIEW CODE & KIỂM ĐỊNH KIẾN TRÚC',
        `
        <w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="C00000"/></w:rPr><w:t>{title}</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="595959"/></w:rPr><w:t>Điểm đánh giá: {overallScore}/100 | Ngày thẩm định: {date}</w:t></w:r></w:p>
        <w:p><w:r><w:t></w:t></w:r></w:p>

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="C00000"/></w:rPr><w:t>1. TÓM TẮT ĐÁNH GIÁ</w:t></w:r></w:p>
        <w:p><w:r><w:t>{summary}</w:t></w:r></w:p>

        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="C00000"/></w:rPr><w:t>2. DANH SÁCH LỖI &amp; CẢNH BÁO (FINDINGS)</w:t></w:r></w:p>
        {#issues}
        <w:p><w:r><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr><w:t>[{severity}] {title} ({file}:{line})</w:t></w:r></w:p>
        <w:p><w:r><w:t>Phân loại: {category}</w:t></w:r></w:p>
        <w:p><w:r><w:t>Mô tả chi tiết: {description}</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Giải pháp khắc phục: {recommendation}</w:t></w:r></w:p>
        <w:p><w:r><w:t></w:t></w:r></w:p>
        {/issues}
        `
      );
    }
  }

  /**
   * Helper to write a valid starter docx file
   */
  private createStarterTemplate(filePath: string, defaultTitle: string, xmlBody: string) {
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Default Extension="png" ContentType="image/png"/>
</Types>`;

    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${xmlBody}
  </w:body>
</w:document>`;

    const zip = new PizZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', docXml);

    const buf = zip.generate({ type: 'nodebuffer' });
    fs.writeFileSync(filePath, buf);
  }
}

