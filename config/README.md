# Config

`config/` stores versioned configuration assets that gate evaluation and release
behavior.

## Expected Contents

- Canonical command policy (`canon.json`)
- Live-fire profile definitions
- Any other deterministic config required by CI and publish gates

## Rules

- Treat config changes as product changes (review carefully).
- Keep config files machine-readable and schema-stable.
- Avoid environment-specific or secret values in this directory.
