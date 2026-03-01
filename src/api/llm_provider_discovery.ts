import { execa } from 'execa';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CLI_BINARY_HASHES } from './cli_hash_manifest.js';

export type LlmAuthMethod = 'cli_login' | 'local' | 'oauth' | 'none' | 'api_key';
export type LibrarianLlmProvider = 'claude' | 'codex';

export interface LlmProviderDescriptor {
  id: string;
  name: string;
  authMethod: LlmAuthMethod;
  defaultModel: string;
  priority: number;
  supportsEmbeddings: boolean;
  supportsChat: boolean;
}

export interface LlmProviderProbeResult {
  available: boolean;
  authenticated: boolean;
  error?: string;
  availableModels?: string[];
  // Metadata must never include secrets; sanitized in discovery.
  metadata?: Record<string, unknown>;
}

export interface LlmProviderProbe {
  descriptor: LlmProviderDescriptor;
  probe(): Promise<LlmProviderProbeResult>;
  envVars: string[];
}

export interface DiscoveredProvider {
  provider: string;
  modelId: string;
  descriptor: LlmProviderDescriptor;
  status: LlmProviderProbeResult;
}

function hasTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

function resolveHostPreferredProvider(env: NodeJS.ProcessEnv = process.env): LibrarianLlmProvider | null {
  const explicit = env.LIBRARIAN_LLM_PROVIDER;
  if (explicit === 'claude' || explicit === 'codex') {
    return explicit;
  }

  const nestedClaudeSession =
    hasTruthyEnvValue(env.CLAUDE_CODE_ENTRYPOINT)
    || hasTruthyEnvValue(env.CLAUDE_SESSION)
    || hasTruthyEnvValue(env.CLAUDECODE);
  if (nestedClaudeSession) {
    const claudeApiConfigured = hasTruthyEnvValue(env.ANTHROPIC_API_KEY);
    const claudeBrokerConfigured =
      hasTruthyEnvValue(env.LIBRARIAN_CLAUDE_BROKER_URL)
      || hasTruthyEnvValue(env.LIBRARIAN_LLM_CLAUDE_BROKER_URL)
      || hasTruthyEnvValue(env.CLAUDE_BROKER_URL);
    if (claudeApiConfigured || claudeBrokerConfigured) {
      return 'claude';
    }
    // Without API/broker transport, Claude CLI cannot reliably spawn from nested Claude Code sessions.
    return 'codex';
  }

  const codexHostHints =
    hasTruthyEnvValue(env.CODEX_HOME)
    || hasTruthyEnvValue(env.CODEX_PROFILE)
    || hasTruthyEnvValue(env.CODEX_MODEL);
  if (codexHostHints) {
    return 'codex';
  }

  return null;
}

const SENSITIVE_METADATA_PATTERN = /(token|secret|password|key|auth|cookie|private_key|session|signature|access|refresh|client_secret|sas)/i;
const SENSITIVE_METADATA_VALUE_PATTERN =
  /(sk-[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9\-_.=]+|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIzaSy[A-Za-z0-9_-]{10,}|-----BEGIN\s+.*PRIVATE\s+KEY-----|sig=[A-Za-z0-9%/_-]{16,})/i;
