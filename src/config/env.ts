import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env file
dotenv.config();

export interface AppConfig {
  gemini: {
    apiKey: string;
    model: string;
  };
  server: {
    port: number;
    env: string;
  };
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  paths: {
    projectRoot: string;
    outputDir: string;
    templatesDir: string;
    skillsDir: string;
  };
  kroki: {
    url: string;
  };
  readOnlyProjectRoot: boolean;
}

function resolveProjectRoot(input?: string): string {
  if (!input || input.trim() === '' || input === '.') {
    return process.cwd();
  }

  let raw = input.trim();
  // Normalize potential missing leading slash for linux system paths
  if (!path.isAbsolute(raw) && (raw.startsWith('var/www') || raw.startsWith('home/'))) {
    raw = '/' + raw;
  }

  if (fs.existsSync(raw)) {
    return path.resolve(raw);
  }

  // Common shorthand fallback: /var/www/tnu -> /var/www/html/tnu
  if (raw === '/var/www/tnu' || raw === 'var/www/tnu') {
    if (fs.existsSync('/var/www/html/tnu')) {
      return '/var/www/html/tnu';
    }
  }

  return path.resolve(process.cwd(), raw);
}

const projectRoot = resolveProjectRoot(process.env.PROJECT_ROOT);

export const config: AppConfig = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
  },
  paths: {
    projectRoot,
    outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR || './output'),
    templatesDir: path.resolve(process.cwd(), process.env.TEMPLATES_DIR || './templates'),
    skillsDir: path.resolve(process.cwd(), process.env.SKILLS_DIR || './skills'),
  },
  kroki: {
    url: process.env.KROKI_URL || 'https://kroki.io/mermaid/png',
  },
  readOnlyProjectRoot: process.env.READ_ONLY_PROJECT_ROOT !== 'false',
};

export default config;

