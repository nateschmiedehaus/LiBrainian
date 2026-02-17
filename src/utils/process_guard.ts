export interface ProcessEntry {
  pid: number;
  command: string;
}

export function parseProcessList(raw: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    if (!Number.isFinite(pid)) continue;
    entries.push({
      pid,
      command: match[2] ?? '',
    });
  }
  return entries;
}

export function findLingeringProcesses(input: {
  entries: ProcessEntry[];
  includePatterns: string[];
  excludePids?: number[];
}): ProcessEntry[] {
  const includePatterns = input.includePatterns.filter((pattern) => pattern.length > 0);
  const excluded = new Set(input.excludePids ?? []);
  return input.entries.filter((entry) => {
    if (excluded.has(entry.pid)) return false;
    return includePatterns.every((pattern) => entry.command.includes(pattern));
  });
}