const UNICODE_DASH_PATTERN = /[\u2010-\u2015\u2212]/g;
const COMBINING_MARK_PATTERN = /\p{M}/u;
const COMBINING_MARKS_PATTERN = /\p{M}/gu;
const CONFUSABLE_SKELETON_MAP = new Map<string, string>([
  ['\u017F', 's'],
  ['\u0391', 'A'],
  ['\u0392', 'B'],
  ['\u0395', 'E'],
  ['\u0396', 'Z'],
  ['\u0397', 'H'],
  ['\u0399', 'I'],
  ['\u039A', 'K'],
  ['\u039C', 'M'],
  ['\u039D', 'N'],
  ['\u039F', 'O'],
  ['\u03A1', 'P'],
  ['\u03A4', 'T'],
  ['\u03A5', 'Y'],
  ['\u03A7', 'X'],
  ['\u03B1', 'a'],
  ['\u03B2', 'b'],
  ['\u03B5', 'e'],
  ['\u03B6', 'z'],
  ['\u03B7', 'h'],
  ['\u03B9', 'i'],
  ['\u03BA', 'k'],
  ['\u03BC', 'm'],
  ['\u03BD', 'n'],
  ['\u03BF', 'o'],
  ['\u03C1', 'p'],
  ['\u03C4', 't'],
  ['\u03C5', 'y'],
  ['\u03C7', 'x'],
  ['\u0410', 'A'],
  ['\u0412', 'B'],
  ['\u0421', 'C'],
  ['\u0415', 'E'],
  ['\u041D', 'H'],
  ['\u0406', 'I'],
  ['\u0408', 'J'],
  ['\u041A', 'K'],
  ['\u041C', 'M'],
  ['\u041E', 'O'],
  ['\u0420', 'P'],
  ['\u0405', 'S'],
  ['\u0422', 'T'],
  ['\u0425', 'X'],
  ['\u0423', 'Y'],
  ['\u0430', 'a'],
  ['\u0432', 'b'],
  ['\u0441', 'c'],
  ['\u0435', 'e'],
  ['\u043D', 'h'],
  ['\u0456', 'i'],
  ['\u0458', 'j'],
  ['\u043A', 'k'],
  ['\u043C', 'm'],
  ['\u043E', 'o'],
  ['\u0440', 'p'],
  ['\u0455', 's'],
  ['\u0442', 't'],
  ['\u0445', 'x'],
  ['\u0443', 'y'],
]);
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_VALUE_LENGTH = 2000;
const MAX_METADATA_ARRAY_LENGTH = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_NODES = 200;
const MAX_CLI_BINARY_BYTES = 50 * 1024 * 1024;
const CLI_ALLOWED_COMMANDS = new Set(['claude', 'codex']);
const CLI_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TMPDIR',
  'TMP',
  'TEMP',
  'XDG_CONFIG_HOME',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_MODEL',
  'CODEX_HOME',
  'CODEX_PROFILE',
  'CODEX_MODEL',
  'CODEX_DISABLE_HISTORY',
]);
const CLI_TRUSTED_DIRS = [
  '/usr/bin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/opt/local/bin',
];

function safePerformanceNow(): number | null {
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeSensitiveString(value: string): string {
  const normalized = value.normalize('NFKC');
  return normalized.replace(UNICODE_DASH_PATTERN, '-');
}

function buildConfusableSkeleton(value: string): string {
  let result = '';
  const decomposed = value.normalize('NFKD');
  for (const char of decomposed) {
    if (char <= '\u007F') {
      result += char;
      continue;
    }
    if (COMBINING_MARK_PATTERN.test(char)) continue;
    const mapped = CONFUSABLE_SKELETON_MAP.get(char);
    if (mapped) {
      result += mapped;
    }
  }
  return result;
}

function isSensitiveString(value: string): boolean {
  if (SENSITIVE_METADATA_VALUE_PATTERN.test(value)) return true;
  const normalized = normalizeSensitiveString(value);
  if (SENSITIVE_METADATA_VALUE_PATTERN.test(normalized)) return true;
  const decomposed = normalized.normalize('NFKD').replace(COMBINING_MARKS_PATTERN, '');
  const asciiFolded = decomposed.replace(/[^\u0000-\u007F]/g, '');
  if (asciiFolded !== normalized && SENSITIVE_METADATA_VALUE_PATTERN.test(asciiFolded)) return true;
  const skeleton = buildConfusableSkeleton(normalized);
  if (skeleton !== normalized && SENSITIVE_METADATA_VALUE_PATTERN.test(skeleton)) return true;
  return false;
}

function isSensitiveKey(value: string): boolean {
  if (SENSITIVE_METADATA_PATTERN.test(value)) return true;
  const normalized = normalizeSensitiveString(value);
  if (SENSITIVE_METADATA_PATTERN.test(normalized)) return true;
  const skeleton = buildConfusableSkeleton(normalized);
  if (skeleton !== normalized && SENSITIVE_METADATA_PATTERN.test(skeleton)) return true;
  return false;
}

function sanitizeMetadataValue(
  value: unknown,
  path: string,
  state: { nodes: number }
): { ok: boolean; value?: unknown; sensitive: boolean } {
  if (state.nodes >= MAX_METADATA_NODES) return { ok: false, sensitive: true };
  state.nodes += 1;
  if (value === null || value === undefined) return { ok: true, value: null, sensitive: false };
  if (typeof value === 'boolean' || typeof value === 'number') {
    return { ok: true, value, sensitive: false };
  }
  if (typeof value === 'string') {
    if (isSensitiveString(value)) return { ok: false, sensitive: true };
    const normalized = normalizeSensitiveString(value);
    if (normalized.length > MAX_METADATA_VALUE_LENGTH) {
      return { ok: true, value: normalized.slice(0, MAX_METADATA_VALUE_LENGTH), sensitive: false };
    }
    return { ok: true, value: normalized, sensitive: false };
  }
  if (Array.isArray(value)) {
    if (path.split('.').length > MAX_METADATA_DEPTH) return { ok: false, sensitive: true };
    const sanitized: Array<string | number | boolean | null | Record<string, unknown>> = [];
    for (const [index, entry] of value.slice(0, MAX_METADATA_ARRAY_LENGTH).entries()) {
      const result = sanitizeMetadataValue(entry, `${path}[${index}]`, state);
      if (result.sensitive) return { ok: false, sensitive: true };
      if (result.ok) {
        const allowed =
          result.value === null ||
          typeof result.value === 'string' ||
          typeof result.value === 'number' ||
          typeof result.value === 'boolean' ||
          (result.value && typeof result.value === 'object' && !Array.isArray(result.value));
        if (allowed) sanitized.push(result.value as string | number | boolean | null | Record<string, unknown>);
      }
    }
    return { ok: true, value: sanitized, sensitive: false };
  }
  if (value && typeof value === 'object') {
    if (path.split('.').length > MAX_METADATA_DEPTH) return { ok: false, sensitive: true };
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) return { ok: false, sensitive: true };
    const result: Record<string, unknown> = Object.create(null);
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key));
    for (const key of keys) {
      if (isSensitiveKey(key)) return { ok: false, sensitive: true };
      const child = (value as Record<string, unknown>)[key];
      const childResult = sanitizeMetadataValue(child, `${path}.${key}`, state);
      if (childResult.sensitive) return { ok: false, sensitive: true };
      if (childResult.ok) {
        result[key] = childResult.value;
      }
    }
    return { ok: true, value: result, sensitive: false };
  }
  return { ok: false, sensitive: true };
}

