import * as path from 'node:path';

const LANGUAGE_NAME_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  hh: 'cpp',
  cxx: 'cpp',
  hxx: 'cpp',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  php: 'php',
  phtml: 'php',
  cs: 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  sc: 'scala',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
  rmd: 'r',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  hcl: 'hcl',
  tf: 'hcl',
  tfvars: 'hcl',
  fs: 'fsharp',
  fsx: 'fsharp',
  fsi: 'fsharp',
  hs: 'haskell',
  lhs: 'haskell',
  ml: 'ocaml',
  mli: 'ocaml',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  m: 'objective-c',
  mm: 'objective-c',
  vb: 'vb',
  pl: 'perl',
  pm: 'perl',
  t: 'perl',
  nim: 'nim',
  zig: 'zig',
  v: 'v',
  wat: 'wat',
};

export const SUPPORTED_LANGUAGES = Array.from(new Set(Object.values(LANGUAGE_NAME_BY_EXTENSION))).sort();
export const SUPPORTED_LANGUAGE_EXTENSIONS = Object.keys(LANGUAGE_NAME_BY_EXTENSION).map((ext) => `.${ext}`);

export function getLanguageFromExtension(ext: string, fallback = 'text'): string {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  if (!normalized) return fallback;
  return LANGUAGE_NAME_BY_EXTENSION[normalized] ?? fallback;
}

export function getLanguageFromPath(filePath: string, fallback = 'text'): string {
  const base = path.basename(filePath);
  if (/^Dockerfile(\..+)?$/i.test(base)) return 'dockerfile';
  const ext = path.extname(filePath);
  return getLanguageFromExtension(ext, fallback);
}
