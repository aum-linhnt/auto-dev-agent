import path from 'path';
import fs from 'fs';
import fg from 'fast-glob';
import {
  MoodlePluginSummary,
  MoodlePluginDetail,
  MoodlePluginCapability,
  MoodlePluginService,
  MoodlePluginTask,
  MoodlePluginTable,
  MoodlePluginClass,
  MoodlePluginSetting,
} from '../core/types';

export class MoodlePluginAnalyzer {
  /**
   * List all Moodle plugins found in the project root
   */
  public static async listPlugins(projectRoot: string): Promise<MoodlePluginSummary[]> {
    const resolvedRoot = path.resolve(projectRoot);
    if (!fs.existsSync(resolvedRoot)) {
      return [];
    }

    const versionFiles = await fg(
      ['*/version.php', '*/*/version.php', '*/*/*/version.php', '*/*/*/*/version.php'],
      {
        cwd: resolvedRoot,
        ignore: [
          '**/node_modules/**',
          '**/vendor/**',
          '**/cache/**',
          '**/localcache/**',
          '**/temp/**',
          '**/trashdir/**',
          'version.php', // Root Moodle version
        ],
        absolute: true,
      }
    );

    const plugins: MoodlePluginSummary[] = [];

    for (const vf of versionFiles) {
      try {
        const pluginDir = path.dirname(vf);
        const relPath = path.relative(resolvedRoot, pluginDir);
        if (!relPath || relPath === '.') continue;

        const content = fs.readFileSync(vf, 'utf-8');
        const compMatch = content.match(/\$plugin->component\s*=\s*['"]([^'"]+)['"]/);
        const verMatch = content.match(/\$plugin->version\s*=\s*([0-9]+)/);
        const relMatch = content.match(/\$plugin->release\s*=\s*['"]([^'"]+)['"]/);

        const component = compMatch ? compMatch[1] : path.basename(pluginDir);
        const version = verMatch ? verMatch[1] : '';
        const release = relMatch ? relMatch[1] : undefined;

        // Detect plugin type
        const parts = relPath.split(path.sep);
        const type = parts.length > 2 && parts[0] === 'admin' ? `admin/${parts[1]}` : parts[0];

        // Read lang strings for pluginname
        const langStrings = this.extractLangStrings(pluginDir, component);
        const pluginName = langStrings['pluginname'] || component;

        const hasXmlDb = fs.existsSync(path.join(pluginDir, 'db', 'install.xml'));
        const hasServices = fs.existsSync(path.join(pluginDir, 'db', 'services.php'));
        const hasTasks = fs.existsSync(path.join(pluginDir, 'db', 'tasks.php'));

        plugins.push({
          path: relPath,
          component,
          name: pluginName,
          version,
          release,
          type,
          description: langStrings['pluginname_desc'] || langStrings['settings_title'] || undefined,
          hasXmlDb,
          hasServices,
          hasTasks,
        });
      } catch {
        // Skip unparseable plugin
      }
    }

    // Sort: TNU custom plugins (containing 'th') first, then local/, then alphabetical
    return plugins.sort((a, b) => {
      const aIsTh = a.path.includes('th_') || a.path.includes('th') ? 1 : 0;
      const bIsTh = b.path.includes('th_') || b.path.includes('th') ? 1 : 0;
      if (aIsTh !== bIsTh) return bIsTh - aIsTh;

      const aIsLocal = a.path.startsWith('local/') ? 1 : 0;
      const bIsLocal = b.path.startsWith('local/') ? 1 : 0;
      if (aIsLocal !== bIsLocal) return bIsLocal - aIsLocal;

      return a.path.localeCompare(b.path);
    });
  }

