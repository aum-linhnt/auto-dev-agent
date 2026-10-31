/**
 * WordXmlBuilder
 * Generates standards-compliant OpenXML (WordprocessingML) elements
 * (Paragraphs, Headings, Bullet Lists, and Native Formatted Tables)
 * specifically tuned for Microsoft Word (.docx) documents in Moodle TNU enterprise templates.
 */

export function escapeXml(unsafe: any): string {
  return String(unsafe === undefined || unsafe === null ? '' : unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface ParagraphOptions {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number; // half-points (24 = 12pt, 26 = 13pt)
  align?: 'left' | 'center' | 'right' | 'both';
  spaceBefore?: number;
  spaceAfter?: number;
  line?: number;
}

export interface TableColumnDef {
  title: string;
  align?: 'left' | 'center' | 'right';
  width?: number; // in dxa (total table width standard = 9600 dxa)
  dataBold?: boolean;
}

export interface TableOptions {
  colWidths?: number[];
  headerBg?: string; // hex color without # (default: '2E75B6')
  zebra?: boolean;
  totalWidth?: number; // default: 9600
}

export class WordXmlBuilder {
  /**
   * Generates a standard OpenXML paragraph with Times New Roman styling
   */
  public static paragraph(text: string, options: ParagraphOptions = {}): string {
    const bold = options.bold ? '<w:b/>' : '';
    const italic = options.italic ? '<w:i/>' : '';
    const color = options.color ? `<w:color w:val="${options.color}"/>` : '<w:color w:val="262626"/>';
    const sz = options.size ? `<w:sz w:val="${options.size}"/>` : '<w:sz w:val="24"/>';
    const align = options.align ? `<w:jc w:val="${options.align}"/>` : '';
    const before = options.spaceBefore !== undefined ? options.spaceBefore : 60;
    const after = options.spaceAfter !== undefined ? options.spaceAfter : 80;
    const line = options.line !== undefined ? options.line : 276; // 1.15 line spacing

    return `
    <w:p>
      <w:pPr>
        ${align}
        <w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          ${bold}
          ${italic}
          ${color}
          ${sz}
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(text)}</w:t>
      </w:r>
    </w:p>`;
  }

  /**
   * Section level 2 header (e.g. 2.1. Mục tiêu và phạm vi)
   */
  public static heading2(text: string): string {
    return `
    <w:p>
      <w:pPr>
        <w:spacing w:before="240" w:after="120" w:line="280" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:b/>
          <w:color w:val="1F4E79"/>
          <w:sz w:val="26"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(text)}</w:t>
      </w:r>
    </w:p>`;
  }

  /**
   * Section level 3 header (e.g. 2.1.1. Chi tiết phân hệ)
   */
  public static heading3(text: string): string {
    return `
    <w:p>
      <w:pPr>
        <w:spacing w:before="180" w:after="80" w:line="260" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:b/>
          <w:color w:val="2E75B6"/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(text)}</w:t>
      </w:r>
    </w:p>`;
  }

  /**
   * Formatted bullet point with bold lead-in label
   */
  public static bullet(label: string, text: string): string {
    return `
    <w:p>
      <w:pPr>
        <w:spacing w:before="40" w:after="60" w:line="260" w:lineRule="auto"/>
        <w:ind w:left="400" w:hanging="240"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:b/>
          <w:color w:val="2E75B6"/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t>• </w:t>
      </w:r>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:b/>
          <w:color w:val="1F4E79"/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(label)}: </w:t>
      </w:r>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:color w:val="262626"/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(text)}</w:t>
      </w:r>
    </w:p>`;
  }

  /**
   * Numbered step paragraph (e.g. 1. Bước một...)
   */
  public static numberedStep(stepNum: number | string, text: string, details?: string): string {
    return `
    <w:p>
      <w:pPr>
        <w:spacing w:before="40" w:after="60" w:line="260" w:lineRule="auto"/>
        <w:ind w:left="400" w:hanging="240"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:b/>
          <w:color w:val="2E75B6"/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(String(stepNum))}. </w:t>
      </w:r>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:b/>
          <w:color w:val="262626"/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(text)} </w:t>
      </w:r>
      ${
        details
          ? `<w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
          <w:color w:val="595959"/>
          <w:sz w:val="24"/>
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(details)}</w:t>
      </w:r>`
          : ''
      }
    </w:p>`;
  }

  /**
   * Builds a native Microsoft Word Table (<w:tbl>)
   * - Total width: 9600 dxa (exact A4 printable area width)
   * - Corporate Navy/Blue Header (#2E75B6), White Bold text
   * - CantSplit on all rows (prevents row tearing across page boundaries)
   * - tblHeader on row 0 (repeats header if table spans multiple pages)
   * - Alternating row backgrounds (#FFFFFF / #F7FAFC)
   * - Clean cell borders and balanced cell padding
   */
  public static table(
    columns: TableColumnDef[],
    rows: (string | number)[][],
    options: TableOptions = {}
  ): string {
    const totalWidth = options.totalWidth || 9600;
    const headerBg = options.headerBg || '2E75B6';
    const zebra = options.zebra !== false;

    // Calculate column widths
    let colWidths: number[];
    if (options.colWidths && options.colWidths.length === columns.length) {
      colWidths = options.colWidths;
    } else {
      const explicitWidths = columns.map((c) => c.width || 0);
      const specifiedTotal = explicitWidths.reduce((a, b) => a + b, 0);
      const unassignedCount = columns.filter((c) => !c.width).length;

      if (unassignedCount > 0) {
        const remaining = Math.max(0, totalWidth - specifiedTotal);
        const perCol = Math.floor(remaining / unassignedCount);
        colWidths = columns.map((c) => c.width || perCol);
      } else {
        colWidths = explicitWidths;
      }
    }

    // Grid definition
    const gridXml =
      '<w:tblGrid>' +
      colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
      '</w:tblGrid>';

    // Header Row
    const headerRowXml = `
    <w:tr>
      <w:trPr>
        <w:tblHeader/>
        <w:cantSplit/>
      </w:trPr>
      ${columns
        .map((col, idx) => `
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="${colWidths[idx]}" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="${headerBg}"/>
            <w:tcBorders>
              <w:top w:val="single" w:sz="6" w:color="${headerBg}"/>
              <w:bottom w:val="single" w:sz="6" w:color="${headerBg}"/>
              <w:left w:val="single" w:sz="4" w:color="${headerBg}"/>
              <w:right w:val="single" w:sz="4" w:color="${headerBg}"/>
            </w:tcBorders>
            <w:vAlign w:val="center"/>
            <w:tcMar>
              <w:top w:w="120" w:type="dxa"/>
              <w:bottom w:w="120" w:type="dxa"/>
              <w:left w:w="140" w:type="dxa"/>
              <w:right w:w="140" w:type="dxa"/>
            </w:tcMar>
          </w:tcPr>
          <w:p>
            <w:pPr>
              <w:jc w:val="${col.align || 'center'}"/>
              <w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>
            </w:pPr>
            <w:r>
              <w:rPr>
                <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
                <w:b/>
                <w:color w:val="FFFFFF"/>
                <w:sz w:val="21"/>
              </w:rPr>
              <w:t xml:space="preserve">${escapeXml(col.title)}</w:t>
            </w:r>
          </w:p>
        </w:tc>
      `)
        .join('')}
    </w:tr>`;

    // Data Rows
    const dataRowsXml = rows
      .map((row, rIdx) => {
        const bg = zebra && rIdx % 2 === 1 ? 'F7FAFC' : 'FFFFFF';
        return `
      <w:tr>
        <w:trPr>
          <w:cantSplit/>
        </w:trPr>
        ${row
          .map((cellVal, cIdx) => {
            const colDef = columns[cIdx] || { align: 'left', dataBold: false };
            const isBold = colDef.dataBold || false;
            const align = colDef.align || 'left';
            const cellStr = String(cellVal === undefined || cellVal === null ? '' : cellVal);

            // Handle multi-line in cells
            const cellLines = cellStr.split('\n');
            const paragraphsXml = cellLines
              .map(
                (line) => `
              <w:p>
                <w:pPr>
                  <w:jc w:val="${align}"/>
                  <w:spacing w:before="30" w:after="30" w:line="240" w:lineRule="auto"/>
                </w:pPr>
                <w:r>
                  <w:rPr>
                    <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
                    ${isBold ? '<w:b/>' : ''}
                    <w:color w:val="262626"/>
                    <w:sz w:val="21"/>
                  </w:rPr>
                  <w:t xml:space="preserve">${escapeXml(line)}</w:t>
                </w:r>
              </w:p>`
              )
              .join('');

            return `
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="${colWidths[cIdx]}" w:type="dxa"/>
              <w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>
              <w:tcBorders>
                <w:top w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:bottom w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:left w:val="single" w:sz="4" w:color="E2E8F0"/>
                <w:right w:val="single" w:sz="4" w:color="E2E8F0"/>
              </w:tcBorders>
              <w:vAlign w:val="center"/>
              <w:tcMar>
                <w:top w:w="100" w:type="dxa"/>
                <w:bottom w:w="100" w:type="dxa"/>
                <w:left w:w="120" w:type="dxa"/>
                <w:right w:w="120" w:type="dxa"/>
              </w:tcMar>
            </w:tcPr>
            ${paragraphsXml}
          </w:tc>`;
          })
          .join('')}
      </w:tr>`;
      })
      .join('');

    return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="${totalWidth}" w:type="dxa"/>
        <w:jc w:val="center"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="${headerBg}"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="${headerBg}"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="${headerBg}"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="${headerBg}"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
        </w:tblBorders>
      </w:tblPr>
      ${gridXml}
      ${headerRowXml}
      ${dataRowsXml}
    </w:tbl>
    <w:p>
      <w:pPr>
        <w:spacing w:before="80" w:after="80"/>
      </w:pPr>
    </w:p>`;
  }
}

