import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import config from '../config/env';
import { skillRegistry } from '../core/skillRegistry';
import { ContextBuilder } from '../context/contextBuilder';
import { MoodlePluginAnalyzer } from '../context/moodlePluginAnalyzer';
import { SkillInput } from '../core/types';

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Static files for Web UI Dashboard and generated artifacts
  const publicDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }
  app.use('/output', express.static(config.paths.outputDir));

  const contextBuilder = new ContextBuilder();

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'auto-dev-agent',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      llmConfigured: !!config.gemini.apiKey && config.gemini.apiKey !== 'your_gemini_api_key_here',
      model: config.gemini.model,
    });
  });

  // GET /api/skills - List all skills
  app.get('/api/skills', async (req: Request, res: Response) => {
    try {
      await skillRegistry.initialize();
      const skills = skillRegistry.listSkills().map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        type: s.type,
        metadata: s.metadata,
      }));

      res.json({
        success: true,
        count: skills.length,
        skills,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/skills/execute - Execute a specific skill
  app.post('/api/skills/execute', async (req: Request, res: Response) => {
    try {
      const { skillId, input } = req.body as {
        skillId: string;
        input?: SkillInput;
      };

      if (!skillId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: "skillId"',
        });
      }

      console.log(`[API] Executing skill: "${skillId}" with input:`, input);
      const result = await skillRegistry.executeSkill(skillId, input || {});

      res.json(result);
    } catch (err: any) {
      console.error(`[API Error] Skill execution failed:`, err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  // GET /api/moodle/plugins - List all detected Moodle plugins
  app.get('/api/moodle/plugins', async (req: Request, res: Response) => {
    try {
      const plugins = await MoodlePluginAnalyzer.listPlugins(config.paths.projectRoot);
      res.json({
        success: true,
        count: plugins.length,
        plugins,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/moodle/plugin-detail - Deep analysis of a specific plugin
  app.get('/api/moodle/plugin-detail', async (req: Request, res: Response) => {
    try {
      const pluginPath = req.query.path as string;
      if (!pluginPath) {
        return res.status(400).json({ success: false, error: 'Thiếu tham số query "path"' });
      }

      const detail = await MoodlePluginAnalyzer.analyzePlugin(config.paths.projectRoot, pluginPath);
      res.json({
        success: true,
        plugin: detail,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/context - Get Unified Project Context
  app.get('/api/context', async (req: Request, res: Response) => {
    try {
      const gitDiffTarget = req.query.gitDiffTarget as string | undefined;
      const context = await contextBuilder.buildContext({ gitDiffTarget });

      res.json({
        success: true,
        summary: context.summary,
        code: {
          filesScanned: context.code.filesScanned,
          endpointsCount: context.code.endpoints.length,
          endpoints: context.code.endpoints,
          dtosCount: context.code.dtos.length,
          classesCount: context.code.classes.length,
          conventions: context.code.conventions,
          extractedSqlsCount: context.code.extractedSqls.length,
        },
        db: {
          isConnected: context.db.isConnected,
          dbName: context.db.dbName,
          tablesCount: context.db.tables.length,
          tables: context.db.tables.map((t) => ({
            name: t.name,
            columnsCount: t.columns.length,
            indexesCount: t.indexes.length,
            foreignKeysCount: t.foreignKeys.length,
            columns: t.columns,
            indexes: t.indexes,
            foreignKeys: t.foreignKeys,
          })),
          relationshipsCount: context.db.relationships.length,
        },
        git: context.git
          ? {
              branch: context.git.branch,
              commitHash: context.git.commitHash,
              changedFilesCount: context.git.changedFiles.length,
              affectedElementsCount: context.git.affectedElements.length,
              changedFiles: context.git.changedFiles,
            }
          : null,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/artifacts - List generated artifacts
  app.get('/api/artifacts', (req: Request, res: Response) => {
    try {
      const outDir = config.paths.outputDir;
      if (!fs.existsSync(outDir)) {
        return res.json({ success: true, artifacts: [] });
      }

      const files = fs.readdirSync(outDir);
      const artifacts = files
        .filter((file) => {
          if (file.startsWith('.')) return false;
          try {
            const filePath = path.join(outDir, file);
            return fs.statSync(filePath).isFile();
          } catch {
            return false;
          }
        })
        .map((file) => {
          const filePath = path.join(outDir, file);
          const stat = fs.statSync(filePath);
          const ext = path.extname(file).toLowerCase();
          return {
            name: file,
            size: stat.size,
            sizeFormatted: (stat.size / 1024).toFixed(1) + ' KB',
            createdAt: stat.birthtime.toISOString(),
            ext,
            type: ext === '.docx' ? 'Word Document' : ext === '.md' ? 'Markdown' : ext === '.png' ? 'Diagram' : 'Code',
            url: `/output/${encodeURIComponent(file)}`,
          };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({ success: true, count: artifacts.length, artifacts });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/artifacts/content/:fileName - Read file content for preview
  app.get('/api/artifacts/content/:fileName', (req: Request, res: Response) => {
    try {
      const param = req.params.fileName;
      const rawName = Array.isArray(param) ? param[0] : param;
      const fileName = path.basename(rawName);
      const filePath = path.join(config.paths.outputDir, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ success: true, fileName, content });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/artifacts/preview/:fileName - Stream direct preview (converts .docx to PDF via LibreOffice for crystal clear viewing)
  app.get('/api/artifacts/preview/:fileName', async (req: Request, res: Response) => {
    try {
      const param = req.params.fileName;
      const rawName = Array.isArray(param) ? param[0] : param;
      const fileName = path.basename(rawName);
      const filePath = path.join(config.paths.outputDir, fileName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).send('Không tìm thấy tệp yêu cầu.');
      }

      const ext = path.extname(fileName).toLowerCase();

      // For Word (.docx), stream high-fidelity HTML preview using docx-preview
      if (ext === '.docx') {
        const viewerHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName} - Xem trước Word</title>
  <script src="/vendor/jszip.min.js"></script>
  <script src="/vendor/docx-preview.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: #090d16;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    }
    .topbar .title {
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .topbar .actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .topbar .btn {
      background: #4f46e5;
      color: white;
      text-decoration: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .topbar .btn:hover { background: #4338ca; }
    .viewer-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 12px;
      overflow-y: auto;
    }
    .docx-wrapper {
      background: transparent !important;
      padding: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      width: 100% !important;
    }
    .docx-wrapper > section.docx {
      background: #ffffff !important;
      color: #000000 !important;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6) !important;
      margin-bottom: 24px !important;
      border-radius: 2px !important;
    }
    .loading-box {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 60px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .spinner {
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: #6366f1;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="title">
      📄 <span>${fileName}</span>
    </div>
    <div class="actions">
      <a class="btn" href="/output/${encodeURIComponent(fileName)}" download>⬇ Tải về Word (.docx)</a>
    </div>
  </div>
  <div class="viewer-container">
    <div id="loading" class="loading-box">
      <div class="spinner"></div>
      <span>Đang tải và hiển thị tài liệu Word (giữ nguyên định dạng & sơ đồ)...</span>
    </div>
    <div id="docx-output"></div>
  </div>
  <script>
    fetch('/output/${encodeURIComponent(fileName)}')
      .then(res => {
        if (!res.ok) throw new Error('Không thể tải file: ' + res.statusText);
        return res.blob();
      })
      .then(blob => {
        return docx.renderAsync(blob, document.getElementById('docx-output'), null, {
          breakPages: true,
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false
        });
      })
      .then(() => {
        document.getElementById('loading').style.display = 'none';
      })
      .catch(err => {
        document.getElementById('loading').innerHTML = '<span style="color:#f87171">Lỗi hiển thị Word: ' + err.message + '</span>';
      });
  </script>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(viewerHtml);
      }

      // For PDF
      if (ext === '.pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
        return fs.createReadStream(filePath).pipe(res);
      }

      // For Images
      if (['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) {
        const mime =
          ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        return fs.createReadStream(filePath).pipe(res);
      }

      // For Markdown / Text
      if (['.md', '.txt', '.json', '.js', '.ts', '.php', '.xml'].includes(ext)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return fs.createReadStream(filePath).pipe(res);
      }

      // Default stream
      return fs.createReadStream(filePath).pipe(res);
    } catch (err: any) {
      console.error('[Preview API Error]', err);
      res.status(500).send(`Lỗi hệ thống: ${err.message}`);
    }
  });

  return app;
}

// Start server directly if this file is executed
if (require.main === module) {
  const app = createServer();
  const port = config.server.port || 3000;
  app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Auto-Dev-Agent Web UI & API Server running on port ${port}`);
    console.log(`👉 Web Dashboard: http://localhost:${port}`);
    console.log(`👉 Health check:   http://localhost:${port}/api/health`);
    console.log(`👉 Skills List:    http://localhost:${port}/api/skills`);
    console.log(`👉 Context View:   http://localhost:${port}/api/context`);
    console.log(`📁 Artifacts:      http://localhost:${port}/output/`);
    console.log(`======================================================\n`);
  });
}