  /**
   * Deep analysis of a specific Moodle plugin
   */
  public static async analyzePlugin(
    projectRoot: string,
    pluginPathOrComponent: string
  ): Promise<MoodlePluginDetail> {
    const resolvedRoot = path.resolve(projectRoot);
    let pluginDir: string;

    // 1. Resolve plugin directory
    if (path.isAbsolute(pluginPathOrComponent) && pluginPathOrComponent.startsWith(resolvedRoot)) {
      pluginDir = pluginPathOrComponent;
    } else {
      const directPath = path.resolve(resolvedRoot, pluginPathOrComponent);
      if (fs.existsSync(path.join(directPath, 'version.php'))) {
        pluginDir = directPath;
      } else {
        // Search by component or folder name
        const allPlugins = await this.listPlugins(resolvedRoot);
        const matched = allPlugins.find(
          (p) =>
            p.component.toLowerCase() === pluginPathOrComponent.toLowerCase() ||
            p.path.toLowerCase() === pluginPathOrComponent.toLowerCase() ||
            path.basename(p.path).toLowerCase() === pluginPathOrComponent.toLowerCase()
        );
        if (matched) {
          pluginDir = path.resolve(resolvedRoot, matched.path);
        } else {
          throw new Error(`Không tìm thấy thư mục plugin Moodle: "${pluginPathOrComponent}" trong ${resolvedRoot}`);
        }
      }
    }

    const relPath = path.relative(resolvedRoot, pluginDir);

    // 2. Parse version.php
    const versionFile = path.join(pluginDir, 'version.php');
    if (!fs.existsSync(versionFile)) {
      throw new Error(`Thư mục "${relPath}" không phải là plugin Moodle hợp lệ (thiếu version.php).`);
    }

    const versionContent = fs.readFileSync(versionFile, 'utf-8');
    const compMatch = versionContent.match(/\$plugin->component\s*=\s*['"]([^'"]+)['"]/);
    const verMatch = versionContent.match(/\$plugin->version\s*=\s*([0-9]+)/);
    const reqMatch = versionContent.match(/\$plugin->requires\s*=\s*([0-9]+)/);
    const relMatch = versionContent.match(/\$plugin->release\s*=\s*['"]([^'"]+)['"]/);
    const matMatch = versionContent.match(/\$plugin->maturity\s*=\s*([A-Za-z0-9_]+)/);

    const component = compMatch ? compMatch[1] : path.basename(pluginDir);
    const version = verMatch ? verMatch[1] : '';
    const requires = reqMatch ? reqMatch[1] : undefined;
    const release = relMatch ? relMatch[1] : undefined;
    const maturity = matMatch ? matMatch[1] : undefined;

    const parts = relPath.split(path.sep);
    const type = parts.length > 2 && parts[0] === 'admin' ? `admin/${parts[1]}` : parts[0];

    // 3. Extract Language Strings
    const langStrings = this.extractLangStrings(pluginDir, component);
    const name = langStrings['pluginname'] || component;

    // 4. Extract Capabilities from db/access.php
    const capabilities = this.extractCapabilities(pluginDir, langStrings);

    // 5. Extract Web Services & AJAX from db/services.php
    const services = this.extractServices(pluginDir);

    // 6. Extract Scheduled Tasks from db/tasks.php
    const tasks = this.extractTasks(pluginDir);

    // 7. Extract Database Tables from db/install.xml & db/upgrade.php
    const tables = this.extractTables(pluginDir);

    // 8. Extract Admin Settings from settings.php
    const settings = this.extractSettings(pluginDir, langStrings);

    // 9. Scan Classes, Controllers, and Code Logic
    const { classes, securityChecks, referencedTables } = await this.scanPhpCode(pluginDir);

    // 10. Scan Mustache Templates and AMD JavaScript
    const templates = await this.scanTemplates(pluginDir);
    const amdModules = await this.scanAmdModules(pluginDir);

    const hasXmlDb = tables.length > 0;
    const hasServices = services.length > 0;
    const hasTasks = tasks.length > 0;

    // 11. Build Detailed Source Summary
    const sourceSummary = this.buildSourceSummary({
      path: relPath,
      component,
      name,
      version,
      release,
      requires,
      maturity,
      type,
      capabilities,
      services,
      tasks,
      tables,
      classes,
      templates,
      amdModules,
      settings,
      securityChecks,
      referencedTables,
      langStrings,
    });

    return {
      path: relPath,
      component,
      name,
      version,
      release,
      requires,
      maturity,
      type,
      description: langStrings['pluginname_desc'] || langStrings['settings_title'] || undefined,
      hasXmlDb,
      hasServices,
      hasTasks,
      capabilities,
      services,
      tasks,
      tables,
      classes,
      templates,
      amdModules,
      settings,
      langStrings,
      securityChecks,
      referencedTables,
      sourceSummary,
    };
  }

