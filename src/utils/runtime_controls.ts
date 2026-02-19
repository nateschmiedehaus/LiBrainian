export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isLocalOnlyModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env.LIBRARIAN_LOCAL_ONLY);
}

export function isOfflineModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env.LIBRARIAN_OFFLINE) || isLocalOnlyModeEnabled(env);
}

export function isNetworkAccessDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isOfflineModeEnabled(env) || isLocalOnlyModeEnabled(env);
}

export function isTelemetryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env.LIBRARIAN_NO_TELEMETRY) || isLocalOnlyModeEnabled(env);
}
