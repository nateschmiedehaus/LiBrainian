import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const taskFile = process.env.AB_HARNESS_TASK_FILE;
const workspaceRoot = process.env.AB_HARNESS_WORKSPACE_ROOT ?? process.cwd();

if (!taskFile) {
  console.error('missing_task_file');
  process.exit(2);
}

const raw = await readFile(taskFile, 'utf8');
const parsed = JSON.parse(raw);
const task = parsed?.definition ?? parsed;
const taskId = task?.id;

const fixes = {
  'srtd-bugfix-error-message-regression': {
    file: 'src/utils/getErrorMessage.ts',
    bad: 'return error instanceof Error ? error.name : String(error);',
    good: 'return error instanceof Error ? error.message : String(error);',
  },
  'srtd-bugfix-relative-time-threshold': {
    file: 'src/utils/formatTime.ts',
    bad: 'const JUST_NOW_THRESHOLD = 1;',
    good: 'const JUST_NOW_THRESHOLD = 5;',
  },
  'srtd-bugfix-relative-formatter-branch': {
    file: 'src/utils/formatTime.ts',
    bad: "    case 'relative':\n      return full(date);",
    good: "    case 'relative':\n      return relative(date);",
  },
  'srtd-bugfix-prompt-exit-classification': {
    file: 'src/utils/getErrorMessage.ts',
    bad: "return error instanceof Error && error.name === 'AbortError';",
    good: "return error instanceof Error && error.name === 'ExitPromptError';",
  },
  'srtd-bugfix-truncate-path-depth': {
    file: 'src/utils/formatPath.ts',
    badCandidates: [
      'const [parent, filename] = parts.slice(-3);',
      '  if (parts.length <= 3) {',
    ],
    good: 'const [parent, filename] = parts.slice(-2);',
  },
  'srtd-bugfix-dependency-parser-case': {
    file: 'src/utils/dependencyParser.ts',
    bad: '  const pattern = /^--[ \\t]*@depends-on:[ \\t]*([^\\n\\r]*)$/gm;',
    good: '  const pattern = /^--[ \\t]*@depends-on:[ \\t]*([^\\n\\r]*)$/gim;',
  },
  'srtd-bugfix-dependency-graph-case-resolution': {
    file: 'src/utils/dependencyGraph.ts',
    bad: '      const depPath = filenameToPath.get(dep);',
    good: '      const depPath = filenameToPath.get(dep.toLowerCase());',
  },
  'srtd-bugfix-topological-order-regression': {
    file: 'src/utils/dependencyGraph.ts',
    bad: '    result.unshift(node);',
    good: '    result.push(node);',
  },
  'srtd-bugfix-timestamp-increment-step': {
    file: 'src/utils/getNextTimestamp.ts',
    bad: '    const nextTimestamp = (BigInt(lastTimestamp) + 2n).toString();',
    good: '    const nextTimestamp = (BigInt(lastTimestamp) + 1n).toString();',
  },
  'srtd-bugfix-error-hint-mapping': {
    file: 'src/utils/errorHints.ts',
    bad: "  '42P01': 'Unknown database failure.',",
    good: "  '42P01': 'Table or view does not exist. Ensure the migration that creates it has run first.',",
  },
};

const fix = fixes[taskId];
if (!fix) {
  console.error(`unknown_task:${String(taskId ?? '')}`);
  process.exit(3);
}

const filePath = path.join(workspaceRoot, fix.file);
const content = await readFile(filePath, 'utf8');
const badCandidates = Array.isArray(fix.badCandidates)
  ? fix.badCandidates
  : typeof fix.bad === 'string'
    ? [fix.bad]
    : [];

if (content.includes(fix.good)) {
  process.exit(0);
}
const matchedBad = badCandidates.find((candidate) => content.includes(candidate));
if (!matchedBad) {
  console.error(`expected_mutation_not_found:${taskId}`);
  process.exit(4);
}

await writeFile(filePath, content.replace(matchedBad, fix.good), 'utf8');

const updated = await readFile(filePath, 'utf8');
if (!updated.includes(fix.good)) {
  console.error(`fix_not_applied:${taskId}`);
  process.exit(5);
}

console.log(`applied_fix:${taskId}:${fix.file}`);
