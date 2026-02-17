import path from 'node:path';
import { initializeLibrarian } from '../src/index.js';

async function main() {
  const workspace = path.resolve(process.argv[2] ?? process.cwd());
  const intent =
    process.argv.slice(3).join(' ').trim() ||
    'Fix a flaky test around bootstrap recovery lock handling';

  const session = await initializeLibrarian(workspace, {
    reuseExistingSession: true,
  });

  try {
    console.log(`[agentic-loop] intent: ${intent}`);
    const context = await session.query(intent, {
      taskType: 'bug_fix',
    });

    console.log('\n=== Context Summary ===');
    console.log(context.summary);
    console.log('\n=== Suggested Files ===');
    for (const file of context.relatedFiles.slice(0, 10)) {
      console.log(`- ${file}`);
    }

    console.log('\n=== Simulated Agent Work ===');
    console.log('Perform code edits + verification here, then record outcome.');

    await session.recordOutcome({
      success: true,
      packIds: context.packIds,
      filesModified: context.relatedFiles.slice(0, 2),
      intent,
      taskId: `example-${Date.now()}`,
    });

    console.log('[agentic-loop] outcome recorded');
  } finally {
    await session.shutdown();
  }
}

main().catch((error) => {
  console.error('[example] agentic_task_loop failed');
  console.error(error);
  process.exit(1);
});
