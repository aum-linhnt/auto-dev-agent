/**
 * Core Types for auto-dev-agent
 * Shared Context Engine & Pluggable Skill Architecture
 */

// ==========================================
// AST & Code Context Types
// ==========================================

export interface EndpointInfo {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL' | string;
  path: string;
  handlerName: string;
  filePath: string;
  line: number;
  params?: Array<{ name: string; type: string; in: 'body' | 'query' | 'param' }>;
  responseType?: string;
  authRequired?: boolean;
}

export interface DtoProperty {
  name: string;
  type: string;
  optional: boolean;
  comment?: string;
}

export interface DtoInfo {
  name: string;
  filePath: string;
  kind: 'interface' | 'type' | 'class';
  properties: DtoProperty[];
  extendsType?: string;
}

export interface FunctionInfo {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
  calls: string[];
  isExported: boolean;
  isAsync: boolean;
  docComment?: string;
}

export interface ClassInfo {
  name: string;
  filePath: string;
  methods: FunctionInfo[];
  properties: Array<{ name: string; type: string }>;
  extendsClass?: string;
  implementsInterfaces?: string[];
}

export interface CallGraphEdge {
  caller: string;
  callee: string;
  callerFile: string;
  calleeFile?: string;
}

export interface CodingConventions {
  naming: 'camelCase' | 'PascalCase' | 'snake_case' | string;
  architecture: 'MVC' | 'Clean/Layered' | 'Modular' | 'NestJS' | 'Moodle Plugin Architecture' | string;
  ormOrDbTool: 'Prisma' | 'TypeORM' | 'Knex' | 'mysql2' | 'Mongoose' | 'Sequelize' | 'Raw SQL' | 'Moodle $DB' | string;
  filePattern: string;
  hasTypeScript: boolean;
  framework: 'Express' | 'NestJS' | 'Fastify' | 'Next.js' | 'Generic Node' | 'Moodle 4.1 (LMS)' | string;
}

export interface ExtractedSql {
  query: string;
  filePath: string;
  line: number;
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER';
}

export interface CodeContext {
  endpoints: EndpointInfo[];
  dtos: DtoInfo[];
  functions: FunctionInfo[];
  classes: ClassInfo[];
  callGraph: CallGraphEdge[];
  conventions: CodingConventions;
  extractedSqls: ExtractedSql[];
  filesScanned: number;
  projectSummary: string;
}

// ==========================================
// Database & SQL Context Types
// ==========================================

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultValue: string | null;
  extra: string;
  comment: string;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  isUnique: boolean;
  type: string;
}

export interface ForeignKeyDefinition {
  constraintName?: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  isImplicit: boolean;
  source: 'HARD_FK' | 'IMPLICIT_SQL';
}

export interface TableDefinition {
  name: string;
  comment?: string;
  engine?: string;
  rowCountEstimate?: number;
  columns: ColumnDefinition[];
  indexes: IndexDefinition[];
  foreignKeys: ForeignKeyDefinition[];
}

export interface DbContext {
  tables: TableDefinition[];
  relationships: ForeignKeyDefinition[];
  implicitJoins: ForeignKeyDefinition[];
  isConnected: boolean;
  dbName?: string;
  summary: string;
}

// ==========================================
// Git Diff & Versioning Types
// ==========================================

export interface GitHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface GitFileDiff {
  filePath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: GitHunk[];
  diffText: string;
}

export interface AffectedElement {
  type: 'function' | 'method' | 'class' | 'endpoint';
  name: string;
  filePath: string;
  lineRange: { start: number; end: number };
}

export interface GitContext {
  branch: string;
  commitHash: string;
  baseBranch?: string;
  changedFiles: GitFileDiff[];
  affectedElements: AffectedElement[];
  rawDiffSummary: string;
}

// ==========================================
// Unified Project Context
// ==========================================

export interface UnifiedProjectContext {
  timestamp: string;
  projectRoot: string;
  code: CodeContext;
  db: DbContext;
  git?: GitContext;
  summary: string;
}

// ==========================================
// Skill Framework Interfaces
// ==========================================

export interface SkillInput {
  targetDir?: string;
  featureName?: string;
  requirements?: string;
  moduleName?: string;
  gitDiffTarget?: string;
  templatePath?: string;
  outputFileName?: string;
  customParams?: Record<string, any>;
  dryRun?: boolean;
}

export interface SkillArtifact {
  type: 'docx' | 'markdown' | 'code' | 'json' | 'diagram';
  filePath: string;
  description?: string;
}

export interface SkillResult {
  success: boolean;
  skillName: string;
  message: string;
  artifacts: SkillArtifact[];
  data?: any;
  errors?: string[];
}

export interface ISkill {
  id: string;
  name: string;
  description: string;
  version: string;
  type: 'built-in' | 'markdown';
  metadata?: {
    tags?: string[];
    author?: string;
    parameters?: Record<string, any>;
    promptTemplate?: string;
    systemInstruction?: string;
  };
  execute(context: UnifiedProjectContext, input: SkillInput): Promise<SkillResult>;
}

