import { ISkill, SkillInput, SkillResult, UnifiedProjectContext } from './types';
import { DocGenSkill } from '../built-in-skills/docGenSkill';
import { CodeGenSkill } from '../built-in-skills/codeGenSkill';
import { CodeReviewSkill } from '../built-in-skills/codeReviewSkill';
import { MarkdownSkillLoader } from './markdownSkillLoader';
import { ContextBuilder } from '../context/contextBuilder';

export class SkillRegistry {
  private skills: Map<string, ISkill> = new Map();
  private markdownLoader: MarkdownSkillLoader;
  private contextBuilder: ContextBuilder;
  private initialized = false;

  constructor() {
    this.markdownLoader = new MarkdownSkillLoader();
    this.contextBuilder = new ContextBuilder();
  }

  /**
   * Initialize registry with Built-in skills and scan dynamic Markdown skills
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. Register Built-in Skills
    this.registerSkill(new DocGenSkill());
    this.registerSkill(new CodeGenSkill());
    this.registerSkill(new CodeReviewSkill());

    // 2. Scan and Register Dynamic Markdown Skills
    const dynamicSkills = await this.markdownLoader.loadSkills();
    for (const skill of dynamicSkills) {
      this.registerSkill(skill);
    }

    this.initialized = true;
    console.log(`[SkillRegistry] Initialized with ${this.skills.size} skills (${this.listSkills().filter((s) => s.type === 'markdown').length} dynamic markdown skills).`);
  }

  /**
   * Register a new skill
   */
  public registerSkill(skill: ISkill): void {
    this.skills.set(skill.id.toLowerCase(), skill);
  }

  /**
   * Retrieve a skill by its ID
   */
  public getSkill(id: string): ISkill | undefined {
    return this.skills.get(id.toLowerCase());
  }

  /**
   * List all registered skills
   */
  public listSkills(): ISkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Execute a skill by ID with input and context
   */
  public async executeSkill(
    id: string,
    input: SkillInput,
    context?: UnifiedProjectContext
  ): Promise<SkillResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const skill = this.getSkill(id);
    if (!skill) {
      throw new Error(`Skill with ID "${id}" not found. Available skills: ${Array.from(this.skills.keys()).join(', ')}`);
    }

    // Build context if not provided
    const unifiedContext = context || (await this.contextBuilder.buildContext({
      gitDiffTarget: input.gitDiffTarget,
    }));

    return await skill.execute(unifiedContext, input);
  }
}

// Global default singleton instance
export const skillRegistry = new SkillRegistry();

