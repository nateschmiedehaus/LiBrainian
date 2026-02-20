import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';
import YAML from 'yaml';
import { getErrorMessage } from '../utils/errors.js';
import type { TaxonomyItem } from '../api/taxonomy.js';
import type { IngestionContext, IngestionItem, IngestionResult, IngestionSource } from './types.js';
import { loadCodeqlFindings, type CodeqlScan } from '../connectors/codeql_adapter.js';
import { loadJoernFindings, type JoernScan } from '../connectors/joern_adapter.js';
import { emptyArray } from '../api/empty_values.js';
import { safeJsonParse, getResultErrorMessage } from '../utils/safe_json.js';

export interface EslintSecuritySummary {
  path: string;
  plugins: string[];
  extends: string[];
  securityRules: string[];
  parsed: boolean;
}

export interface TsconfigSecuritySummary {
  path: string;
  strict: boolean | null;
  noImplicitAny?: boolean;
  strictNullChecks?: boolean;
  noImplicitReturns?: boolean;
  exactOptionalPropertyTypes?: boolean;
  useUnknownInCatchVariables?: boolean;
}

export interface SecurityIngestionOptions {
  eslintGlobs?: string[];
  tsconfigGlobs?: string[];
  exclude?: string[];
  maxFileBytes?: number;
}

const DEFAULT_ESLINT_GLOBS = [
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.cjs',
  '.eslintrc.js',
  'eslint.config.js',
];
const DEFAULT_TSCONFIG_GLOBS = ['tsconfig.json', 'tsconfig.*.json'];
const DEFAULT_MAX_BYTES = 256_000;
const SECURITY_TAXONOMY: TaxonomyItem[] = [
  'security_boundaries',
  'secret_handling_rules',
  'pii_classification',
  'lint_rules_exceptions',
];

const SECURITY_RULE_PATTERNS = [
  /^security\//,
  /^no-eval$/,
  /^no-implied-eval$/,
  /^no-new-func$/,
  /^no-unsafe-/,
  /^detect-/i,
  /^no-secrets?/i,
];

function hashPayload(payload: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  } catch {
    return createHash('sha256').update('{}').digest('hex');
  }
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string') return [value];
  return emptyArray<string>();
}

function extractSecurityRules(rules: Record<string, unknown> | null): string[] {
  if (!rules) return emptyArray<string>();
  return Object.keys(rules).filter((rule) => SECURITY_RULE_PATTERNS.some((pattern) => pattern.test(rule)));
}

function parseEslintConfig(content: string, ext: string): { plugins: string[]; extends: string[]; rules: string[]; parsed: boolean } {
  if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '') {
    const parsed = ext === '.json' || ext === ''
      ? (() => {
          const result = safeJsonParse<Record<string, unknown>>(content);
          if (!result.ok) throw new Error(getResultErrorMessage(result) || 'invalid JSON');
          return result.value;
        })()
      : YAML.parse(content) as Record<string, unknown>;
    const plugins = coerceStringArray(parsed.plugins);
    const extendsList = coerceStringArray(parsed.extends);
    const rules = extractSecurityRules((parsed.rules && typeof parsed.rules === 'object') ? parsed.rules as Record<string, unknown> : null);
    return { plugins, extends: extendsList, rules, parsed: true };
  }
  const plugins = content.includes('security') ? ['security'] : [];
  const rules = Array.from(content.matchAll(/['"]([^'"]+)['"]\s*:/g)).map((match) => match[1] ?? '').filter((rule) => SECURITY_RULE_PATTERNS.some((pattern) => pattern.test(rule)));
  return { plugins, extends: [], rules: Array.from(new Set(rules)), parsed: false };
}

function parseTsconfig(content: string): { strict: boolean | null; options: Record<string, unknown> } {
  const parsedResult = safeJsonParse<Record<string, unknown>>(content);
  if (!parsedResult.ok) {
    throw new Error(getResultErrorMessage(parsedResult) || 'invalid JSON');
  }
  const parsed = parsedResult.value;
  const compilerOptions = parsed.compilerOptions && typeof parsed.compilerOptions === 'object'
    ? parsed.compilerOptions as Record<string, unknown>
    : {};
  const strict = typeof compilerOptions.strict === 'boolean' ? compilerOptions.strict : null;
  return { strict, options: compilerOptions };
}

