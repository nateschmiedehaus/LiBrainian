import { readA } from './a.js';

export function resolveCycleSentinel(): string {
  return `CYCLE_SENTINEL_RESOLVE:${readA()}`;
}
