import path from 'path';
import fg from 'fast-glob';
import { Project, SyntaxKind, Node, CallExpression, MethodDeclaration, FunctionDeclaration } from 'ts-morph';
import {
  CodeContext,
  EndpointInfo,
  DtoInfo,
  FunctionInfo,
  ClassInfo,
  CallGraphEdge,
  CodingConventions,
  ExtractedSql,
} from '../core/types';

export class CodeAnalyzer {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /**
   * Run full AST and code analysis on project files
   */
  public async analyze(): Promise<CodeContext> {
    const filePatterns = ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'];
    const ignorePatterns = [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/output/**',
      '**/templates/**',
      '**/.git/**',
      '**/coverage/**',
      '**/*.d.ts',
    ];

    const filePaths = await fg(filePatterns, {
      cwd: this.projectRoot,
      ignore: ignorePatterns,
      absolute: true,
    });

    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
      },
    });

    // Add source files
    for (const filePath of filePaths) {
      project.addSourceFileAtPath(filePath);
    }

    const endpoints: EndpointInfo[] = [];
    const dtos: DtoInfo[] = [];
    const functions: FunctionInfo[] = [];
    const classes: ClassInfo[] = [];
    const callGraph: CallGraphEdge[] = [];
    const extractedSqls: ExtractedSql[] = [];

    const sourceFiles = project.getSourceFiles();

    for (const sourceFile of sourceFiles) {
      const filePath = path.relative(this.projectRoot, sourceFile.getFilePath());

      // 1. Analyze Endpoints (Express & NestJS patterns)
      this.extractEndpoints(sourceFile, filePath, endpoints);

      // 2. Analyze DTOs, Interfaces, Types
      this.extractDtos(sourceFile, filePath, dtos);

      // 3. Analyze Classes & Functions
      this.extractClassesAndFunctions(sourceFile, filePath, classes, functions, callGraph);

      // 4. Extract Embedded SQL Strings
      this.extractSqlStrings(sourceFile, filePath, extractedSqls);
    }

    const conventions = this.detectConventions(sourceFiles, endpoints, extractedSqls);
    const projectSummary = this.buildSummary(filePaths.length, endpoints, dtos, classes, conventions);

    return {
      endpoints,
      dtos,
      functions,
      classes,
      callGraph,
      conventions,
      extractedSqls,
      filesScanned: filePaths.length,
      projectSummary,
    };
  }

  /**
   * Extract REST API Endpoints from AST
   */
  private extractEndpoints(sourceFile: any, filePath: string, endpoints: EndpointInfo[]) {
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpr of callExpressions) {
      const expr = callExpr.getExpression();
      const text = expr.getText();

      // Express router patterns: router.get('/path', handler), app.post('/path', handler)
      const expressMatch = text.match(/(?:app|router|server)\.(get|post|put|delete|patch|all)/i);
      if (expressMatch) {
        const method = expressMatch[1].toUpperCase();
        const args = callExpr.getArguments();
        if (args.length >= 2) {
          const firstArg = args[0];
          let routePath = '/';
          if (Node.isStringLiteral(firstArg)) {
            routePath = firstArg.getLiteralText();
          }

          // Handler can be last arg or named function
          const handlerArg = args[args.length - 1];
          const handlerName = handlerArg.getText().substring(0, 50);

          // Check for auth middleware in intermediate args
          const argsText = args.map((a: any) => a.getText()).join(' ');
          const authRequired = /auth|verify|guard|protect|jwt|passport|permission/i.test(argsText);

          endpoints.push({
            method,
            path: routePath,
            handlerName,
            filePath,
            line: callExpr.getStartLineNumber(),
            authRequired,
          });
        }
      }
    }

    // NestJS decorator patterns: @Controller('prefix'), @Get('path'), @Post('path')
    const classDeclarations = sourceFile.getClasses();
    for (const classDecl of classDeclarations) {
      const controllerDecorator = classDecl.getDecorator('Controller');
      if (controllerDecorator) {
        const prefixArg = controllerDecorator.getArguments()[0];
        let controllerPrefix = '';
        if (prefixArg && Node.isStringLiteral(prefixArg)) {
          controllerPrefix = prefixArg.getLiteralText();
        }

        for (const method of classDecl.getMethods()) {
          const httpDecorators = ['Get', 'Post', 'Put', 'Delete', 'Patch'];
          for (const decName of httpDecorators) {
            const dec = method.getDecorator(decName);
            if (dec) {
              const methodArg = dec.getArguments()[0];
              let subPath = '';
              if (methodArg && Node.isStringLiteral(methodArg)) {
                subPath = methodArg.getLiteralText();
              }
              const fullPath = `/${controllerPrefix}/${subPath}`.replace(/\/+/g, '/');
              const authRequired =
                !!classDecl.getDecorator('UseGuards') || !!method.getDecorator('UseGuards');

              endpoints.push({
                method: decName.toUpperCase(),
                path: fullPath,
                handlerName: `${classDecl.getName()}.${method.getName()}`,
                filePath,
                line: method.getStartLineNumber(),
                authRequired,
              });
            }
          }
        }
      }
    }
  }

  /**
   * Extract Interfaces, Types, and DTO classes
   */
  private extractDtos(sourceFile: any, filePath: string, dtos: DtoInfo[]) {
    // Interfaces
    for (const iface of sourceFile.getInterfaces()) {
      const properties = iface.getProperties().map((prop: any) => ({
        name: prop.getName(),
        type: prop.getType().getText(),
        optional: prop.hasQuestionToken(),
        comment: prop.getLeadingCommentRanges().map((r: any) => r.getText()).join(' ').trim(),
      }));

      dtos.push({
        name: iface.getName(),
        filePath,
        kind: 'interface',
        properties,
        extendsType: iface.getExtends().map((e: any) => e.getText()).join(', ') || undefined,
      });
    }

    // Type Aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      dtos.push({
        name: typeAlias.getName(),
        filePath,
        kind: 'type',
        properties: [],
      });
    }

    // DTO Classes (naming matches *Dto or *Request or *Response or *Payload)
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() || '';
      if (/dto|request|response|payload|input|params/i.test(className)) {
        const properties = cls.getProperties().map((prop: any) => ({
          name: prop.getName(),
          type: prop.getType().getText(),
          optional: prop.hasQuestionToken(),
        }));

        dtos.push({
          name: className,
          filePath,
          kind: 'class',
          properties,
        });
      }
    }
  }

  /**
   * Extract Classes, Methods, Functions and build Call Graph
   */
  private extractClassesAndFunctions(
    sourceFile: any,
    filePath: string,
    classes: ClassInfo[],
    functions: FunctionInfo[],
    callGraph: CallGraphEdge[]
  ) {
    // Classes
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName() || 'AnonymousClass';
      const methodsInfo: FunctionInfo[] = [];

      for (const method of cls.getMethods()) {
        const calls = this.extractCallsInside(method);
        const methodInfo: FunctionInfo = {
          name: `${className}.${method.getName()}`,
          filePath,
          startLine: method.getStartLineNumber(),
          endLine: method.getEndLineNumber(),
          parameters: method.getParameters().map((p: any) => ({
            name: p.getName(),
            type: p.getType().getText(),
          })),
          returnType: method.getReturnType().getText(),
          calls,
          isExported: cls.isExported(),
          isAsync: method.isAsync(),
        };
        methodsInfo.push(methodInfo);

        for (const callee of calls) {
          callGraph.push({
            caller: methodInfo.name,
            callee,
            callerFile: filePath,
          });
        }
      }

      classes.push({
        name: className,
        filePath,
        methods: methodsInfo,
        properties: cls.getProperties().map((p: any) => ({
          name: p.getName(),
          type: p.getType().getText(),
        })),
        extendsClass: cls.getBaseClass()?.getName(),
        implementsInterfaces: cls.getImplements().map((i: any) => i.getText()),
      });
    }

    // Standalone Functions
    for (const fn of sourceFile.getFunctions()) {
      const fnName = fn.getName() || 'anonymous';
      const calls = this.extractCallsInside(fn);
      const funcInfo: FunctionInfo = {
        name: fnName,
        filePath,
        startLine: fn.getStartLineNumber(),
        endLine: fn.getEndLineNumber(),
        parameters: fn.getParameters().map((p: any) => ({
          name: p.getName(),
          type: p.getType().getText(),
        })),
        returnType: fn.getReturnType().getText(),
        calls,
        isExported: fn.isExported(),
        isAsync: fn.isAsync(),
      };
      functions.push(funcInfo);

      for (const callee of calls) {
        callGraph.push({
          caller: fnName,
          callee,
          callerFile: filePath,
        });
      }
    }
  }

  /**
   * Extract function/method call expressions inside a body
   */
  private extractCallsInside(node: MethodDeclaration | FunctionDeclaration): string[] {
    const calls: string[] = [];
    const callExpressions = node.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpr of callExpressions) {
      const expr = callExpr.getExpression();
      const text = expr.getText();
      // Simplify e.g. this.userService.getUserById -> userService.getUserById
      const cleanCall = text.replace(/^this\./, '');
      if (cleanCall && !calls.includes(cleanCall)) {
        calls.push(cleanCall);
      }
    }
    return calls;
  }

  /**
   * Extract SQL query string literals from source code
   */
  private extractSqlStrings(sourceFile: any, filePath: string, extractedSqls: ExtractedSql[]) {
    const stringLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral);
    const templateLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral);
    const templateExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression);

    const allLiterals = [...stringLiterals, ...templateLiterals, ...templateExpressions];

    for (const lit of allLiterals) {
      const text = lit.getText().replace(/^[`'"]|[`'"]$/g, '').trim();
      const upper = text.toUpperCase();

      if (
        upper.startsWith('SELECT ') ||
        upper.startsWith('INSERT INTO ') ||
        upper.startsWith('UPDATE ') ||
        upper.startsWith('DELETE FROM ')
      ) {
        let type: ExtractedSql['type'] = 'OTHER';
        if (upper.startsWith('SELECT')) type = 'SELECT';
        else if (upper.startsWith('INSERT')) type = 'INSERT';
        else if (upper.startsWith('UPDATE')) type = 'UPDATE';
        else if (upper.startsWith('DELETE')) type = 'DELETE';

        extractedSqls.push({
          query: text,
          filePath,
          line: lit.getStartLineNumber(),
          type,
        });
      }
    }
  }

  /**
   * Infer project coding conventions from analyzed files
   */
  private detectConventions(
    sourceFiles: any[],
    endpoints: EndpointInfo[],
    extractedSqls: ExtractedSql[]
  ): CodingConventions {
    const filePaths = sourceFiles.map((f) => f.getFilePath());

    // Framework detection
    let framework: CodingConventions['framework'] = 'Generic Node';
    let architecture: CodingConventions['architecture'] = 'Modular';
    let ormPattern: CodingConventions['ormOrDbTool'] = 'Raw SQL';

    if (filePaths.some((p) => p.includes('version.php') || p.includes('moodle') || p.includes('classes/external'))) {
      framework = 'Moodle 4.1 (LMS)';
      architecture = 'Moodle Plugin Architecture (Modular)';
      ormPattern = 'Moodle $DB (XMLDB / MySQL)';
    } else if (filePaths.some((p) => p.includes('.controller.ts') || p.includes('.module.ts'))) {
      framework = 'NestJS';
      architecture = 'NestJS';
    } else if (endpoints.length > 0) {
      framework = 'Express';
      architecture = filePaths.some((p) => p.includes('controllers') || p.includes('routes')) ? 'MVC' : 'Modular';
    }

    // ORM / DB tool detection (if not already Moodle $DB)
    if (ormPattern === 'Raw SQL') {
      if (filePaths.some((p) => p.includes('prisma'))) {
        ormPattern = 'Prisma';
      } else if (filePaths.some((p) => p.includes('typeorm') || p.includes('.entity.ts'))) {
        ormPattern = 'TypeORM';
      } else if (filePaths.some((p) => p.includes('knex'))) {
        ormPattern = 'Knex';
      } else if (extractedSqls.length > 0 || filePaths.some((p) => p.includes('mysql2'))) {
        ormPattern = 'mysql2';
      }
    }

    return {
      naming: 'camelCase',
      architecture,
      ormOrDbTool: ormPattern,
      filePattern: framework === 'NestJS' ? '*.controller.ts, *.service.ts' : '*.routes.ts, *.controller.ts, *.service.ts',
      hasTypeScript: filePaths.some((p) => p.endsWith('.ts')),
      framework,
    };
  }

  /**
   * Create an executive summary of the code analysis
   */
  private buildSummary(
    totalFiles: number,
    endpoints: EndpointInfo[],
    dtos: DtoInfo[],
    classes: ClassInfo[],
    conventions: CodingConventions
  ): string {
    return (
      `Project Code Overview:\n` +
      `- Scanned ${totalFiles} source files.\n` +
      `- Framework: ${conventions.framework} | Architecture: ${conventions.architecture} | DB Tool: ${conventions.ormOrDbTool}.\n` +
      `- Discovered ${endpoints.length} API endpoints, ${dtos.length} DTOs/types, and ${classes.length} classes.\n` +
      `- TypeScript: ${conventions.hasTypeScript ? 'Active' : 'No'}.`
    );
  }
}