export function createSecurityIngestionSource(options: SecurityIngestionOptions = {}): IngestionSource {
  const eslintGlobs = options.eslintGlobs ?? DEFAULT_ESLINT_GLOBS;
  const tsconfigGlobs = options.tsconfigGlobs ?? DEFAULT_TSCONFIG_GLOBS;
  const exclude = options.exclude ?? [];
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;

  return {
    type: 'security',
    version: 'v1',
    validate: (data: unknown) => {
      if (!data || typeof data !== 'object') return false;
      const item = data as { payload?: { eslint?: unknown; tsconfig?: unknown } };
      return Boolean(item.payload?.eslint) && Boolean(item.payload?.tsconfig);
    },
    ingest: async (ctx: IngestionContext): Promise<IngestionResult> => {
      const items: IngestionItem[] = [];
      const errors: string[] = [];

      const eslintFiles = await glob(eslintGlobs, { cwd: ctx.workspace, ignore: exclude, absolute: true, dot: true });
      const eslintSummaries: EslintSecuritySummary[] = [];
      for (const filePath of eslintFiles) {
        let content = '';
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxFileBytes) continue;
          content = await fs.readFile(filePath, 'utf8');
        } catch (error: unknown) {
          errors.push(`Failed to read ${filePath}: ${getErrorMessage(error)}`);
          continue;
        }
        try {
          const ext = path.extname(filePath).toLowerCase();
          const parsed = parseEslintConfig(content, ext);
          eslintSummaries.push({
            path: path.relative(ctx.workspace, filePath),
            plugins: parsed.plugins,
            extends: parsed.extends,
            securityRules: parsed.rules,
            parsed: parsed.parsed,
          });
        } catch (error: unknown) {
          errors.push(`Failed to parse ${filePath}: ${getErrorMessage(error)}`);
        }
      }

      const tsconfigFiles = await glob(tsconfigGlobs, { cwd: ctx.workspace, ignore: exclude, absolute: true });
      const tsconfigs: TsconfigSecuritySummary[] = [];
      for (const filePath of tsconfigFiles) {
        let content = '';
        try {
          const stats = await fs.stat(filePath);
          if (stats.size > maxFileBytes) continue;
          content = await fs.readFile(filePath, 'utf8');
        } catch (error: unknown) {
          errors.push(`Failed to read ${filePath}: ${getErrorMessage(error)}`);
          continue;
        }
	        try {
	          const parsed = parseTsconfig(content);
	          const options = parsed.options;
	          const summary: TsconfigSecuritySummary = {
	            path: path.relative(ctx.workspace, filePath),
	            strict: parsed.strict,
	          };
	          if (typeof options.noImplicitAny === 'boolean') summary.noImplicitAny = options.noImplicitAny;
	          if (typeof options.strictNullChecks === 'boolean') summary.strictNullChecks = options.strictNullChecks;
	          if (typeof options.noImplicitReturns === 'boolean') summary.noImplicitReturns = options.noImplicitReturns;
	          if (typeof options.exactOptionalPropertyTypes === 'boolean') summary.exactOptionalPropertyTypes = options.exactOptionalPropertyTypes;
	          if (typeof options.useUnknownInCatchVariables === 'boolean') summary.useUnknownInCatchVariables = options.useUnknownInCatchVariables;
	          tsconfigs.push(summary);
	        } catch (error: unknown) {
	          errors.push(`Failed to parse ${filePath}: ${getErrorMessage(error)}`);
	        }
	      }

      let codeql: CodeqlScan | null = null;
      let joern: JoernScan | null = null;
      try {
        codeql = await loadCodeqlFindings(ctx.workspace, { maxFileBytes });
      } catch (error: unknown) {
        errors.push(`Failed to load CodeQL findings: ${getErrorMessage(error)}`);
      }
      try {
        joern = await loadJoernFindings(ctx.workspace, { maxFileBytes });
      } catch (error: unknown) {
        errors.push(`Failed to load Joern findings: ${getErrorMessage(error)}`);
      }

      const payload = {
        eslint: eslintSummaries,
        tsconfig: tsconfigs,
        codeql,
        joern,
      };

      items.push({
        id: 'security:knowledge',
        sourceType: 'security',
        sourceVersion: 'v1',
        ingestedAt: ctx.now(),
        payload,
        metadata: {
          hash: hashPayload(payload),
          taxonomy: SECURITY_TAXONOMY,
          eslint_files: eslintSummaries.length,
          tsconfig_files: tsconfigs.length,
          codeql_findings: codeql?.findings.length ?? 0,
          joern_findings: joern?.findings.length ?? 0,
        },
      });

      return { items, errors };
    },
  };
}