function sanitizeProbeMetadata(metadata: Record<string, unknown> | undefined): {
  sanitized?: Record<string, unknown>;
  redactedKeys: string[];
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { redactedKeys: [] };
  }
  const sanitized: Record<string, unknown> = Object.create(null);
  const redactedKeys: string[] = [];
  let count = 0;
  const keys = Object.keys(metadata).filter((key) => Object.prototype.hasOwnProperty.call(metadata, key));
  for (const key of keys) {
    if (count >= MAX_METADATA_KEYS) break;
    const value = metadata[key];
    if (isSensitiveKey(key)) {
      redactedKeys.push(key);
      continue;
    }
    const sanitizedValue = sanitizeMetadataValue(value, key, { nodes: 0 });
    if (sanitizedValue.sensitive || !sanitizedValue.ok) {
      redactedKeys.push(key);
      continue;
    }
    sanitized[key] = sanitizedValue.value;
    count += 1;
  }
  return { sanitized, redactedKeys };
}

function hasPathTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes('..');
}

function hasWindowsUnsafePath(value: string): boolean {
  if (value.startsWith('\\\\?\\') || value.startsWith('\\\\.\\')) return true;
  if (/[<>\"|?*]/.test(value)) return true;
  const colonIndex = value.indexOf(':');
  if (colonIndex !== -1 && colonIndex !== 1) return true;
  if (colonIndex === 1 && !/^[A-Za-z]:/.test(value)) return true;
  if (colonIndex === 1 && value.slice(2).includes(':')) return true;
  const reservedNames = new Set([
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ]);
  const segments = value.split(/[\\/]+/).filter(Boolean);
  for (const segment of segments) {
    if (segment.endsWith(' ') || segment.endsWith('.')) return true;
    const trimmed = segment.replace(/[. ]+$/g, '');
    if (!trimmed) return true;
    if (trimmed.includes(':')) return true;
    const base = trimmed.split('.')[0]?.toUpperCase();
    if (base && reservedNames.has(base)) return true;
  }
  return false;
}

function isSafeAbsolutePath(value: string): boolean {
  if (!value) return false;
  if (value.includes('\0')) return false;
  if (process.platform === 'win32' && hasWindowsUnsafePath(value)) return false;
  if (!path.isAbsolute(value)) return false;
  if (hasPathTraversal(value)) return false;
  return true;
}

function normalizeAbsolutePath(value: string): string | null {
  if (!isSafeAbsolutePath(value)) return null;
  const resolved = path.resolve(value);
  return isSafeAbsolutePath(resolved) ? resolved : null;
}

function safeRealpath(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function resolveSafeHomeDir(): string | null {
  let home = '';
  try {
    home = os.homedir();
  } catch {
    return null;
  }
  if (!isSafeAbsolutePath(home)) return null;
  const resolved = safeRealpath(home);
  if (!resolved || !isSafeAbsolutePath(resolved)) return null;
  const root = path.parse(resolved).root;
  if (resolved === root) return null;
  return resolved;
}

function hasSafeDirPermissions(stats: fs.Stats, ownerUid: number | null): boolean {
  if (process.platform === 'win32') return true;
  const mode = stats.mode & 0o777;
  if ((mode & 0o022) !== 0) return false;
  if (ownerUid === null) return true;
  return stats.uid === ownerUid;
}

function hasSafeBinaryPermissions(stats: fs.Stats, ownerUid: number | null): boolean {
  if (process.platform === 'win32') return true;
  const mode = stats.mode & 0o777;
  if ((mode & 0o022) !== 0) return false;
  if (ownerUid === null) return true;
  return stats.uid === ownerUid || stats.uid === 0;
}

function resolveSafeDir(prefix: string, label: string): { path: string | null; error?: string } {
  if (!isSafeAbsolutePath(prefix)) return { path: null, error: `${label}_invalid` };
  const resolved = safeRealpath(prefix);
  if (!resolved || !isSafeAbsolutePath(resolved)) {
    return { path: null, error: `${label}_unresolved` };
  }
  const root = path.parse(resolved).root;
  if (resolved === root) return { path: null, error: `${label}_root` };
  try {
    const stats = fs.statSync(resolved);
    const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!stats.isDirectory()) return { path: null, error: `${label}_not_dir` };
    if (!hasSafeDirPermissions(stats, ownerUid)) {
      return { path: null, error: `${label}_permissions_unsafe` };
    }
  } catch {
    return { path: null, error: `${label}_stat_failed` };
  }
  return { path: resolved };
}

function resolveSafeLocalBin(prefix: string): { path: string | null; error?: string } {
  return resolveSafeDir(prefix, 'local_bin');
}

function resolveSafeHomeToolDir(prefix: string): { path: string | null; error?: string } {
  return resolveSafeDir(prefix, 'home_tool_dir');
}

function getTrustedCliDirs(): {
  dirs: string[];
  systemDirs: string[];
  localDirs: string[];
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const trusted: string[] = [];
  const systemDirs: string[] = [];
  const localDirs: string[] = [];
  for (const dir of CLI_TRUSTED_DIRS) {
    if (!isSafeAbsolutePath(dir)) {
      diagnostics.push('trusted_dir_invalid');
      continue;
    }
    const resolved = safeRealpath(dir);
    if (!resolved || !isSafeAbsolutePath(resolved)) {
      diagnostics.push('trusted_dir_unresolved');
      continue;
    }
    try {
      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        diagnostics.push('trusted_dir_not_dir');
        continue;
      }
    } catch {
      diagnostics.push('trusted_dir_stat_failed');
      continue;
    }
    trusted.push(resolved);
    systemDirs.push(resolved);
  }
  const home = resolveSafeHomeDir();
  if (!home) {
    diagnostics.push('home_unavailable');
  } else {
    const localBin = resolveSafeLocalBin(path.join(home, '.local', 'bin'));
    if (!localBin.path) {
      diagnostics.push(localBin.error ?? 'local_bin_unavailable');
    } else {
      trusted.push(localBin.path);
      localDirs.push(localBin.path);
    }
    const homeToolCandidates = [
      path.join(home, '.local', 'share'),
      path.join(home, '.npm-global'),
    ];
    for (const candidate of homeToolCandidates) {
      const resolved = resolveSafeHomeToolDir(candidate);
      if (!resolved.path) {
        diagnostics.push(resolved.error ?? 'home_tool_dir_unavailable');
        continue;
      }
      trusted.push(resolved.path);
      localDirs.push(resolved.path);
    }
  }
  return { dirs: trusted, systemDirs, localDirs, diagnostics };
}

function isPathWithinDirectory(filePath: string, dir: string): boolean {
  const relative = path.relative(dir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return true;
}

function resolveCliBinary(
  cmd: LibrarianLlmProvider,
  env: NodeJS.ProcessEnv
): { path: string | null; error?: string; diagnostics?: string[] } {
  const pathValue = env.PATH ?? process.env.PATH ?? '';
  const diagnostics = new Set<string>();
  if (!pathValue) diagnostics.add('path_empty');
  const segments = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const segment of segments) {
    if (!isSafeAbsolutePath(segment)) {
      diagnostics.add('path_invalid');
      continue;
    }
    const resolvedDir = safeRealpath(segment);
    if (!resolvedDir || !isSafeAbsolutePath(resolvedDir)) {
      diagnostics.add('path_unresolved');
      continue;
    }
    for (const ext of extensions) {
      const filename = ext ? `${cmd}${ext}` : cmd;
      const candidate = path.join(resolvedDir, filename);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(candidate);
      } catch {
        diagnostics.add('binary_missing');
        continue;
      }
      if (!stats.isFile()) {
        diagnostics.add('binary_not_file');
        continue;
      }
      try {
        if (process.platform !== 'win32') {
          fs.accessSync(candidate, fs.constants.X_OK);
        }
      } catch {
        diagnostics.add('binary_not_executable');
        continue;
      }
      const resolved = safeRealpath(candidate);
      if (!resolved || !isSafeAbsolutePath(resolved)) {
        diagnostics.add('binary_unresolved');
        continue;
      }
      return { path: resolved };
    }
  }
  const list = Array.from(diagnostics);
  const error = list.length
    ? `cli_binary_not_found:${list.join(',')}`
    : 'cli_binary_not_found';
  return { path: null, error, diagnostics: list };
}

