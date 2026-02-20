import { describe, expect, it } from 'vitest';
import {
  isLocalOnlyModeEnabled,
  isOfflineModeEnabled,
  isPrivacyModeStrict,
  isNetworkAccessDisabled,
} from '../runtime_controls.js';

describe('runtime_controls', () => {
  it('treats LIBRARIAN_PRIVACY_MODE=strict as strict privacy', () => {
    const env = { LIBRARIAN_PRIVACY_MODE: 'strict' } as NodeJS.ProcessEnv;
    expect(isPrivacyModeStrict(env)).toBe(true);
    expect(isLocalOnlyModeEnabled(env)).toBe(true);
    expect(isOfflineModeEnabled(env)).toBe(true);
    expect(isNetworkAccessDisabled(env)).toBe(true);
  });

  it('does not enable strict mode for non-strict values', () => {
    const env = { LIBRARIAN_PRIVACY_MODE: 'warn' } as NodeJS.ProcessEnv;
    expect(isPrivacyModeStrict(env)).toBe(false);
  });
});
