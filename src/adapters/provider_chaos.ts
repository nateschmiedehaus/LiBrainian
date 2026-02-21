export type ProviderChaosMode =
  | 'timeout'
  | 'error_response'
  | 'truncated_response'
  | 'garbage_response'
  | 'slow_response';

export interface ProviderChaosConfig {
  enabled: boolean;
  rate: number;
  modes: ProviderChaosMode[];
  sequence: ProviderChaosMode[];
  slowDelayMs: number;
  timeoutDelayMs: number;
}

export interface ProviderExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProviderChaosResult extends ProviderExecResult {
  chaosMode: ProviderChaosMode | null;
}

const DEFAULT_MODES: ProviderChaosMode[] = [
  'timeout',
  'error_response',
  'truncated_response',
  'garbage_response',
  'slow_response',
];

const DEFAULT_SLOW_DELAY_MS = 250;
const DEFAULT_TIMEOUT_DELAY_MS = 5;

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return rate;
}

function parseModeList(value: string | undefined): ProviderChaosMode[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is ProviderChaosMode => DEFAULT_MODES.includes(part as ProviderChaosMode));
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createProviderChaosConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderChaosConfig {
  const enabled =
    env.LIBRARIAN_PROVIDER_CHAOS_ENABLED === '1' ||
    env.LIBRARIAN_PROVIDER_CHAOS_MODE !== undefined ||
    env.LIBRARIAN_PROVIDER_CHAOS_SEQUENCE !== undefined ||
    env.LIBRARIAN_PROVIDER_CHAOS_RATE !== undefined;

  const explicitMode = env.LIBRARIAN_PROVIDER_CHAOS_MODE;
  const modeList = explicitMode && DEFAULT_MODES.includes(explicitMode as ProviderChaosMode)
    ? [explicitMode as ProviderChaosMode]
    : parseModeList(env.LIBRARIAN_PROVIDER_CHAOS_MODES);
  const sequence = parseModeList(env.LIBRARIAN_PROVIDER_CHAOS_SEQUENCE);
  const modes = modeList.length > 0 ? modeList : DEFAULT_MODES;
  const rate = clampRate(Number.parseFloat(env.LIBRARIAN_PROVIDER_CHAOS_RATE ?? '0'));

  return {
    enabled,
    rate: rate > 0 ? rate : (enabled ? 1 : 0),
    modes,
    sequence,
    slowDelayMs: parseInteger(env.LIBRARIAN_PROVIDER_CHAOS_SLOW_DELAY_MS, DEFAULT_SLOW_DELAY_MS),
    timeoutDelayMs: parseInteger(env.LIBRARIAN_PROVIDER_CHAOS_TIMEOUT_DELAY_MS, DEFAULT_TIMEOUT_DELAY_MS),
  };
}

export class ProviderChaosMiddleware {
  private sequenceCursor = 0;

  constructor(private readonly config: ProviderChaosConfig) {}

  async execute(
    invoke: () => Promise<ProviderExecResult>,
  ): Promise<ProviderChaosResult> {
    const mode = this.pickMode();
    if (!mode) {
      const result = await invoke();
      return { ...result, chaosMode: null };
    }

    if (mode === 'timeout') {
      await delay(this.config.timeoutDelayMs);
      throw new Error('provider_chaos_timeout');
    }

    if (mode === 'error_response') {
      return {
        chaosMode: mode,
        exitCode: 1,
        stdout: '',
        stderr: 'provider_chaos_error_response',
      };
    }

    if (mode === 'garbage_response') {
      return {
        chaosMode: mode,
        exitCode: 0,
        stdout: '\u0000\ufffdprovider_chaos_garbage',
        stderr: '',
      };
    }

    if (mode === 'slow_response') {
      await delay(this.config.slowDelayMs);
      const result = await invoke();
      return { ...result, chaosMode: mode };
    }

    const result = await invoke();
    const trimmed = result.stdout.trim();
    const prefixLength = Math.max(1, Math.floor(trimmed.length / 2));
    const truncated = `${trimmed.slice(0, prefixLength)}...`;
    return {
      chaosMode: mode,
      exitCode: result.exitCode,
      stdout: truncated,
      stderr: result.stderr,
    };
  }

  private pickMode(): ProviderChaosMode | null {
    if (!this.config.enabled || this.config.rate <= 0) return null;
    if (Math.random() > this.config.rate) return null;

    if (this.config.sequence.length > 0) {
      const mode = this.config.sequence[this.sequenceCursor % this.config.sequence.length];
      this.sequenceCursor += 1;
      return mode;
    }

    const modeIndex = Math.floor(Math.random() * this.config.modes.length);
    return this.config.modes[modeIndex] ?? null;
  }
}