async function hashFileSha256(
  filePath: string
): Promise<{ hash: string | null; error?: string }> {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return { hash: null, error: 'cli_hash_stat_failed' };
  }
  if (
    !stats.isFile() ||
    stats.isFIFO?.() ||
    stats.isSocket?.() ||
    stats.isCharacterDevice?.() ||
    stats.isBlockDevice?.()
  ) {
    return { hash: null, error: 'cli_hash_not_file' };
  }
  if (stats.size > MAX_CLI_BINARY_BYTES) {
    return { hash: null, error: 'cli_hash_too_large' };
  }
  try {
    const payload = fs.readFileSync(filePath);
    return { hash: createHash('sha256').update(payload).digest('hex') };
  } catch {
    return { hash: null, error: 'cli_hash_read_failed' };
  }
}

async function verifyBinaryHash(
  cmd: LibrarianLlmProvider,
  binaryPath: string
): Promise<{ ok: boolean; error?: string }> {
  const expectedHashes = Array.isArray(CLI_BINARY_HASHES.hashes[cmd])
    ? CLI_BINARY_HASHES.hashes[cmd]
    : [];
  const normalized = expectedHashes
    .map((value) => String(value).trim().toLowerCase())
    .filter((value) => /^[a-f0-9]{64}$/.test(value));
  if (normalized.length === 0) {
    const allowUnverified = process.env.LIBRARIAN_ALLOW_UNVERIFIED_CLI === 'true';
    const requireHashes =
      CLI_BINARY_HASHES.requireHashVerification || process.env.NODE_ENV === 'production';
    if (requireHashes && !allowUnverified) {
      return { ok: false, error: 'cli_hash_missing' };
    }
    return { ok: true };
  }
  const result = await hashFileSha256(binaryPath);
  if (!result.hash) {
    return { ok: false, error: result.error ?? 'cli_hash_unavailable' };
  }
  if (!normalized.includes(result.hash)) return { ok: false, error: 'cli_hash_mismatch' };
  return { ok: true };
}

