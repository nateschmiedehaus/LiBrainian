import { stat } from 'node:fs/promises';

export type EvidenceFreshnessViolationCode =
  | 'manifest_missing'
  | 'watch_path_missing'
  | 'manifest_stale';

export interface EvidenceFreshnessViolation {
  code: EvidenceFreshnessViolationCode;
  message: string;
  path?: string;
}

export interface EvidenceFreshnessReport {
  ok: boolean;
  manifestPath: string;
  manifestMtimeMs?: number;
  newestWatchedMtimeMs?: number;
  violations: EvidenceFreshnessViolation[];
}

async function readMtimeMs(path: string): Promise<number | null> {
  try {
    const stats = await stat(path);
    return stats.mtimeMs;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function checkEvidenceFreshness(options: {
  manifestPath: string;
  watchedPaths: string[];
}): Promise<EvidenceFreshnessReport> {
  const manifestMtimeMs = await readMtimeMs(options.manifestPath);
  if (manifestMtimeMs === null) {
    return {
      ok: false,
      manifestPath: options.manifestPath,
      violations: [
        {
          code: 'manifest_missing',
          path: options.manifestPath,
          message: 'Evidence manifest is missing.',
        },
      ],
    };
  }

  const violations: EvidenceFreshnessViolation[] = [];
  let newestWatchedMtimeMs = 0;

  for (const watchedPath of options.watchedPaths) {
    const watchedMtimeMs = await readMtimeMs(watchedPath);
    if (watchedMtimeMs === null) {
      violations.push({
        code: 'watch_path_missing',
        path: watchedPath,
        message: 'Watched path is missing.',
      });
      continue;
    }

    if (watchedMtimeMs > newestWatchedMtimeMs) {
      newestWatchedMtimeMs = watchedMtimeMs;
    }

    if (watchedMtimeMs > manifestMtimeMs) {
      violations.push({
        code: 'manifest_stale',
        path: watchedPath,
        message: 'Watched path is newer than evidence manifest.',
      });
    }
  }

  return {
    ok: violations.length === 0,
    manifestPath: options.manifestPath,
    manifestMtimeMs,
    newestWatchedMtimeMs,
    violations,
  };
}
