import { readA } from './a.js';

export function readC(): string {
  return `c(${typeof readA})`;
}