function verifyRootOwnedPathChain(filePath: string): boolean {
  if (process.platform === 'win32') return true;
  let current = path.dirname(filePath);
  const root = path.parse(current).root;
  while (true) {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(current);
    } catch {
      return false;
    }
    const mode = stats.mode & 0o777;
    if (stats.uid !== 0) return false;
    if ((mode & 0o022) !== 0) return false;
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return true;
}

async function verifyCliBinary(
  cmd: LibrarianLlmProvider,
  binaryPath: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSafeAbsolutePath(binaryPath)) return { ok: false, error: 'cli_binary_untrusted' };
  const { dirs, systemDirs, diagnostics } = getTrustedCliDirs();
  const inTrustedDir = dirs.some((dir) => isPathWithinDirectory(binaryPath, dir));
  if (!inTrustedDir) {
    const error = diagnostics.length
      ? `cli_binary_untrusted:${diagnostics.join(',')}`
      : 'cli_binary_untrusted';
    return { ok: false, error };
  }
  try {
    const stats = fs.statSync(binaryPath);
    const ownerUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!stats.isFile()) return { ok: false, error: 'cli_binary_invalid' };
    if ((stats.mode & 0o6000) !== 0) {
      return { ok: false, error: 'cli_binary_privileged' };
    }
    if (!hasSafeBinaryPermissions(stats, ownerUid)) {
      return { ok: false, error: 'cli_binary_permissions_unsafe' };
    }
    if (ownerUid !== null && stats.uid === 0) {
      const inSystemDir = systemDirs.some((dir) => isPathWithinDirectory(binaryPath, dir));
      if (!inSystemDir) {
        return { ok: false, error: 'cli_binary_root_owned' };
      }
      if (!verifyRootOwnedPathChain(binaryPath)) {
        return { ok: false, error: 'cli_binary_root_chain_unsafe' };
      }
    }
  } catch {
    return { ok: false, error: 'cli_binary_unavailable' };
  }
  const hashCheck = await verifyBinaryHash(cmd, binaryPath);
  if (!hashCheck.ok) return hashCheck;
  return { ok: true };
}

