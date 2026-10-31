#!/usr/bin/env node
import { Command } from 'commander';
import { skillRegistry } from './core/skillRegistry';
import { ContextBuilder } from './context/contextBuilder';
import { MoodlePluginAnalyzer } from './context/moodlePluginAnalyzer';
import { createServer } from './api/server';
import config from './config/env';

const program = new Command();

program
  .name('auto-dev-agent')
  .description('Autonomous AI Development Agent: Shared Context Engine + Pluggable Skills')
  .version('1.0.0');

// 1. List Skills Command
program
  .command('list')
  .alias('ls')
  .description('List all available skills (Built-in and Dynamic Markdown)')
  .action(async () => {
    await skillRegistry.initialize();
    const skills = skillRegistry.listSkills();

    console.log(`\n======================================================`);
    console.log(`🧠 AVAILABLE SKILLS IN AUTO-DEV-AGENT (${skills.length})`);
    console.log(`======================================================\n`);

    for (const skill of skills) {
      const typeBadge = skill.type === 'built-in' ? '[BUILT-IN]' : '[MARKDOWN]';
      console.log(`👉 \x1b[36m${skill.id}\x1b[0m \x1b[33m${typeBadge}\x1b[0m (v${skill.version})`);
      console.log(`   \x1b[1m${skill.name}\x1b[0m`);
      console.log(`   ${skill.description}`);
      if (skill.metadata?.tags && skill.metadata.tags.length > 0) {
        console.log(`   Tags: ${skill.metadata.tags.join(', ')}`);
      }
      console.log('');
    }
  });

// 2. Project Context Inspection Command
program
  .command('context')
  .description('Analyze and display the Unified Project Context (AST, Database, Git)')
  .option('-g, --git-diff <target>', 'Target branch/commit to diff against')
  .action(async (options) => {
    console.log(`\n🔍 Analyzing Unified Project Context...\n`);
    const builder = new ContextBuilder();
    const ctx = await builder.buildContext({ gitDiffTarget: options.gitDiff });

    console.log(`\n======================================================`);
    console.log(`📊 UNIFIED PROJECT CONTEXT OVERVIEW`);
    console.log(`======================================================`);
    console.log(ctx.summary);
    console.log(`\nAST Endpoints found: ${ctx.code.endpoints.length}`);
    for (const ep of ctx.code.endpoints.slice(0, 5)) {
      console.log(`  - [${ep.method}] ${ep.path} -> ${ep.handlerName}`);
    }
    if (ctx.code.endpoints.length > 5) {
      console.log(`    ... and ${ctx.code.endpoints.length - 5} more endpoints.`);
    }

    console.log(`\nDatabase Tables found: ${ctx.db.tables.length}`);
    for (const tbl of ctx.db.tables.slice(0, 5)) {
      console.log(`  - Table: ${tbl.name} (${tbl.columns.length} columns, ${tbl.indexes.length} indexes)`);
    }

    if (ctx.git) {
      console.log(`\nGit Changed Files: ${ctx.git.changedFiles.length}`);
      for (const f of ctx.git.changedFiles.slice(0, 5)) {
        console.log(`  - [${f.status}] ${f.filePath} (+${f.additions}/-${f.deletions})`);
      }
    }
    console.log(`======================================================\n`);
  });

