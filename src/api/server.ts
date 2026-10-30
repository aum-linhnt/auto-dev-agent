import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import config from '../config/env';
import { skillRegistry } from '../core/skillRegistry';
import { ContextBuilder } from '../context/contextBuilder';
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