function isBlockedEnvVarName(name: string): boolean {
  return /(key|secret|token|password)/i.test(name);
}

function buildCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CLI_ENV_ALLOWLIST) {
    if (isBlockedEnvVarName(key)) continue;
    const value = process.env[key];
    if (value === undefined) continue;
    env[key] = value;
  }
  env.PATH = env.PATH ?? process.env.PATH ?? '';
  return withCliPath(env);
}

function withCliPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = resolveSafeHomeDir();
  if (!home) return env;
  const prefix = path.join(home, '.local', 'bin');
  if (!prefix || !path.isAbsolute(prefix) || prefix === path.parse(prefix).root) return env;
  const safePrefix = resolveSafeLocalBin(prefix);
  if (!safePrefix.path) return env;
  const currentPath = env.PATH ?? '';
  const parts = currentPath.split(path.delimiter).filter(Boolean);
  if (parts.includes(safePrefix.path)) return env;
  return { ...env, PATH: `${safePrefix.path}${path.delimiter}${currentPath}` };
}

function redactCliOutput(value: string): string {
  if (!value) return value;
  if (!isSensitiveString(value)) return value;
  return '[redacted]';
}

async function runCliCheck(
  cmd: string,
  args: string[],
  timeoutMs = 5000
): Promise<{ ok: boolean; output: string }> {
  if (!CLI_ALLOWED_COMMANDS.has(cmd)) {
    return { ok: false, output: 'command_not_allowed' };
  }
  const env = buildCliEnv();
  const provider = cmd as LibrarianLlmProvider;
  const resolved = resolveCliBinary(provider, env);
  if (!resolved.path) {
    return { ok: false, output: resolved.error ?? 'cli_binary_not_found' };
  }
  const verified = await verifyCliBinary(provider, resolved.path);
  if (!verified.ok) {
    return { ok: false, output: verified.error ?? 'cli_binary_unverified' };
  }
  try {
    const result = await execa(resolved.path, args, {
      env,
      timeout: timeoutMs,
      reject: false,
    });
    const stdout = (result.stdout ?? '').toString().trim();
    const stderr = (result.stderr ?? '').toString().trim();
    const output = redactCliOutput(`${stdout}\n${stderr}`.trim());
    return { ok: result.exitCode === 0, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: redactCliOutput(message) };
  }
}

function resolveClaudeConfigDir(): string | null {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  if (configured) return normalizeAbsolutePath(configured);
  const home = resolveSafeHomeDir();
  if (!home) return null;
  return path.join(home, '.claude');
}

function resolveCodexHome(): string | null {
  const configured = process.env.CODEX_HOME;
  if (configured) return normalizeAbsolutePath(configured);
  const home = resolveSafeHomeDir();
  if (!home) return null;
  return path.join(home, '.codex');
}

