import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadPresets, savePresets } from '../preset_storage.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lcl-presets-'));
});

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe('preset storage', () => {
  it('returns defaults when presets file is missing', async () => {
    const presets = await loadPresets(tempDir);
    expect(presets.preset_quick_debug).toBeDefined();
  });

  it('persists presets to the workspace', async () => {
    const presets = {
      sample: {
        base: 'primitives',
        primitiveIds: ['tp_hypothesis'],
      },
    };
    await savePresets(presets, tempDir);
    const loaded = await loadPresets(tempDir);
    expect(loaded.sample.base).toBe('primitives');
    expect(loaded.sample.primitiveIds).toEqual(['tp_hypothesis']);
  });

  it('throws when presets JSON is invalid', async () => {
    const filePath = path.join(tempDir, '.librainian', 'presets.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{not json', 'utf8');
    await expect(loadPresets(tempDir)).rejects.toThrow('unverified_by_trace(preset_parse_failed)');
  });
});
