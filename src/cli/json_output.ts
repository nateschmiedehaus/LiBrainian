import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function writeStdoutFully(text: string): Promise<void> {
  if (process.stdout.write(text)) return;
  await new Promise<void>((resolve) => {
    process.stdout.once('drain', resolve);
  });
}

export async function emitJsonOutput(payload: unknown, outPath?: string): Promise<void> {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (!outPath) {
    await writeStdoutFully(json);
    return;
  }

  const resolved = path.resolve(outPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, json, 'utf8');
  process.stderr.write(`JSON written to ${resolved}\n`);
}
