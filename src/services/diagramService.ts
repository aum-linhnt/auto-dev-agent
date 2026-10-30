import axios from 'axios';
import fs from 'fs';
import path from 'path';
import config from '../config/env';

export class DiagramService {
  private krokiUrl: string;

  // Minimal valid 1x1 PNG fallback buffer
  private static FALLBACK_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  constructor() {
    this.krokiUrl = config.kroki.url || 'https://kroki.io/mermaid/png';
  }

  /**
   * Convert Mermaid.js code into PNG image buffer via Kroki API
   */
  public async renderMermaidToPng(mermaidCode: string): Promise<Buffer> {
    const cleanCode = mermaidCode.trim();
    if (!cleanCode) {
      return DiagramService.FALLBACK_PNG;
    }

    try {
      const response = await axios.post(this.krokiUrl, cleanCode, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          Accept: 'image/png',
        },
        responseType: 'arraybuffer',
        timeout: 10000,
      });

      return Buffer.from(response.data);
    } catch (err: any) {
      console.warn(
        `[DiagramService] Kroki render failed (${err.message}). Using fallback placeholder image.`
      );
      return DiagramService.FALLBACK_PNG;
    }
  }

  /**
   * Save PNG buffer to file
   */
  public async savePngToFile(pngBuffer: Buffer, targetPath: string): Promise<string> {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, pngBuffer);
    return targetPath;
  }
}