async function checkClaudeCli(): Promise<LlmProviderProbeResult> {
  try {
    const version = await runCliCheck('claude', ['--version']);
    if (!version.ok) {
      return {
        available: false,
        authenticated: false,
        error: version.output || 'Claude CLI not available or not in PATH',
      };
    }

    const configDir = resolveClaudeConfigDir();
    const configPath = configDir ? path.join(configDir, '.claude.json') : null;
    let hasConfig = false;
    if (configPath) {
      try {
        hasConfig = fs.existsSync(configPath);
      } catch {
        hasConfig = false;
      }
    }
    if (!hasConfig) {
      return {
        available: true,
        authenticated: false,
        error: 'Claude CLI not authenticated - run "claude setup-token" or start "claude" once',
      };
    }
    return { available: true, authenticated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, authenticated: false, error: `probe_failed: ${message}` };
  }
}

async function checkCodexCli(): Promise<LlmProviderProbeResult> {
  try {
    const version = await runCliCheck('codex', ['--version']);
    if (!version.ok) {
      return {
        available: false,
        authenticated: false,
        error: version.output || 'Codex CLI not available or not in PATH',
      };
    }
    const codexHome = resolveCodexHome();
    let codexHomeExists = false;
    if (codexHome) {
      try {
        codexHomeExists = fs.existsSync(codexHome);
      } catch {
        codexHomeExists = false;
      }
    }
    if (!codexHome || !codexHomeExists) {
      return {
        available: true,
        authenticated: false,
        error: 'CODEX_HOME directory not found',
      };
    }
    const status = await runCliCheck('codex', ['login', 'status']);
    const statusLower = status.output.toLowerCase();
    const negativeMatch = /not\s+logged\s+in|not\s+authenticated|unauthenticated|expired/.test(statusLower);
    const positiveMatch = /\blogged\s+in\b|\bauthenticated\b/.test(statusLower);
    const loggedIn = status.ok && !negativeMatch && positiveMatch;
    if (!loggedIn) {
      return {
        available: true,
        authenticated: false,
        error: status.output || 'Codex CLI not authenticated - run "codex login"',
      };
    }
    return { available: true, authenticated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, authenticated: false, error: `probe_failed: ${message}` };
  }
}

export class LlmProviderRegistry {
  private probes = new Map<string, LlmProviderProbe>();
  private cachedDiscovery: {
    wallclockMs: number;
    monotonicMs: number | null;
    results: Map<string, LlmProviderProbeResult>;
  } | null = null;
  private cacheValidityMs = 30 * 60 * 1000;

  register(probe: LlmProviderProbe): void {
    this.probes.set(probe.descriptor.id, probe);
  }

  unregister(providerId: string): void {
    this.probes.delete(providerId);
  }

  getProbe(providerId: string): LlmProviderProbe | undefined {
    return this.probes.get(providerId);
  }

  getAllProbes(): LlmProviderProbe[] {
    return Array.from(this.probes.values());
  }

  async discoverAll(options?: { forceRefresh?: boolean }): Promise<Map<string, LlmProviderProbeResult>> {
    const monotonicNow = safePerformanceNow();
    if (!options?.forceRefresh && this.cachedDiscovery) {
      const cached = this.cachedDiscovery;
      if (monotonicNow === null || cached.monotonicMs === null) {
        console.warn('[llm_provider_discovery] monotonic clock unavailable; disabling cache');
        this.cachedDiscovery = null;
      } else {
        const ageMs = monotonicNow - cached.monotonicMs;
        if (!Number.isFinite(ageMs)) {
          console.warn('[llm_provider_discovery] monotonic clock anomaly; invalidating cache');
          this.cachedDiscovery = null;
        } else if (ageMs < 0) {
          console.warn('[llm_provider_discovery] monotonic clock anomaly; invalidating cache');
          this.cachedDiscovery = null;
        } else if (ageMs < this.cacheValidityMs) {
          return new Map(cached.results);
        } else {
          const staleMs = Math.abs(ageMs);
          if (staleMs > this.cacheValidityMs * 2) {
            console.warn('[llm_provider_discovery] cache age exceeded safety threshold; refreshing');
          }
          this.cachedDiscovery = null;
        }
      }
    }
    const results = new Map<string, LlmProviderProbeResult>();
    for (const probe of this.getAllProbes()) {
      try {
        const status = await probe.probe();
        const { sanitized, redactedKeys } = sanitizeProbeMetadata(status.metadata);
        const metadata = sanitized ?? undefined;
        if (redactedKeys.length > 0) {
          console.warn(`[llm_provider_discovery] redacted metadata keys for ${probe.descriptor.id}: ${redactedKeys.join(', ')}`);
        }
        if (metadata) {
          const keys = Object.keys(metadata);
          console.info(`[llm_provider_discovery] metadata keys for ${probe.descriptor.id}: ${keys.length > 0 ? keys.join(', ') : 'none'}`);
        }
        results.set(probe.descriptor.id, { ...status, metadata });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.set(probe.descriptor.id, {
          available: false,
          authenticated: false,
          error: `probe_failed: ${message}`,
        });
      }
    }
    if (monotonicNow === null) {
      console.warn('[llm_provider_discovery] monotonic clock unavailable; skipping cache');
    } else {
      this.cachedDiscovery = {
        wallclockMs: Date.now(),
        monotonicMs: monotonicNow,
        results,
      };
    }
    return new Map(results);
  }

