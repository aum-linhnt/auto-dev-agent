import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import {
  ISkill,
  SkillInput,
  SkillResult,
  UnifiedProjectContext,
  SkillArtifact,
} from './types';
import { LlmService } from '../services/llmService';
import config from '../config/env';

export class MarkdownSkillLoader {
  private skillsDir: string;
  private llmService: LlmService;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || config.paths.skillsDir;
    this.llmService = new LlmService();
  }

  /**
   * Scan /skills directory for all SKILL.md files and instantiate dynamic ISkill instances
   */
  public async loadSkills(): Promise<ISkill[]> {
    if (!fs.existsSync(this.skillsDir)) {
      return [];
    }

    const skillFiles = await fg('**/SKILL.md', {
      cwd: this.skillsDir,
      absolute: true,
    });

    const loadedSkills: ISkill[] = [];

    for (const file of skillFiles) {
      try {
        const skill = this.parseSkillFile(file);
        if (skill) {
          loadedSkills.push(skill);
        }
      } catch (err: any) {
        console.warn(`[MarkdownSkillLoader] Failed to load skill from ${file}: ${err.message}`);
      }
    }

    return loadedSkills;
  }

  /**
   * Parse a single SKILL.md into an ISkill
   */
  private parseSkillFile(filePath: string): ISkill | null {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(rawContent);

    const data = parsed.data || {};
    const instructions = parsed.content.trim();

    const parentDirName = path.basename(path.dirname(filePath));
    const id = data.id || parentDirName;
    const name = data.name || parentDirName;
    const description = data.description || 'Custom Dynamic Markdown Skill';
    const version = data.version || '1.0.0';

    const llmService = this.llmService;

    return {
      id,
      name,
      description,
      version,
      type: 'markdown',
      metadata: {
        tags: data.tags || [],
        author: data.author || 'User',
        parameters: data.parameters || {},
        systemInstruction: data.systemInstruction,
        promptTemplate: instructions,
      },
      async execute(context: UnifiedProjectContext, input: SkillInput): Promise<SkillResult> {
        console.log(`[DynamicSkill: ${id}] Executing markdown skill with UnifiedContext...`);

        // Build dynamic prompt combining markdown instructions + project context + user input
        const prompt = `
=== CUSTOM SKILL INSTRUCTIONS ===
${instructions}

=== TARGET PARAMETERS ===
Feature/Target: ${input.featureName || input.moduleName || 'Current Project'}
Requirements: ${input.requirements || 'N/A'}
Custom Params: ${JSON.stringify(input.customParams || {})}

=== UNIFIED PROJECT CONTEXT ===
${context.summary}

Codebase Conventions: Framework ${context.code.conventions.framework}, Architecture ${context.code.conventions.architecture}, DB Tool ${context.code.conventions.ormOrDbTool}.
Endpoints Found: ${context.code.endpoints.length}
Database Tables: ${context.db.tables.map((t) => t.name).join(', ') || 'None'}
Extracted SQL Queries:
${context.code.extractedSqls.slice(0, 10).map((s) => `[${s.filePath}:${s.line}] ${s.query}`).join('\n')}

Hãy thực thi theo đúng hướng dẫn trên và trả về kết quả dưới định dạng Markdown chi tiết, chuyên nghiệp.
`;

        const outputText = await llmService.generate({
          prompt,
          systemInstruction:
            data.systemInstruction ||
            `You are an expert AI software engineer executing a specialized custom skill: ${name}. Follow instructions strictly.`,
        });

        // Save output to output/
        const timestamp = Date.now();
        const outFileName = input.outputFileName || `${id}_output_${timestamp}.md`;
        const outFilePath = path.join(config.paths.outputDir, outFileName);

        const outDir = path.dirname(outFilePath);
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        fs.writeFileSync(outFilePath, outputText, 'utf-8');

        const artifacts: SkillArtifact[] = [
          {
            type: 'markdown',
            filePath: outFilePath,
            description: `Generated output for skill ${name}`,
          },
        ];

        return {
          success: true,
          skillName: name,
          message: `Kỹ năng "${name}" đã thực thi thành công. Báo cáo được lưu tại: ${outFilePath}`,
          artifacts,
          data: {
            outputFile: outFilePath,
            contentPreview: outputText.slice(0, 300),
          },
        };
      },
    };
  }
}

