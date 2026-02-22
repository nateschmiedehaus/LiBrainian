import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function emitJsonOutput(payload: unknown, outPath?: string): Promise<void> {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (!outPath) {
    console.log(json.trimEnd());
    return;
  }

  const resolved = path.resolve(outPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, json, 'utf8');
  process.stderr.write(`JSON written to ${resolved}\n`);
}
