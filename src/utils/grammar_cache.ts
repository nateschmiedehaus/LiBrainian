import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

function tryFindPackageRoot(startDir: string): string | null {
  let current = startDir;
  for (let i = 0; i < 15; i += 1) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export function getLibrarianPackageRoot(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return tryFindPackageRoot(here);
}

export function getGrammarCacheRoot(): string {
  const env = String(process.env.LIBRARIAN_GRAMMAR_CACHE_DIR ?? '').trim();
  if (env.length > 0) return path.resolve(env);
  return path.join(os.homedir(), '.librarian', 'grammars');
}

export function getGrammarRequirePaths(): string[] {
  // Node's module resolution treats each entry as a folder that may contain `node_modules/`.
  // We install with `npm --prefix <cacheRoot>`, so `<cacheRoot>/node_modules` is used.
  return [getGrammarCacheRoot()];
}

