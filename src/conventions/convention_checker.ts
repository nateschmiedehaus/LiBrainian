import * as path from 'node:path';
import type {
  ConventionCategory,
  ConventionRecord,
  ConventionRuleType,
} from '../storage/types.js';

export interface ConventionViolation {
  conventionId: string;
  name: string;
  category: ConventionCategory;
  ruleType: ConventionRuleType;
  filePath: string;
  message: string;
  confidence: number;
  recommendation?: string;
}

export function evaluateConventionsForFile(
  filePath: string,
  content: string,
  conventions: ConventionRecord[]
): ConventionViolation[] {
  const normalizedPath = normalizePosix(filePath);
  const imports = new Set(
    extractImports(content).map((spec) => normalizeImportPath(normalizedPath, spec)).filter((entry): entry is string => Boolean(entry))
  );
  const violations: ConventionViolation[] = [];

  for (const convention of conventions) {
    if (!appliesToPath(convention, normalizedPath)) continue;
    const violation = evaluateAgainstPattern(convention, normalizedPath, imports, content);
    if (violation) {
      violations.push(violation);
    }
  }

  return violations;
}

function evaluateAgainstPattern(
  convention: ConventionRecord,
  filePath: string,
  imports: Set<string>,
  content: string
): ConventionViolation | null {
  switch (convention.pattern.kind) {
    case 'import_presence': {
      if (!imports.has(convention.pattern.importPath)) {
        return buildViolation(convention, filePath, `Missing required import ${convention.pattern.importPath}`, 'Import the shared module before using this file.');
      }
      return null;
    }
    case 'middleware_chain': {
      const missing = convention.pattern.importPaths.filter((importPath) => !imports.has(importPath));
      if (missing.length > 0) {
        return buildViolation(convention, filePath, `Missing middleware imports: ${missing.join(', ')}`, 'Add the shared middleware imports to keep the handler consistent.');
      }
      return null;
    }
    case 'naming_style': {
      if (convention.pattern.appliesTo === 'file') {
        const name = path.posix.basename(filePath).replace(/\.[^.]+$/, '');
        const style = inferNameStyle(name);
        if (style !== convention.pattern.style) {
          return buildViolation(
            convention,
            filePath,
            `File name uses ${style}; expected ${convention.pattern.style}`,
            `Rename the file to follow ${convention.pattern.style} (e.g., ${exampleName(convention.pattern.style)})`
          );
        }
      }
      return null;
    }
    case 'file_structure': {
      if (!filePath.includes('__tests__/')) return null;
      const suffix = extractTestSuffix(filePath);
      if (convention.pattern.testSuffix && suffix !== convention.pattern.testSuffix) {
        return buildViolation(
          convention,
          filePath,
          `Test suffix ${suffix} does not match ${convention.pattern.testSuffix}`,
          `Rename the test to end with ${convention.pattern.testSuffix}`
        );
      }
      return null;
    }
    case 'dependency_direction': {
      const targetPrefix = `src/${convention.pattern.toLayer}`;
      if (importsHasPrefix(imports, targetPrefix)) {
        return buildViolation(
          convention,
          filePath,
          `Imports from forbidden layer ${convention.pattern.toLayer}`,
          `Refactor to avoid importing ${convention.pattern.toLayer} from ${convention.pattern.fromLayer}`
        );
      }
      return null;
    }
    default:
      return null;
  }
}

function appliesToPath(convention: ConventionRecord, filePath: string): boolean {
  const pattern = convention.pattern;
  if ('directories' in pattern && Array.isArray(pattern.directories) && pattern.directories.length > 0) {
    return pattern.directories.some((dir) => filePath.startsWith(normalizeDir(dir)));
  }
  if (pattern.kind === 'dependency_direction') {
    return filePath.startsWith(`src/${pattern.fromLayer}`);
  }
  if (pattern.kind === 'document_rule') {
    return filePath.endsWith(pattern.sourceFile);
  }
  return true;
}

function importsHasPrefix(imports: Set<string>, prefix: string): boolean {
  for (const spec of imports) {
    if (!spec) continue;
    if (normalizeDir(spec).startsWith(normalizeDir(prefix))) {
      return true;
    }
  }
  return false;
}

function buildViolation(
  convention: ConventionRecord,
  filePath: string,
  message: string,
  recommendation?: string
): ConventionViolation {
  return {
    conventionId: convention.id,
    name: convention.name,
    category: convention.category,
    ruleType: convention.ruleType,
    filePath,
    message,
    confidence: convention.confidence,
    recommendation,
  };
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  const importRegex = /import\s+(?:[\s\S]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  while ((match = requireRegex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  return Array.from(imports);
}

function normalizeImportPath(filePath: string, specifier: string): string | null {
  const normalizedSpecifier = normalizePosix(specifier);
  if (normalizedSpecifier.startsWith('.')) {
    const sourceDir = path.posix.dirname(filePath);
    return path.posix.normalize(path.posix.join(sourceDir, normalizedSpecifier));
  }
  if (normalizedSpecifier.startsWith('src/')) {
    return path.posix.normalize(normalizedSpecifier);
  }
  return null;
}

function normalizePosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function normalizeDir(value: string): string {
  const normalized = normalizePosix(value);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function inferNameStyle(name: string): 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case' {
  if (name.includes('-')) return 'kebab-case';
  if (name.includes('_')) return 'snake_case';
  if (name[0] === name[0]?.toUpperCase()) return 'PascalCase';
  return 'camelCase';
}

function exampleName(style: 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case'): string {
  switch (style) {
    case 'PascalCase':
      return 'ExampleComponent.ts';
    case 'snake_case':
      return 'example_component.ts';
    case 'kebab-case':
      return 'example-component.ts';
    default:
      return 'exampleComponent.ts';
  }
}

function extractTestSuffix(relativePath: string): string {
  const base = path.posix.basename(relativePath);
  const match = base.match(/(\.test\.[^.]+|\.spec\.[^.]+|_test\.[^.]+)$/i);
  return match ? match[1] : path.extname(base) || '.test.ts';
}