  async findBestProvider(options?: {
    forceRefresh?: boolean;
    requireEmbeddings?: boolean;
  }): Promise<DiscoveredProvider | null> {
    const results = await this.discoverAll({ forceRefresh: options?.forceRefresh });
    const preferredProvider = resolveHostPreferredProvider();
    const candidates = this.getAllProbes()
      .filter((probe) => {
        if (options?.requireEmbeddings && !probe.descriptor.supportsEmbeddings) return false;
        const status = results.get(probe.descriptor.id);
        return Boolean(status?.available && status?.authenticated);
      })
      .sort((left, right) => {
        if (preferredProvider) {
          const leftPreferred = left.descriptor.id === preferredProvider;
          const rightPreferred = right.descriptor.id === preferredProvider;
          if (leftPreferred !== rightPreferred) {
            return leftPreferred ? -1 : 1;
          }
        }
        return left.descriptor.priority - right.descriptor.priority;
      });

    const selected = candidates[0];
    if (!selected) return null;
    const status = results.get(selected.descriptor.id);
    if (!status) return null;
    return {
      provider: selected.descriptor.id,
      modelId: selected.descriptor.defaultModel,
      descriptor: selected.descriptor,
      status,
    };
  }

  async checkProvider(providerId: string): Promise<LlmProviderProbeResult> {
    const probe = this.getProbe(providerId);
    if (!probe) {
      return { available: false, authenticated: false, error: `Unknown provider: ${providerId}` };
    }
    return probe.probe();
  }
}

export const claudeCliProbe: LlmProviderProbe = {
  descriptor: {
    id: 'claude',
    name: 'Claude CLI',
    authMethod: 'cli_login',
    defaultModel: 'claude-sonnet-4-5-20241022',
    priority: 10,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['CLAUDE_MODEL', 'CLAUDE_CONFIG_DIR'],
  async probe(): Promise<LlmProviderProbeResult> {
    return checkClaudeCli();
  },
};

export const codexCliProbe: LlmProviderProbe = {
  descriptor: {
    id: 'codex',
    name: 'Codex CLI',
    authMethod: 'cli_login',
    defaultModel: 'gpt-5-codex',
    priority: 20,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['CODEX_MODEL', 'CODEX_HOME', 'CODEX_PROFILE'],
  async probe(): Promise<LlmProviderProbeResult> {
    return checkCodexCli();
  },
};

export const llmProviderRegistry = new LlmProviderRegistry();
llmProviderRegistry.register(claudeCliProbe);
llmProviderRegistry.register(codexCliProbe);

export async function discoverLlmProvider(options?: {
  forceRefresh?: boolean;
  requireEmbeddings?: boolean;
}): Promise<DiscoveredProvider | null> {
  return llmProviderRegistry.findBestProvider(options);
}

export async function getAllProviderStatus(options?: {
  forceRefresh?: boolean;
}): Promise<Array<{ descriptor: LlmProviderDescriptor; status: LlmProviderProbeResult }>> {
  const results = await llmProviderRegistry.discoverAll(options);
  return llmProviderRegistry.getAllProbes().map((probe) => ({
    descriptor: probe.descriptor,
    status: results.get(probe.descriptor.id) ?? { available: false, authenticated: false, error: 'Not checked' },
  }));
}
