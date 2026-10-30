import mysql from 'mysql2/promise';
import { Parser, AST } from 'node-sql-parser';
import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import {
  DbContext,
  TableDefinition,
  ColumnDefinition,
  IndexDefinition,
  ForeignKeyDefinition,
  ExtractedSql,
} from '../core/types';
import config from '../config/env';

export class DbAnalyzer {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
  }

  /**
   * Run complete DB and SQL schema analysis
   */
  public async analyze(extractedSqls: ExtractedSql[] = []): Promise<DbContext> {
    let tables: TableDefinition[] = [];
    let isConnected = false;
    let dbName = config.db.database;

    // 1. Try to connect to MySQL INFORMATION_SCHEMA
    if (config.db.database) {
      try {
        const connection = await mysql.createConnection({
          host: config.db.host,
          port: config.db.port,
          user: config.db.user,
          password: config.db.password,
          database: config.db.database,
          connectTimeout: 3000,
        });

        tables = await this.readInformationSchema(connection, config.db.database);
        await connection.end();
        isConnected = true;
      } catch (err: any) {
        // Connection failed or DB offline; fallback to SQL files / migration scanning
        console.warn(`[DbAnalyzer] Could not connect to MySQL at ${config.db.host}:${config.db.port}: ${err.message}.`);
      }
    }

    // 2. If not connected, scan local SQL / migration / Moodle XMLDB files
    if (!isConnected || tables.length === 0) {
      const moodleXmlTables = await this.parseMoodleXmlDbFiles();
      if (moodleXmlTables.length > 0) {
        tables = moodleXmlTables;
        dbName = dbName || 'Moodle 4.1 XMLDB';
      } else {
        const sqlTables = await this.parseSqlMigrationFiles();
        if (sqlTables.length > 0) {
          tables = sqlTables;
          dbName = dbName || 'Local SQL Files';
        } else {
          // Canonical Moodle 4.1 LMS Core Database Schema fallback
          tables = this.getMoodle41DefaultSchema();
          dbName = 'Moodle 4.1 LMS Database';
        }
      }
    }

    // 3. Collect Hard Foreign Keys
    const hardFks: ForeignKeyDefinition[] = [];
    for (const table of tables) {
      for (const fk of table.foreignKeys) {
        hardFks.push(fk);
      }
    }

    // 4. Parse Implicit Joins from code queries using node-sql-parser
    const implicitJoins = this.extractImplicitJoins(extractedSqls, tables, hardFks);

    // Merge implicit joins into table definitions for comprehensive cross-reference
    for (const imp of implicitJoins) {
      const tbl = tables.find((t) => t.name.toLowerCase() === imp.fromTable.toLowerCase());
      if (tbl && !tbl.foreignKeys.some((f) => f.fromColumn === imp.fromColumn && f.toTable === imp.toTable)) {
        tbl.foreignKeys.push(imp);
      }
    }

    const summary = this.buildSummary(tables, hardFks, implicitJoins, isConnected, dbName);

    return {
      tables,
      relationships: [...hardFks, ...implicitJoins],
      implicitJoins,
      isConnected,
      dbName,
      summary,
    };
  }

  /**
   * Query MySQL INFORMATION_SCHEMA tables, columns, indexes, and FKs
   */
  private async readInformationSchema(
    connection: mysql.Connection,
    dbName: string
  ): Promise<TableDefinition[]> {
    // 1. Tables
    const [tableRows] = await connection.query<any[]>(
      `SELECT TABLE_NAME, TABLE_COMMENT, ENGINE, TABLE_ROWS 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ?`,
      [dbName]
    );

    // 2. Columns
    const [columnRows] = await connection.query<any[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = ? 
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [dbName]
    );

    // 3. Indexes
    const [indexRows] = await connection.query<any[]>(
      `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX, INDEX_TYPE 
       FROM INFORMATION_SCHEMA.STATISTICS 
       WHERE TABLE_SCHEMA = ? 
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [dbName]
    );

    // 4. Foreign Keys
    const [fkRows] = await connection.query<any[]>(
      `SELECT 
         kcu.CONSTRAINT_NAME,
         kcu.TABLE_NAME as FROM_TABLE,
         kcu.COLUMN_NAME as FROM_COLUMN,
         kcu.REFERENCED_TABLE_NAME as TO_TABLE,
         kcu.REFERENCED_COLUMN_NAME as TO_COLUMN
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName]
    );

    const tables: TableDefinition[] = [];

    for (const tRow of tableRows) {
      const tableName = tRow.TABLE_NAME;

      // Table columns
      const cols: ColumnDefinition[] = columnRows
        .filter((c: any) => c.TABLE_NAME === tableName)
        .map((c: any) => ({
          name: c.COLUMN_NAME,
          type: c.COLUMN_TYPE || c.DATA_TYPE,
          nullable: c.IS_NULLABLE === 'YES',
          isPrimaryKey: c.COLUMN_KEY === 'PRI',
          isForeignKey: c.COLUMN_KEY === 'MUL',
          defaultValue: c.COLUMN_DEFAULT,
          extra: c.EXTRA || '',
          comment: c.COLUMN_COMMENT || '',
        }));

      // Table indexes
      const tableIndexes = indexRows.filter((i: any) => i.TABLE_NAME === tableName);
      const indexMap = new Map<string, IndexDefinition>();
      for (const idx of tableIndexes) {
        if (!indexMap.has(idx.INDEX_NAME)) {
          indexMap.set(idx.INDEX_NAME, {
            name: idx.INDEX_NAME,
            columns: [idx.COLUMN_NAME],
            isUnique: idx.NON_UNIQUE === 0,
            type: idx.INDEX_TYPE || 'BTREE',
          });
        } else {
          indexMap.get(idx.INDEX_NAME)!.columns.push(idx.COLUMN_NAME);
        }
      }

      // Foreign keys
      const fks: ForeignKeyDefinition[] = fkRows
        .filter((f: any) => f.FROM_TABLE === tableName)
        .map((f: any) => ({
          constraintName: f.CONSTRAINT_NAME,
          fromTable: f.FROM_TABLE,
          fromColumn: f.FROM_COLUMN,
          toTable: f.TO_TABLE,
          toColumn: f.TO_COLUMN,
          isImplicit: false,
          source: 'HARD_FK',
        }));

      tables.push({
        name: tableName,
        comment: tRow.TABLE_COMMENT || undefined,
        engine: tRow.ENGINE || undefined,
        rowCountEstimate: tRow.TABLE_ROWS ? Number(tRow.TABLE_ROWS) : undefined,
        columns: cols,
        indexes: Array.from(indexMap.values()),
        foreignKeys: fks,
      });
    }

    return tables;
  }

  /**
   * Extract Implicit Joins from queries using node-sql-parser
   */
  public extractImplicitJoins(
    extractedSqls: ExtractedSql[],
    tables: TableDefinition[],
    hardFks: ForeignKeyDefinition[]
  ): ForeignKeyDefinition[] {
    const implicitJoins: ForeignKeyDefinition[] = [];
    const knownTableNames = new Set(tables.map((t) => t.name.toLowerCase()));

    for (const item of extractedSqls) {
      if (item.type !== 'SELECT') continue;

      try {
        const astResult = this.parser.astify(item.query, { database: 'mysql' });
        const asts = Array.isArray(astResult) ? astResult : [astResult];

        for (const ast of asts) {
          if (!ast || ast.type !== 'select') continue;

          // Map aliases -> real table names
          const aliasMap = new Map<string, string>();
          if (Array.isArray(ast.from)) {
            for (const f of ast.from as any[]) {
              if (f && f.table) {
                const realTable = f.table;
                const alias = f.as || realTable;
                aliasMap.set(alias.toLowerCase(), realTable);
                aliasMap.set(realTable.toLowerCase(), realTable);
              }
            }
          }

          // Check WHERE conditions for implicit joins: u.id = o.user_id or WHERE table_a.x = table_b.y
          if (ast.where) {
            this.findJoinsInExpr(ast.where, aliasMap, knownTableNames, hardFks, implicitJoins);
          }

          // Check explicit JOIN ON conditions without hard FKs
          if (Array.isArray(ast.from)) {
            for (const f of ast.from as any[]) {
              if (f && f.on) {
                this.findJoinsInExpr(f.on, aliasMap, knownTableNames, hardFks, implicitJoins);
              }
            }
          }
        }
      } catch {
        // SQL parse error (e.g. dynamic template strings or partial fragments) - safely ignore
      }
    }

    // Deduplicate implicit joins
    const uniqueJoins: ForeignKeyDefinition[] = [];
    const seen = new Set<string>();
    for (const j of implicitJoins) {
      const key = `${j.fromTable}.${j.fromColumn}->${j.toTable}.${j.toColumn}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueJoins.push(j);
      }
    }

    return uniqueJoins;
  }

  /**
   * Traverse WHERE / ON AST expression to locate column comparisons between distinct tables
   */
  private findJoinsInExpr(
    expr: any,
    aliasMap: Map<string, string>,
    knownTableNames: Set<string>,
    hardFks: ForeignKeyDefinition[],
    results: ForeignKeyDefinition[]
  ) {
    if (!expr) return;

    if (expr.type === 'binary_expr') {
      if (expr.operator === '=') {
        const left = expr.left;
        const right = expr.right;

        if (
          left &&
          right &&
          left.type === 'column_ref' &&
          right.type === 'column_ref' &&
          left.table &&
          right.table
        ) {
          const leftTable = aliasMap.get(left.table.toLowerCase()) || left.table;
          const rightTable = aliasMap.get(right.table.toLowerCase()) || right.table;

          if (leftTable.toLowerCase() !== rightTable.toLowerCase()) {
            // Found a join between two distinct tables!
            // Check if this join already exists as a Hard Foreign Key
            const isHardFk = hardFks.some(
              (fk) =>
                (fk.fromTable.toLowerCase() === leftTable.toLowerCase() &&
                  fk.toTable.toLowerCase() === rightTable.toLowerCase() &&
                  fk.fromColumn.toLowerCase() === left.column.toLowerCase() &&
                  fk.toColumn.toLowerCase() === right.column.toLowerCase()) ||
                (fk.fromTable.toLowerCase() === rightTable.toLowerCase() &&
                  fk.toTable.toLowerCase() === leftTable.toLowerCase() &&
                  fk.fromColumn.toLowerCase() === right.column.toLowerCase() &&
                  fk.toColumn.toLowerCase() === left.column.toLowerCase())
            );

            if (!isHardFk) {
              // Determine direction: usually column ending with '_id' is fromTable
              let fromT = leftTable;
              let fromC = left.column;
              let toT = rightTable;
              let toC = right.column;

              if (right.column.toLowerCase().endsWith('_id') && !left.column.toLowerCase().endsWith('_id')) {
                fromT = rightTable;
                fromC = right.column;
                toT = leftTable;
                toC = left.column;
              }

              results.push({
                fromTable: fromT,
                fromColumn: fromC,
                toTable: toT,
                toColumn: toC,
                isImplicit: true,
                source: 'IMPLICIT_SQL',
              });
            }
          }
        }
      }

      this.findJoinsInExpr(expr.left, aliasMap, knownTableNames, hardFks, results);
      this.findJoinsInExpr(expr.right, aliasMap, knownTableNames, hardFks, results);
    }
  }

  /**
   * Parse local DDL / SQL files if MySQL is offline or not configured
   */
  private async parseSqlMigrationFiles(): Promise<TableDefinition[]> {
    const sqlFiles = await fg(['**/*.sql', '**/migrations/*.sql'], {
      cwd: config.paths.projectRoot,
      ignore: ['**/node_modules/**', '**/dist/**'],
      absolute: true,
    });

    const tables: TableDefinition[] = [];

    for (const sqlFile of sqlFiles) {
      try {
        const content = fs.readFileSync(sqlFile, 'utf-8');
        // Simple regex-based DDL scanner for CREATE TABLE statements
        const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s*\(([\s\S]*?)\);/gi;
        let match;

        while ((match = createTableRegex.exec(content)) !== null) {
          const tableName = match[1];
          const body = match[2];

          const columns: ColumnDefinition[] = [];
          const indexes: IndexDefinition[] = [];
          const foreignKeys: ForeignKeyDefinition[] = [];

          const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

          for (const line of lines) {
            // Check for Primary Key constraint
            if (/PRIMARY\s+KEY/i.test(line)) {
              const pkMatch = line.match(/PRIMARY\s+KEY\s*\(`?([a-zA-Z0-9_]+)`?\)/i);
              if (pkMatch) {
                const col = columns.find((c) => c.name === pkMatch[1]);
                if (col) col.isPrimaryKey = true;
              }
              continue;
            }

            // Check for Foreign Key constraint
            if (/FOREIGN\s+KEY/i.test(line)) {
              const fkMatch = line.match(
                /FOREIGN\s+KEY\s*\(`?([a-zA-Z0-9_]+)`?\)\s*REFERENCES\s*`?([a-zA-Z0-9_]+)`?\s*\(`?([a-zA-Z0-9_]+)`?\)/i
              );
              if (fkMatch) {
                foreignKeys.push({
                  fromTable: tableName,
                  fromColumn: fkMatch[1],
                  toTable: fkMatch[2],
                  toColumn: fkMatch[3],
                  isImplicit: false,
                  source: 'HARD_FK',
                });
              }
              continue;
            }

            // Check for Column definition: `id` INT AUTO_INCREMENT NOT NULL ...
            const colMatch = line.match(/^`?([a-zA-Z0-9_]+)`?\s+([a-zA-Z0-9_]+(?:\([0-9, ]+\))?)(.*)/i);
            if (colMatch) {
              const colName = colMatch[1];
              const colType = colMatch[2];
              const rest = colMatch[3];

              columns.push({
                name: colName,
                type: colType,
                nullable: !/NOT\s+NULL/i.test(rest),
                isPrimaryKey: /PRIMARY\s+KEY/i.test(rest),
                isForeignKey: false,
                defaultValue: null,
                extra: /AUTO_INCREMENT/i.test(rest) ? 'auto_increment' : '',
                comment: '',
              });
            }
          }

          tables.push({
            name: tableName,
            columns,
            indexes,
            foreignKeys,
          });
        }
      } catch {
        // Ignore unparseable SQL files
      }
    }

    return tables;
  }

  /**
   * Parse Moodle 4.1 XMLDB install.xml schema files
   */
  private async parseMoodleXmlDbFiles(): Promise<TableDefinition[]> {
    const xmlFiles = await fg(['**/db/install.xml', '**/install.xml'], {
      cwd: config.paths.projectRoot,
      ignore: ['**/node_modules/**', '**/dist/**'],
      absolute: true,
    });

    const tables: TableDefinition[] = [];

    for (const xmlFile of xmlFiles) {
      try {
        const content = fs.readFileSync(xmlFile, 'utf-8');
        const tableMatches = content.match(/<TABLE\s+NAME="([^"]+)"[\s\S]*?<\/TABLE>/gi) || [];

        for (const tblXml of tableMatches) {
          const nameMatch = tblXml.match(/<TABLE\s+NAME="([^"]+)"/i);
          if (!nameMatch) continue;

          const tableName = nameMatch[1].startsWith('mdl_') ? nameMatch[1] : `mdl_${nameMatch[1]}`;
          const columns: ColumnDefinition[] = [];
          const foreignKeys: ForeignKeyDefinition[] = [];

          // Fields
          const fieldMatches = tblXml.match(/<FIELD\s+NAME="([^"]+)"\s+TYPE="([^"]+)"[^>]*\/>/gi) || [];
          for (const f of fieldMatches) {
            const fName = f.match(/NAME="([^"]+)"/i)?.[1] || '';
            const fType = f.match(/TYPE="([^"]+)"/i)?.[1] || 'text';
            const notNull = /NOTNULL="true"/i.test(f);

            columns.push({
              name: fName,
              type: fType.toUpperCase(),
              nullable: !notNull,
              isPrimaryKey: fName.toLowerCase() === 'id',
              isForeignKey: fName.endsWith('id') && fName !== 'id',
              defaultValue: null,
              extra: fName === 'id' ? 'auto_increment' : '',
              comment: '',
            });
          }

          // Foreign Keys
          const keyMatches = tblXml.match(/<KEY\s+NAME="([^"]+)"\s+TYPE="foreign"\s+FIELDS="([^"]+)"\s+REFTABLE="([^"]+)"\s+REFFIELDS="([^"]+)"/gi) || [];
          for (const k of keyMatches) {
            const fromCol = k.match(/FIELDS="([^"]+)"/i)?.[1] || '';
            const toTbl = k.match(/REFTABLE="([^"]+)"/i)?.[1] || '';
            const toCol = k.match(/REFFIELDS="([^"]+)"/i)?.[1] || 'id';

            foreignKeys.push({
              constraintName: k.match(/NAME="([^"]+)"/i)?.[1],
              fromTable: tableName,
              fromColumn: fromCol,
              toTable: toTbl.startsWith('mdl_') ? toTbl : `mdl_${toTbl}`,
              toColumn: toCol,
              isImplicit: false,
              source: 'HARD_FK',
            });
          }

          tables.push({
            name: tableName,
            columns,
            indexes: [],
            foreignKeys,
          });
        }
      } catch {
        // Safe skip
      }
    }

    return tables;
  }

  /**
   * Canonical Moodle 4.1 LMS Core Database Schema
   */
  public getMoodle41DefaultSchema(): TableDefinition[] {
    return [
      {
        name: 'mdl_course',
        comment: 'Central course records in Moodle 4.1',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'category', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'fullname', type: 'VARCHAR(254)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'shortname', type: 'VARCHAR(100)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'summary', type: 'MEDIUMTEXT', nullable: true, isPrimaryKey: false, isForeignKey: false, defaultValue: null, extra: '', comment: '' },
          { name: 'format', type: 'VARCHAR(21)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: 'topics', extra: '', comment: '' },
          { name: 'startdate', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'enddate', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'visible', type: 'TINYINT(1)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '1', extra: '', comment: '' }
        ],
        indexes: [
          { name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' },
          { name: 'idx_shortname', columns: ['shortname'], isUnique: false, type: 'BTREE' }
        ],
        foreignKeys: []
      },
      {
        name: 'mdl_user',
        comment: 'User accounts and profiles in Moodle 4.1',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'auth', type: 'VARCHAR(20)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: 'manual', extra: '', comment: '' },
          { name: 'suspended', type: 'TINYINT(1)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'username', type: 'VARCHAR(100)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'password', type: 'VARCHAR(255)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'firstname', type: 'VARCHAR(100)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'lastname', type: 'VARCHAR(100)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'email', type: 'VARCHAR(100)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'lang', type: 'VARCHAR(30)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: 'vi', extra: '', comment: '' }
        ],
        indexes: [
          { name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' },
          { name: 'idx_username', columns: ['username'], isUnique: true, type: 'BTREE' },
          { name: 'idx_email', columns: ['email'], isUnique: false, type: 'BTREE' }
        ],
        foreignKeys: []
      },
      {
        name: 'mdl_course_modules',
        comment: 'Activities and resources instantiated in courses',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'course', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'module', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'instance', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'section', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'visible', type: 'TINYINT(1)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '1', extra: '', comment: '' }
        ],
        indexes: [{ name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' }],
        foreignKeys: [
          { fromTable: 'mdl_course_modules', fromColumn: 'course', toTable: 'mdl_course', toColumn: 'id', isImplicit: false, source: 'HARD_FK' }
        ]
      },
      {
        name: 'mdl_quiz',
        comment: 'Quiz activities definition',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'course', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'name', type: 'VARCHAR(255)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'timeopen', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'timeclose', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'timelimit', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'attempts', type: 'MEDIUMINT(6)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'grademethod', type: 'SMALLINT(4)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '1', extra: '', comment: '' },
          { name: 'sumgrades', type: 'DECIMAL(10,5)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0.00000', extra: '', comment: '' }
        ],
        indexes: [{ name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' }],
        foreignKeys: [
          { fromTable: 'mdl_quiz', fromColumn: 'course', toTable: 'mdl_course', toColumn: 'id', isImplicit: false, source: 'HARD_FK' }
        ]
      },
      {
        name: 'mdl_quiz_attempts',
        comment: 'Individual student quiz attempts and states',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'quiz', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'userid', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'attempt', type: 'MEDIUMINT(6)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'state', type: 'VARCHAR(16)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: 'inprogress', extra: '', comment: '' },
          { name: 'timestart', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'timefinish', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'sumgrades', type: 'DECIMAL(10,5)', nullable: true, isPrimaryKey: false, isForeignKey: false, defaultValue: null, extra: '', comment: '' }
        ],
        indexes: [
          { name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' },
          { name: 'idx_quiz_user', columns: ['quiz', 'userid'], isUnique: false, type: 'BTREE' }
        ],
        foreignKeys: [
          { fromTable: 'mdl_quiz_attempts', fromColumn: 'quiz', toTable: 'mdl_quiz', toColumn: 'id', isImplicit: false, source: 'HARD_FK' },
          { fromTable: 'mdl_quiz_attempts', fromColumn: 'userid', toTable: 'mdl_user', toColumn: 'id', isImplicit: false, source: 'HARD_FK' }
        ]
      },
      {
        name: 'mdl_enrol',
        comment: 'Course enrolment instances',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'enrol', type: 'VARCHAR(20)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'status', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'courseid', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' }
        ],
        indexes: [{ name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' }],
        foreignKeys: [
          { fromTable: 'mdl_enrol', fromColumn: 'courseid', toTable: 'mdl_course', toColumn: 'id', isImplicit: false, source: 'HARD_FK' }
        ]
      },
      {
        name: 'mdl_user_enrolments',
        comment: 'User enrollments into specific enrol plugins',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'status', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '0', extra: '', comment: '' },
          { name: 'enrolid', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'userid', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' }
        ],
        indexes: [{ name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' }],
        foreignKeys: [
          { fromTable: 'mdl_user_enrolments', fromColumn: 'enrolid', toTable: 'mdl_enrol', toColumn: 'id', isImplicit: false, source: 'HARD_FK' },
          { fromTable: 'mdl_user_enrolments', fromColumn: 'userid', toTable: 'mdl_user', toColumn: 'id', isImplicit: false, source: 'HARD_FK' }
        ]
      },
      {
        name: 'mdl_grade_items',
        comment: 'Grade items in Moodle Gradebook',
        columns: [
          { name: 'id', type: 'BIGINT(10)', nullable: false, isPrimaryKey: true, isForeignKey: false, defaultValue: null, extra: 'auto_increment', comment: '' },
          { name: 'courseid', type: 'BIGINT(10)', nullable: false, isPrimaryKey: false, isForeignKey: true, defaultValue: '0', extra: '', comment: '' },
          { name: 'itemname', type: 'VARCHAR(255)', nullable: true, isPrimaryKey: false, isForeignKey: false, defaultValue: null, extra: '', comment: '' },
          { name: 'itemtype', type: 'VARCHAR(30)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '', extra: '', comment: '' },
          { name: 'itemmodule', type: 'VARCHAR(30)', nullable: true, isPrimaryKey: false, isForeignKey: false, defaultValue: null, extra: '', comment: '' },
          { name: 'grademax', type: 'DECIMAL(10,5)', nullable: false, isPrimaryKey: false, isForeignKey: false, defaultValue: '100.00000', extra: '', comment: '' }
        ],
        indexes: [{ name: 'PRIMARY', columns: ['id'], isUnique: true, type: 'BTREE' }],
        foreignKeys: [
          { fromTable: 'mdl_grade_items', fromColumn: 'courseid', toTable: 'mdl_course', toColumn: 'id', isImplicit: false, source: 'HARD_FK' }
        ]
      }
    ];
  }

  private buildSummary(
    tables: TableDefinition[],
    hardFks: ForeignKeyDefinition[],
    implicitJoins: ForeignKeyDefinition[],
    isConnected: boolean,
    dbName?: string
  ): string {
    const totalCols = tables.reduce((acc, t) => acc + t.columns.length, 0);
    return (
      `Database Schema Overview:\n` +
      `- Source: ${isConnected ? `Live MySQL (${dbName})` : 'Offline / SQL DDL Files'}\n` +
      `- Tables: ${tables.length} tables, ${totalCols} columns.\n` +
      `- Foreign Keys: ${hardFks.length} Hard constraints, ${implicitJoins.length} Implicit JOIN links detected from code.`
    );
  }
}