  /**
   * Extract language strings from lang/vi/ and lang/en/
   */
  private static extractLangStrings(pluginDir: string, component: string): Record<string, string> {
    const strings: Record<string, string> = {};

    const langPaths = [
      path.join(pluginDir, 'lang', 'en', `${component}.php`),
      path.join(pluginDir, 'lang', 'en', `${component.replace(/^[a-z]+_/, '')}.php`),
      path.join(pluginDir, 'lang', 'vi', `${component}.php`),
      path.join(pluginDir, 'lang', 'vi', `${component.replace(/^[a-z]+_/, '')}.php`),
    ];

    for (const lp of langPaths) {
      if (fs.existsSync(lp)) {
        try {
          const content = fs.readFileSync(lp, 'utf-8');
          const strRegex = /\$string\[['"]([^'"]+)['"]\]\s*=\s*['"]([\s\S]*?)['"]\s*;/g;
          let match;
          while ((match = strRegex.exec(content)) !== null) {
            strings[match[1]] = match[2];
          }
        } catch {
          // Ignore
        }
      }
    }

    return strings;
  }

  /**
   * Extract capabilities from db/access.php
   */
  private static extractCapabilities(
    pluginDir: string,
    langStrings: Record<string, string>
  ): MoodlePluginCapability[] {
    const accessFile = path.join(pluginDir, 'db', 'access.php');
    if (!fs.existsSync(accessFile)) {
      return [];
    }

    const capabilities: MoodlePluginCapability[] = [];
    try {
      const content = fs.readFileSync(accessFile, 'utf-8');
      const capRegex = /['"]([a-zA-Z0-9_\/:]+)['"]\s*=>\s*\[/g;
      let match;

      while ((match = capRegex.exec(content)) !== null) {
        const name = match[1];
        if (!name.includes(':') && !name.includes('/')) continue;

        const startIdx = match.index + match[0].length;
        let depth = 1;
        let endIdx = startIdx;
        while (endIdx < content.length && depth > 0) {
          if (content[endIdx] === '[') depth++;
          else if (content[endIdx] === ']') depth--;
          endIdx++;
        }

        const body = content.substring(startIdx, endIdx - 1);
        const captype = (body.match(/['"]captype['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || 'write';
        const contextlevel =
          (body.match(/['"]contextlevel['"]\s*=>\s*([A-Za-z0-9_]+)/) || [])[1] || 'CONTEXT_SYSTEM';

        const archetypes: Record<string, string> = {};
        const archMatch = body.match(/['"]archetypes['"]\s*=>\s*\[([\s\S]*?)\]/);
        if (archMatch) {
          const roleRegex = /['"]([a-zA-Z0-9_]+)['"]\s*=>\s*([A-Za-z0-9_]+)/g;
          let rm;
          while ((rm = roleRegex.exec(archMatch[1])) !== null) {
            archetypes[rm[1]] = rm[2];
          }
        }

        const shortCap = name.split(':').pop() || name;
        const description =
          langStrings[name] ||
          langStrings[shortCap] ||
          langStrings[`${name.replace('/', '_')}`] ||
          `Quyền hạn thực hiện thao tác ${shortCap}`;

        capabilities.push({
          name,
          captype,
          contextlevel,
          archetypes,
          description,
        });
      }
    } catch {
      // Ignore
    }

    return capabilities;
  }

  /**
   * Extract web services and AJAX endpoints from db/services.php
   */
  private static extractServices(pluginDir: string): MoodlePluginService[] {
    const servicesFile = path.join(pluginDir, 'db', 'services.php');
    if (!fs.existsSync(servicesFile)) {
      return [];
    }

    const services: MoodlePluginService[] = [];
    try {
      const content = fs.readFileSync(servicesFile, 'utf-8');
      const fnRegex = /['"]([a-zA-Z0-9_]+)['"]\s*=>\s*\[/g;
      let match;

      while ((match = fnRegex.exec(content)) !== null) {
        const name = match[1];
        if (name === 'functions' || name === 'services') continue;

        const startIdx = match.index + match[0].length;
        let depth = 1;
        let endIdx = startIdx;
        while (endIdx < content.length && depth > 0) {
          if (content[endIdx] === '[') depth++;
          else if (content[endIdx] === ']') depth--;
          endIdx++;
        }

        const body = content.substring(startIdx, endIdx - 1);
        const classname = (body.match(/['"]classname['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || '';
        const methodname = (body.match(/['"]methodname['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || '';
        const description = (body.match(/['"]description['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || '';
        const type = (body.match(/['"]type['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || 'read';
        const ajaxMatch = body.match(/['"]ajax['"]\s*=>\s*(true|false)/i);
        const isAjax = ajaxMatch ? ajaxMatch[1].toLowerCase() === 'true' : false;

        if (classname || methodname || description) {
          services.push({ name, classname, methodname, description, type, isAjax });
        }
      }
    } catch {
      // Ignore
    }

    return services;
  }

  /**
   * Extract scheduled tasks from db/tasks.php
   */
  private static extractTasks(pluginDir: string): MoodlePluginTask[] {
    const tasksFile = path.join(pluginDir, 'db', 'tasks.php');
    if (!fs.existsSync(tasksFile)) {
      return [];
    }

    const tasks: MoodlePluginTask[] = [];
    try {
      const content = fs.readFileSync(tasksFile, 'utf-8');
      const taskRegex = /\[\s*['"]classname['"]\s*=>\s*['"]([^'"]+)['"]([\s\S]*?)\]/g;
      let match;

      while ((match = taskRegex.exec(content)) !== null) {
        const classname = match[1];
        const body = match[2];
        const minute = (body.match(/['"]minute['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || '*';
        const hour = (body.match(/['"]hour['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || '*';
        const day = (body.match(/['"]day['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1] || '*';
        const blockingMatch = body.match(/['"]blocking['"]\s*=>\s*(0|1|true|false)/i);
        const blocking = blockingMatch ? blockingMatch[1] === '1' || blockingMatch[1] === 'true' : false;

        tasks.push({
          classname,
          schedule: `Min: ${minute}, Hour: ${hour}, Day: ${day}`,
          blocking,
        });
      }
    } catch {
      // Ignore
    }

    return tasks;
  }

  /**
   * Extract database tables from db/install.xml
   */
  private static extractTables(pluginDir: string): MoodlePluginTable[] {
    const installXml = path.join(pluginDir, 'db', 'install.xml');
    if (!fs.existsSync(installXml)) {
      return [];
    }

    const tables: MoodlePluginTable[] = [];
    try {
      const xml = fs.readFileSync(installXml, 'utf-8');
      const tableRegex = /<TABLE\s+NAME="([^"]+)"(?:\s+COMMENT="([^"]*)")?[\s\S]*?<\/TABLE>/g;
      let match;

      while ((match = tableRegex.exec(xml)) !== null) {
        const tableName = match[1];
        const tableComment = match[2] || '';
        const fields: MoodlePluginTable['fields'] = [];

        const fieldRegex =
          /<FIELD\s+NAME="([^"]+)"\s+TYPE="([^"]+)"(?:\s+LENGTH="([^"]*)")?(?:\s+NOTNULL="([^"]*)")?(?:\s+SEQUENCE="([^"]*)")?(?:\s+DEFAULT="([^"]*)")?(?:\s+COMMENT="([^"]*)")?/g;
        let fm;
        while ((fm = fieldRegex.exec(match[0])) !== null) {
          fields.push({
            name: fm[1],
            type: fm[2],
            length: fm[3] || undefined,
            notNull: fm[4] === 'true',
            defaultValue: fm[6] || undefined,
            isPrimaryKey: fm[5] === 'true' || fm[1] === 'id',
            comment: fm[7] || undefined,
          });
        }

        tables.push({
          name: tableName,
          comment: tableComment,
          fields,
        });
      }
    } catch {
      // Ignore
    }

    return tables;
  }

  /**
   * Extract admin settings from settings.php
   */
  private static extractSettings(
    pluginDir: string,
    langStrings: Record<string, string>
  ): MoodlePluginSetting[] {
    const settingsFile = path.join(pluginDir, 'settings.php');
    if (!fs.existsSync(settingsFile)) {
      return [];
    }

    const settings: MoodlePluginSetting[] = [];
    try {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      const settingRegex =
        /new\s+(admin_setting_[a-zA-Z0-9_]+)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:new\s+lang_string\(['"]([^'"]+)['"]|get_string\(['"]([^'"]+)['"]|['"]([^'"]*)['"])/g;
      let match;

      while ((match = settingRegex.exec(content)) !== null) {
        const type = match[1];
        const name = match[2];
        const stringKey = match[3] || match[4] || match[5] || name;
        const title = langStrings[stringKey] || stringKey;
        const descKey = `${stringKey}_desc`;
        const description = langStrings[descKey] || '';

        settings.push({ name, title, description, type });
      }
    } catch {
      // Ignore
    }

    return settings;
  }

  /**
   * Scan classes, methods, security checks, and referenced tables from PHP code
   */
  private static async scanPhpCode(pluginDir: string): Promise<{
    classes: MoodlePluginClass[];
    securityChecks: {
      requiresLogin: boolean;
      capabilitiesChecked: string[];
      hasSesskeyCheck: boolean;
      requiredParams: string[];
    };
    referencedTables: string[];
  }> {
    const phpFiles = await fg(['**/*.php'], {
      cwd: pluginDir,
      ignore: ['**/vendor/**', '**/tests/**', '**/amd/build/**'],
      absolute: true,
    });

    const classes: MoodlePluginClass[] = [];
    const capabilitiesChecked = new Set<string>();
    const requiredParams = new Set<string>();
    const referencedTables = new Set<string>();
    let requiresLogin = false;
    let hasSesskeyCheck = false;

    for (const pf of phpFiles) {
      try {
        const relPath = path.relative(pluginDir, pf);
        const code = fs.readFileSync(pf, 'utf-8');

        if (code.includes('require_login(')) requiresLogin = true;
        if (code.includes('require_sesskey(')) hasSesskeyCheck = true;

        // Capabilities checked in code
        const capCheckRegex = /(?:has_capability|require_capability)\s*\(\s*['"]([^'"]+)['"]/g;
        let cm;
        while ((cm = capCheckRegex.exec(code)) !== null) {
          capabilitiesChecked.add(cm[1]);
        }

        // Params
        const paramRegex = /(?:required_param|optional_param)\s*\(\s*['"]([^'"]+)['"]/g;
        let pm;
        while ((pm = paramRegex.exec(code)) !== null) {
          requiredParams.add(pm[1]);
        }

        // Referenced tables in $DB queries
        const tableRegex = /\{([a-zA-Z0-9_]+)\}/g;
        let tm;
        while ((tm = tableRegex.exec(code)) !== null) {
          referencedTables.add(`mdl_${tm[1]}`);
        }

        // Classes & methods
        const classRegex = /(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)(?:\s+extends\s+([a-zA-Z0-9_\\]+))?/g;
        let clm;
        while ((clm = classRegex.exec(code)) !== null) {
          const className = clm[1];
          const extendsClass = clm[2] || undefined;
          const nsMatch = code.match(/namespace\s+([a-zA-Z0-9_\\]+)\s*;/);
          const namespace = nsMatch ? nsMatch[1] : '';

          const methods: MoodlePluginClass['methods'] = [];
          const methodRegex = /public\s+(?:static\s+)?function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
          let mm;
          while ((mm = methodRegex.exec(code)) !== null) {
            methods.push({
              name: mm[1],
              parameters: mm[2].trim(),
            });
          }

          classes.push({
            name: className,
            namespace,
            filePath: relPath,
            extends: extendsClass,
            methods: methods.slice(0, 10), // Keep top 10 methods per class
          });
        }
      } catch {
        // Skip unparseable PHP file
      }
    }

    return {
      classes,
      securityChecks: {
        requiresLogin,
        capabilitiesChecked: Array.from(capabilitiesChecked),
        hasSesskeyCheck,
        requiredParams: Array.from(requiredParams),
      },
      referencedTables: Array.from(referencedTables),
    };
  }

  /**
   * Scan templates/*.mustache
   */
  private static async scanTemplates(pluginDir: string): Promise<string[]> {
    const tmplDir = path.join(pluginDir, 'templates');
    if (!fs.existsSync(tmplDir)) return [];
    const files = await fg(['**/*.mustache'], { cwd: tmplDir });
    return files;
  }

  /**
   * Scan amd/src/*.js
   */
  private static async scanAmdModules(pluginDir: string): Promise<string[]> {
    const amdDir = path.join(pluginDir, 'amd', 'src');
    if (!fs.existsSync(amdDir)) return [];
    const files = await fg(['**/*.js'], { cwd: amdDir });
    return files;
  }

  /**
   * Synthesize detailed, structured markdown source summary
   */
  private static buildSourceSummary(data: {
    path: string;
    component: string;
    name: string;
    version: string;
    release?: string;
    requires?: string;
    maturity?: string;
    type: string;
    capabilities: MoodlePluginCapability[];
    services: MoodlePluginService[];
    tasks: MoodlePluginTask[];
    tables: MoodlePluginTable[];
    classes: MoodlePluginClass[];
    templates: string[];
    amdModules: string[];
    settings: MoodlePluginSetting[];
    securityChecks: {
      requiresLogin: boolean;
      capabilitiesChecked: string[];
      hasSesskeyCheck: boolean;
      requiredParams: string[];
    };
    referencedTables: string[];
    langStrings: Record<string, string>;
  }): string {
    const lines: string[] = [];

    lines.push(`### THÔNG TIN PLUGIN MOODLE 4.1`);
    lines.push(`- **Thư mục source:** \`${data.path}\``);
    lines.push(`- **Component:** \`${data.component}\``);
    lines.push(`- **Tên hiển thị:** ${data.name}`);
    lines.push(`- **Phiên bản:** ${data.version} ${data.release ? `(${data.release})` : ''}`);
    lines.push(`- **Phân loại plugin:** ${data.type}`);
    if (data.requires) lines.push(`- **Yêu cầu Moodle Core:** ${data.requires}`);
    lines.push('');

    // Capabilities
    lines.push(`### QUYỀN HẠN & CAPABILITIES (db/access.php)`);
    if (data.capabilities.length === 0) {
      lines.push(`- Kế thừa các quyền tiêu chuẩn của Moodle.`);
    } else {
      for (const cap of data.capabilities) {
        const roles = Object.entries(cap.archetypes)
          .map(([r, p]) => `${r}: ${p}`)
          .join(', ');
        lines.push(`- **${cap.name}** (${cap.captype}): ${cap.description}`);
        if (roles) lines.push(`  ↳ Mặc định phân quyền: [${roles}]`);
      }
    }
    lines.push('');

    // Web Services & AJAX
    lines.push(`### WEB SERVICES & AJAX ENDPOINTS (db/services.php)`);
    if (data.services.length === 0) {
      lines.push(`- Không có external service riêng; sử dụng form POST controller.`);
    } else {
      for (const s of data.services) {
        lines.push(`- **${s.name}** [${s.isAjax ? 'AJAX' : 'External WS'}] (${s.type}): ${s.description}`);
        lines.push(`  ↳ Handler: \`${s.classname}::${s.methodname}\``);
      }
    }
    lines.push('');

    // Database Tables
    lines.push(`### CƠ SỞ DỮ LIỆU & BẢNG (db/install.xml)`);
    if (data.tables.length === 0) {
      lines.push(`- Sử dụng các bảng core Moodle: ${data.referencedTables.join(', ') || 'mdl_course, mdl_user'}`);
    } else {
      for (const t of data.tables) {
        lines.push(`- **Bảng:** \`mdl_${t.name}\` ${t.comment ? `(${t.comment})` : ''}`);
        const fieldList = t.fields.map((f) => `${f.name} (${f.type}${f.length ? `:${f.length}` : ''}${f.isPrimaryKey ? ', PK' : ''})`).join(', ');
        lines.push(`  ↳ Cột: ${fieldList}`);
      }
    }
    lines.push('');

    // Scheduled Tasks
    if (data.tasks.length > 0) {
      lines.push(`### SCHEDULED TASKS (db/tasks.php)`);
      for (const task of data.tasks) {
        lines.push(`- Task Class: \`${task.classname}\` (Lịch chạy: ${task.schedule})`);
      }
      lines.push('');
    }

    // Classes & Architecture
    lines.push(`### CÁC LỚP XỬ LÝ CHÍNH (classes/)`);
    for (const c of data.classes.slice(0, 8)) {
      const methods = c.methods.map((m) => `${m.name}()`).join(', ');
      lines.push(`- **Class \`${c.namespace ? `${c.namespace}\\` : ''}${c.name}\`** ${c.extends ? `(extends ${c.extends})` : ''} - \`${c.filePath}\``);
      if (methods) lines.push(`  ↳ Phương thức chính: ${methods}`);
    }
    lines.push('');

    // Security & Parameters
    lines.push(`### KIỂM SOÁT BẢO MẬT & DỮ LIỆU ĐẦU VÀO`);
    lines.push(`- Kiểm tra đăng nhập (require_login): ${data.securityChecks.requiresLogin ? 'CÓ' : 'KHÔNG'}`);
    lines.push(`- Chống CSRF (require_sesskey): ${data.securityChecks.hasSesskeyCheck ? 'CÓ' : 'KHÔNG'}`);
    if (data.securityChecks.capabilitiesChecked.length > 0) {
      lines.push(`- Capabilities kiểm tra trong code: ${data.securityChecks.capabilitiesChecked.join(', ')}`);
    }
    if (data.securityChecks.requiredParams.length > 0) {
      lines.push(`- Tham số tiếp nhận: ${data.securityChecks.requiredParams.slice(0, 10).join(', ')}`);
    }
    lines.push('');

    // Templates & AMD
    if (data.templates.length > 0 || data.amdModules.length > 0) {
      lines.push(`### GIAO DIỆN & TƯƠNG TÁC NGƯỜI DÙNG`);
      if (data.templates.length > 0) lines.push(`- Mustache Templates: ${data.templates.join(', ')}`);
      if (data.amdModules.length > 0) lines.push(`- AMD JavaScript: ${data.amdModules.join(', ')}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

