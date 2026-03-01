import { describe, expect, it } from 'vitest';
import { __testing } from '../cli_llm_service.js';

describe('cli_llm_service codex error normalization', () => {
  it('does not override meaningful codex failures when state-db warnings are also present', () => {
    const raw = [
      '2026-03-01T03:04:53Z WARN codex_state::runtime: failed to open state db at /tmp/state.sqlite: migration 11 was previously applied but is missing in the resolved migrations',
      'Error: output schema validation failed',
    ].join('\n');

    const normalized = __testing.normalizeCodexErrorMessage(raw);
    const sanitized = __testing.sanitizeCliErrorMessage(normalized, 'codex');

    expect(normalized).toBe(raw);
    expect(sanitized).toContain('output schema validation failed');
  });

  it('returns dedicated migration remediation when mismatch warning is the only meaningful error', () => {
    const raw = [
      '2026-03-01T03:04:53Z WARN codex_state::runtime: failed to open state db at /tmp/state.sqlite: migration 11 was previously applied but is missing in the resolved migrations',
      '2026-03-01T03:04:53Z WARN codex_core::state_db: state db record_discrepancy: find_thread_path_by_id_str_in_subdir, falling_back',
    ].join('\n');

    const normalized = __testing.normalizeCodexErrorMessage(raw);

    expect(normalized).toBe(
      'Codex CLI state DB migration mismatch. Update/reset CODEX_HOME state or run `codex login` again.'
    );
  });
});

