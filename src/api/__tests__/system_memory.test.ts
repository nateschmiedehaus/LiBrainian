import { describe, it, expect } from 'vitest';
import {
  parseDarwinVmStatAvailableBytes,
  parseLinuxMeminfoAvailableBytes,
} from '../system_memory.js';

describe('system_memory parsing', () => {
  it('parses MemAvailable from /proc/meminfo', () => {
    const sample = [
      'MemTotal:       16384256 kB',
      'MemFree:          123456 kB',
      'MemAvailable:    9876543 kB',
      'Buffers:          111111 kB',
    ].join('\n');
    expect(parseLinuxMeminfoAvailableBytes(sample)).toBe(9876543 * 1024);
  });

  it('returns null when MemAvailable is missing', () => {
    const sample = 'MemTotal: 1000 kB\nMemFree: 10 kB\n';
    expect(parseLinuxMeminfoAvailableBytes(sample)).toBeNull();
  });

  it('parses available-ish memory from vm_stat output', () => {
    const sample = [
      'Mach Virtual Memory Statistics: (page size of 4096 bytes)',
      'Pages free:                               1000.',
      'Pages inactive:                           2000.',
      'Pages speculative:                        300.',
      'Pages purgeable:                          400.',
    ].join('\n');
    const bytes = parseDarwinVmStatAvailableBytes(sample);
    expect(bytes).toBe((1000 + 2000 + 300 + 400) * 4096);
  });

  it('returns null when no page counters can be parsed', () => {
    const sample = 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\n';
    expect(parseDarwinVmStatAvailableBytes(sample)).toBeNull();
  });
});

