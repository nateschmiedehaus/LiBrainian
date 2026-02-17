import path from 'node:path';
import { initializeLibrarian } from '../src/index.js';

async function main() {
  const workspace = path.resolve(process.argv[2] ?? process.cwd());
  const intent =
    process.argv.slice(3).join(' ').trim() ||
    'How is bootstrap recovery implemented and validated?';

  console.log(`[example] workspace: ${workspace}`);
  console.log(`[example] intent: ${intent}`);

  const session = await initializeLibrarian(workspace, {
    reuseExistingSession: true,
  });

  try {
    const context = await session.query(intent);
    const health = session.health();

    console.log('\n=== LiBrainian Query Result ===');
    console.log(`summary: ${context.summary}`);
    console.log(`confidence: ${(context.confidence * 100).toFixed(1)}%`);
    console.log(`related files: ${context.relatedFiles.slice(0, 8).join(', ') || '(none)'}`);
    console.log(`pack ids: ${context.packIds.slice(0, 8).join(', ') || '(none)'}`);
    console.log(`status: ${health.status}`);
  } finally {
    await session.shutdown();
  }
}

main().catch((error) => {
  console.error('[example] quickstart_programmatic failed');
  console.error(error);
  process.exit(1);
});
