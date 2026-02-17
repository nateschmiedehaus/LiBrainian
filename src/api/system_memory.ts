/**
 * System memory helpers.
 *
 * Node's `os.freemem()` is often pessimistic on macOS (reclaimable pages are not
 * counted as "free"). For resource decisions we want a closer approximation of
 * "available" memory where possible.
 */

import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';

export type AvailableMemorySource = 'linux_meminfo' | 'darwin_vm_stat' | 'os_freemem';

export function parseLinuxMeminfoAvailableBytes(meminfo: string): number | null {
  const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  if (!match) return null;
  const kb = Number(match[1]);
  if (!Number.isFinite(kb) || kb < 0) return null;
  return kb * 1024;
}

export function parseDarwinVmStatAvailableBytes(vmStatOutput: string): number | null {
  const pageSizeMatch = vmStatOutput.match(/page size of (\d+) bytes/i);
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

  const pageValue = (label: string): number => {
    const re = new RegExp(`^Pages\\s+${label}:\\s+(\\d+)\\.`, 'mi');
    const m = vmStatOutput.match(re);
    if (!m) return 0;
    const pages = Number(m[1]);
    return Number.isFinite(pages) && pages > 0 ? pages : 0;
  };

  // Commonly used "available-ish" approximation on macOS:
  // free + inactive + speculative (+ purgeable for extra headroom).
  const pagesFree = pageValue('free');
  const pagesInactive = pageValue('inactive');
  const pagesSpeculative = pageValue('speculative');
  const pagesPurgeable = pageValue('purgeable');

  const totalPages = pagesFree + pagesInactive + pagesSpeculative + pagesPurgeable;
  if (totalPages <= 0) return null;
  return totalPages * pageSize;
}

let cached: { ts: number; bytes: number; source: AvailableMemorySource } | null = null;
const CACHE_WINDOW_MS = 1000;

export function getAvailableMemoryBytes(): { bytes: number; source: AvailableMemorySource } {
  const now = Date.now();
  if (cached && now - cached.ts <= CACHE_WINDOW_MS) {
    return { bytes: cached.bytes, source: cached.source };
  }

  const platform = os.platform();

  if (platform === 'linux') {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const bytes = parseLinuxMeminfoAvailableBytes(meminfo);
      if (bytes !== null) {
        cached = { ts: now, bytes, source: 'linux_meminfo' };
        return { bytes, source: 'linux_meminfo' };
      }
    } catch {
      // Fall back below.
    }
  }

  if (platform === 'darwin') {
    try {
      const output = execSync('vm_stat', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const bytes = parseDarwinVmStatAvailableBytes(output);
      if (bytes !== null) {
        cached = { ts: now, bytes, source: 'darwin_vm_stat' };
        return { bytes, source: 'darwin_vm_stat' };
      }
    } catch {
      // Fall back below.
    }
  }

  const bytes = os.freemem();
  cached = { ts: now, bytes, source: 'os_freemem' };
  return { bytes, source: 'os_freemem' };
}

