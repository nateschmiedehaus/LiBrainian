export interface CliRuntimeModeInput {
  args: string[];
  env?: NodeJS.ProcessEnv;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  jsonMode: boolean;
}

export interface CliRuntimeMode {
  ci: boolean;
  nonInteractive: boolean;
  quiet: boolean;
  noProgress: boolean;
  noColor: boolean;
  assumeYes: boolean;
  jsonMode: boolean;
  offline: boolean;
  noTelemetry: boolean;
  localOnly: boolean;
}

interface ConsoleLike {
  log: typeof console.log;
  info: typeof console.info;
  warn: typeof console.warn;
  debug: typeof console.debug;
}

function hasFlag(args: string[], longFlag: string, shortFlag?: string): boolean {
  return args.includes(longFlag) || (shortFlag ? args.includes(shortFlag) : false);
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function readBrandedEnv(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  return env[`LIBRAINIAN_${suffix}`] ?? env[`LIBRARIAN_${suffix}`];
}

function writeBrandedEnv(env: NodeJS.ProcessEnv, suffix: string, value: string): void {
  env[`LIBRAINIAN_${suffix}`] = value;
  env[`LIBRARIAN_${suffix}`] = value;
}

export function deriveCliRuntimeMode(input: CliRuntimeModeInput): CliRuntimeMode {
  const env = input.env ?? process.env;
  const stdoutIsTTY = input.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  const stderrIsTTY = input.stderrIsTTY ?? Boolean(process.stderr.isTTY);

  const explicitCi = hasFlag(input.args, '--ci');
  const ciFromEnv = isTruthy(env.CI) || isTruthy(env.GITHUB_ACTIONS);
  const noInteractiveEnv = isTruthy(readBrandedEnv(env, 'NO_INTERACTIVE'));
  const ci = explicitCi || ciFromEnv || !stdoutIsTTY || !stderrIsTTY || noInteractiveEnv;
  const nonInteractive = ci || noInteractiveEnv;

  const quiet = hasFlag(input.args, '--quiet', '-q') || isTruthy(readBrandedEnv(env, 'QUIET'));
  const noProgress = hasFlag(input.args, '--no-progress')
    || isTruthy(readBrandedEnv(env, 'NO_PROGRESS'))
    || nonInteractive;
  const noColor = hasFlag(input.args, '--no-color')
    || typeof env.NO_COLOR === 'string'
    || nonInteractive;
  const assumeYes = hasFlag(input.args, '--yes', '-y')
    || isTruthy(readBrandedEnv(env, 'ASSUME_YES'))
    || nonInteractive;
  const localOnly = hasFlag(input.args, '--local-only') || isTruthy(readBrandedEnv(env, 'LOCAL_ONLY'));
  const offline = localOnly || hasFlag(input.args, '--offline') || isTruthy(readBrandedEnv(env, 'OFFLINE'));
  const noTelemetry = hasFlag(input.args, '--no-telemetry') || isTruthy(readBrandedEnv(env, 'NO_TELEMETRY'));

  return {
    ci,
    nonInteractive,
    quiet,
    noProgress,
    noColor,
    assumeYes,
    jsonMode: input.jsonMode,
    offline,
    noTelemetry,
    localOnly,
  };
}

export function applyCliRuntimeMode(
  mode: CliRuntimeMode,
  options?: { env?: NodeJS.ProcessEnv; consoleLike?: ConsoleLike }
): () => void {
  const env = options?.env ?? process.env;
  const consoleLike = options?.consoleLike ?? console;

  if (mode.nonInteractive) {
    writeBrandedEnv(env, 'NO_INTERACTIVE', '1');
  }
  if (mode.noProgress) {
    writeBrandedEnv(env, 'NO_PROGRESS', '1');
  }
  if (mode.noColor) {
    env.NO_COLOR = '1';
    env.FORCE_COLOR = '0';
  }
  if (mode.assumeYes) {
    writeBrandedEnv(env, 'ASSUME_YES', '1');
  }
  if (mode.localOnly) {
    writeBrandedEnv(env, 'LOCAL_ONLY', '1');
  }
  if (mode.offline || mode.localOnly) {
    writeBrandedEnv(env, 'OFFLINE', '1');
    writeBrandedEnv(env, 'SKIP_PROVIDER_CHECK', '1');
  }
  if (mode.noTelemetry || mode.localOnly) {
    writeBrandedEnv(env, 'NO_TELEMETRY', '1');
    if (!readBrandedEnv(env, 'LOG_LEVEL')) {
      writeBrandedEnv(env, 'LOG_LEVEL', 'silent');
    }
  }
  if (mode.quiet && !mode.jsonMode && !readBrandedEnv(env, 'LOG_LEVEL')) {
    writeBrandedEnv(env, 'LOG_LEVEL', 'silent');
  }

  if (!(mode.quiet && !mode.jsonMode)) {
    return () => {};
  }

  const originalLog = consoleLike.log;
  const originalInfo = consoleLike.info;
  const originalWarn = consoleLike.warn;
  const originalDebug = consoleLike.debug;

  const noop = () => {};
  consoleLike.log = noop;
  consoleLike.info = noop;
  consoleLike.warn = noop;
  consoleLike.debug = noop;

  return () => {
    consoleLike.log = originalLog;
    consoleLike.info = originalInfo;
    consoleLike.warn = originalWarn;
    consoleLike.debug = originalDebug;
  };
}
