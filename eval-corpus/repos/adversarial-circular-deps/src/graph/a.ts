import { readB } from './b.js';

export function readA(): string {
  return `a(${readB()})`;
}