// 3. Moodle Plugins Discovery Command
program
  .command('plugins')
  .alias('moodle-plugins')
  .description('Discover and list all Moodle plugins in the connected Moodle project')
  .option('-t, --type <type>', 'Filter by plugin type (e.g. local, mod, block, report)')
  .option('-s, --search <keyword>', 'Search by keyword (name, component, or path)')
  .action(async (options) => {
    console.log(`\n🔍 Scanning Moodle plugins in: \x1b[36m${config.paths.projectRoot}\x1b[0m...\n`);
    let plugins = await MoodlePluginAnalyzer.listPlugins(config.paths.projectRoot);

    if (options.type) {
      const filterType = options.type.toLowerCase();
      plugins = plugins.filter((p) => p.type.toLowerCase().includes(filterType));
    }

    if (options.search) {
      const q = options.search.toLowerCase();
      plugins = plugins.filter(
        (p) =>
          p.component.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q)
      );
    }

    console.log(`======================================================`);
    console.log(`📦 DISCOVERED MOODLE PLUGINS (${plugins.length})`);
    console.log(`======================================================\n`);

    for (const p of plugins.slice(0, 30)) {
      const badge = p.path.includes('th_') || p.path.includes('th') ? '\x1b[32m[TNU CUSTOM]\x1b[0m' : '\x1b[34m[CORE/PLUGIN]\x1b[0m';
      console.log(`👉 \x1b[36m${p.path}\x1b[0m ${badge}`);
      console.log(`   Component: \x1b[1m${p.component}\x1b[0m | Phiên bản: ${p.version || 'N/A'}${p.release ? ` (${p.release})` : ''}`);
      console.log(`   Tên hiển thị: ${p.name}`);
      const features: string[] = [];
      if (p.hasXmlDb) features.push('XMLDB');
      if (p.hasServices) features.push('WebServices');
      if (p.hasTasks) features.push('Tasks');
      if (features.length > 0) {
        console.log(`   Đặc tính: \x1b[33m${features.join(', ')}\x1b[0m`);
      }
      console.log('');
    }

    if (plugins.length > 30) {
      console.log(`... and ${plugins.length - 30} more plugins. Use -s <keyword> to narrow down search.`);
    }

    console.log(`💡 Mẹo: Sinh tài liệu nhanh cho plugin bằng lệnh:`);
    console.log(`   npm run cli -- run doc-gen -p <plugin-path> -T srs\n`);
  });

// 4. Run Skill Command
program
  .command('run <skillId>')
  .description('Execute a specific skill (e.g. doc-gen, code-gen, code-review, sql-optimizer)')
  .option('-p, --plugin <path>', 'Moodle plugin directory or component (e.g. local/th_coursesetup)')
  .option('-f, --feature <name>', 'Feature name')
  .option('-r, --requirements <text>', 'Functional or technical requirements')
  .option('-m, --module <name>', 'Target module name')
  .option('-g, --git-diff <target>', 'Git diff target branch or commit')
  .option('-t, --template <path>', 'Custom Word template .docx path')
  .option('-T, --doc-type <type>', 'Document type for doc-gen: srs | sad | brd | guide', 'srs')
  .option('-o, --output <filename>', 'Output file name')
  .option('-d, --dry-run', 'Dry run without modifying code files', false)
  .action(async (skillId, options) => {
    try {
      await skillRegistry.initialize();

      console.log(`\n🚀 Initializing execution for skill: \x1b[36m${skillId}\x1b[0m...`);
      const result = await skillRegistry.executeSkill(skillId, {
        featureName: options.feature,
        requirements: options.requirements,
        moduleName: options.module,
        gitDiffTarget: options.gitDiff,
        templatePath: options.template,
        outputFileName: options.output,
        dryRun: options.dryRun,
        customParams: {
          docType: options.docType,
          pluginPath: options.plugin,
        },
      });

      console.log(`\n======================================================`);
      console.log(`✅ EXECUTION RESULT: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      console.log(`======================================================`);
      console.log(`Skill:   ${result.skillName}`);
      console.log(`Message: ${result.message}`);

      if (result.artifacts && result.artifacts.length > 0) {
        console.log(`\n📁 Generated Artifacts:`);
        for (const art of result.artifacts) {
          console.log(`  [${art.type.toUpperCase()}] ${art.filePath}`);
          if (art.description) {
            console.log(`    ↳ ${art.description}`);
          }
        }
      }

      if (result.errors && result.errors.length > 0) {
        console.log(`\n⚠️ Warnings / Diagnostics:`);
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
      }
      console.log(`======================================================\n`);
    } catch (err: any) {
      console.error(`\n❌ Error executing skill: ${err.message}\n`);
      process.exit(1);
    }
  });

// 4. Start Server Command
program
  .command('serve')
  .alias('ui')
  .description('Start the Web UI Dashboard and Express REST API server')
  .option('-p, --port <number>', 'Port to listen on', `${config.server.port}`)
  .action((options) => {
    const port = parseInt(options.port, 10) || config.server.port;
    const app = createServer();
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
  });

// Default action if no arguments provided
if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}

