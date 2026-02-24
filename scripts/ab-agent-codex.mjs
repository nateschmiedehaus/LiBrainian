import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const workspaceRoot = process.env.AB_HARNESS_WORKSPACE_ROOT ?? process.cwd();
const workerType = process.env.AB_HARNESS_WORKER_TYPE ?? 'unknown';
const taskId = process.env.AB_HARNESS_TASK_ID ?? 'unknown-task';
const defaultModel = workerType === 'treatment'
  ? (process.env.AB_HARNESS_TREATMENT_CODEX_MODEL?.trim() || 'gpt-5-codex')
  : (process.env.AB_HARNESS_CONTROL_CODEX_MODEL?.trim() || 'gpt-5');
const model = process.env.AB_HARNESS_CODEX_MODEL?.trim() || defaultModel;
const codexBin = process.env.AB_HARNESS_CODEX_BIN?.trim() || 'codex';
const agentTimeoutMs = Number(process.env.AB_HARNESS_AGENT_TIMEOUT_MS);
const defaultPromptFile = process.env.AB_HARNESS_PROMPT_FILE;
const taskFile = process.env.AB_HARNESS_TASK_FILE;
const contextFile = process.env.AB_HARNESS_CONTEXT_FILE;
const promptMaxChars = Number(process.env.AB_HARNESS_PROMPT_MAX_CHARS);
const excerptMaxChars = Number(process.env.AB_HARNESS_EXCERPT_MAX_CHARS);
const childOutputMaxChars = Number(process.env.AB_HARNESS_CHILD_OUTPUT_MAX_CHARS);
const includeTreatmentExcerpts = process.env.AB_HARNESS_INCLUDE_EXCERPTS === '1';
const acceptanceCommandsRaw = process.env.AB_HARNESS_ACCEPTANCE_COMMANDS ?? '';
const reasoningEffortRaw = process.env.AB_HARNESS_CODEX_REASONING_EFFORT?.trim().toLowerCase();

const PROMPT_MAX_CHARS = Number.isFinite(promptMaxChars) && promptMaxChars > 0 ? promptMaxChars : 24_000;
const EXCERPT_MAX_CHARS = Number.isFinite(excerptMaxChars) && excerptMaxChars > 0 ? excerptMaxChars : 1_200;
const CHILD_OUTPUT_MAX_CHARS = Number.isFinite(childOutputMaxChars) && childOutputMaxChars > 0 ? childOutputMaxChars : 200_000;
const ACCEPTANCE_COMMANDS = acceptanceCommandsRaw
  .split('\n')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)
  .slice(0, 4);
const defaultReasoningEffort = workerType === 'treatment' ? 'low' : 'medium';
const REASONING_EFFORT = reasoningEffortRaw && ['minimal', 'low', 'medium', 'high'].includes(reasoningEffortRaw)
  ? reasoningEffortRaw
  : defaultReasoningEffort;

function compactList(label, items, limit = 6) {
  return items.length > 0 ? `${label}\n${items.slice(0, limit).map((item) => `- ${item}`).join('\n')}` : `${label}\n(none)`;
}

function compactText(value, maxChars) {
  if (value.length <= maxChars) return value;
  const head = value.slice(0, maxChars);
  return `${head}\n...<truncated>`;
}

function excerptBlock(entries, maxItems = 4) {
  const usable = entries.filter((entry) =>
    typeof entry?.file === 'string'
    && typeof entry?.excerpt === 'string'
    && entry.excerpt.trim().length > 0
  ).slice(0, maxItems);
  if (usable.length === 0) return '(none)';
  return usable.map((entry) => [
    `### ${entry.file}`,
    '```',
    compactText(entry.excerpt, EXCERPT_MAX_CHARS),
    '```',
  ].join('\n')).join('\n\n');
}

async function readHarnessPromptFromArtifact() {
  if (!defaultPromptFile) return '';
  try {
    const value = await readFile(defaultPromptFile, 'utf8');
    return value.trim();
  } catch {
    return '';
  }
}

async function buildFallbackPrompt() {
  if (!taskFile) {
    throw new Error('missing_task_file');
  }

  const taskRaw = await readFile(taskFile, 'utf8');
  const parsedTask = JSON.parse(taskRaw);
  const task = parsedTask?.definition ?? parsedTask;
  const description = String(task?.description ?? '').trim();
  const targetFiles = Array.isArray(task?.targetFiles)
    ? task.targetFiles.map((value) => String(value)).filter(Boolean)
    : [];

  let baseContextFiles = [];
  let librarianContextFiles = [];
  let excerptEntries = [];
  if (contextFile) {
    const contextRaw = await readFile(contextFile, 'utf8');
    const parsedContext = JSON.parse(contextRaw);
    baseContextFiles = Array.isArray(parsedContext?.baseContextFiles)
      ? parsedContext.baseContextFiles.map((value) => String(value)).filter(Boolean)
      : [];
    librarianContextFiles = Array.isArray(parsedContext?.extraContextFiles)
      ? parsedContext.extraContextFiles.map((value) => String(value)).filter(Boolean)
      : [];
    excerptEntries = Array.isArray(parsedContext?.files)
      ? parsedContext.files.filter((entry) => entry?.source === 'librarian')
      : [];
  }

  return [
    `Task ID: ${taskId}`,
    `Bug report: ${description || 'No description provided.'}`,
    '',
    compactList('Acceptance target files (must modify at least one):', targetFiles, 6),
    '',
    workerType === 'treatment'
      ? compactList('Librarian-prioritized target hints:', targetFiles, 4)
      : 'No Librarian target hints are available in this run.',
    workerType === 'treatment'
      ? compactList('Librarian-retrieved file hints:', librarianContextFiles, 10)
      : compactList('Starting context files:', baseContextFiles, 4),
    workerType === 'treatment' && includeTreatmentExcerpts
      ? `Librarian context excerpts:\n${excerptBlock(excerptEntries)}`
      : null,
  ].filter(Boolean).join('\n\n').trim();
}

let promptContent = await readHarnessPromptFromArtifact();
if (promptContent && promptContent.length > PROMPT_MAX_CHARS) {
  promptContent = '';
  console.error(`prompt_artifact_ignored:oversized:${PROMPT_MAX_CHARS}`);
}
if (!promptContent) {
  try {
    promptContent = await buildFallbackPrompt();
  } catch (error) {
    console.error(`task_or_context_read_failed:${error instanceof Error ? error.message : String(error)}`);
    process.exit(3);
  }
}

if (!promptContent || !promptContent.trim()) {
  console.error('empty_prompt');
  process.exit(3);
}

promptContent = compactText(promptContent.trim(), PROMPT_MAX_CHARS);

const harnessInstructions = [
  'You are executing an objective A/B benchmark bug-fix task.',
  `Task ID: ${taskId}`,
  `Worker type: ${workerType}`,
  '',
  'Execution requirements:',
  '1) Implement the requested fix directly in the repository.',
  '2) Keep edits focused and minimal.',
  '3) Do not ask questions; act autonomously.',
  '4) Use only information from the prompt context and repository state.',
  '5) For treatment runs, prioritize files and excerpts under Librarian context before broad searching.',
  '6) Finish after applying the fix.',
  '7) Leave a concrete repository diff before exiting; do not report completion without an actual file change.',
  '8) Before finishing, confirm at least one changed source file and list explicit file paths.',
  '9) If git metadata is unavailable, report modified source files by explicit path.',
  '10) If git metadata is available, include `git diff --name-only` output as supporting evidence.',
  '11) Do not run additional validation commands (typecheck/build/lint/full-suite tests); harness verification is authoritative.',
  '12) Do not invoke `apply_patch` as a shell command; edit files directly via normal file operations/tools.',
  workerType === 'treatment'
    ? '13) Use Librarian hints as the primary localization path before broad searching; edit hinted files first.'
    : '13) No Librarian localization hints are available; localize via repo evidence and failing checks.',
  '14) Include a structured critique report in stdout between markers AB_AGENT_CRITIQUE_JSON_START and AB_AGENT_CRITIQUE_JSON_END.',
  '15) The critique JSON must include: summary, workOutcome, librarianEffectiveness, confidence, issues[], suggestions[].',
  '16) Critique must include both strengths and weaknesses from natural usage, including any LiBrainian package/API/CLI friction you observe.',
  '17) When possible, mention concrete evidence paths/commands behind each critique item.',
  ACCEPTANCE_COMMANDS.length > 0
    ? [
      'Acceptance command (required; run exactly one):',
      'You must execute one listed acceptance command and use it to validate your fix before finishing.',
      ...ACCEPTANCE_COMMANDS.map((command) => `- ${command}`),
    ].join('\n')
    : null,
  '',
  'Critique JSON template (emit exactly once at the end):',
  'AB_AGENT_CRITIQUE_JSON_START',
  '{"summary":"...", "workOutcome":"failed|partial|successful", "librarianEffectiveness":"poor|mixed|good|excellent", "confidence":0.0, "issues":[{"perspective":"correctness|relevance|context|tooling|reliability|productivity|other","severity":"low|medium|high|critical","title":"...","diagnosis":"...","recommendation":"..."}], "suggestions":["..."]}',
  'AB_AGENT_CRITIQUE_JSON_END',
  '',
  'Task prompt follows:',
].filter(Boolean).join('\n');

const fullPrompt = `${harnessInstructions}\n\n${promptContent.trim()}\n`;
const supportsProcessGroups = process.platform !== 'win32';
const args = [
  'exec',
  '--dangerously-bypass-approvals-and-sandbox',
  '--skip-git-repo-check',
  '--color',
  'never',
  '-c',
  `model_reasoning_effort="${REASONING_EFFORT}"`,
  '-m',
  model,
  '-C',
  workspaceRoot,
  '-',
];

const child = spawn(codexBin, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    CODEX_DISABLE_UPDATE_CHECK: '1',
  },
  detached: supportsProcessGroups,
});

const killChildTree = () => {
  if (child.killed) return;
  if (supportsProcessGroups && typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall back to direct child kill when process-group kill is unavailable.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // ignore
  }
};

const timeoutEnabled = Number.isFinite(agentTimeoutMs) && agentTimeoutMs > 0;
let timedOut = false;
const watchdog = timeoutEnabled
  ? setTimeout(() => {
    timedOut = true;
    console.error(`agent_timeout_ms_exceeded:${agentTimeoutMs}`);
    killChildTree();
  }, agentTimeoutMs)
  : null;

child.stdin.write(fullPrompt);
child.stdin.end();

const captureOutput = (stream, isStdout) => {
  if (!stream) return;
  let emittedOverflowMarker = false;
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    if (isStdout) {
      if (stdoutBuffer.length < CHILD_OUTPUT_MAX_CHARS) {
        const remaining = CHILD_OUTPUT_MAX_CHARS - stdoutBuffer.length;
        stdoutBuffer += text.slice(0, remaining);
      } else if (!emittedOverflowMarker) {
        stdoutBuffer += '\n...<stdout truncated>';
        emittedOverflowMarker = true;
      }
    } else if (stderrBuffer.length < CHILD_OUTPUT_MAX_CHARS) {
      const remaining = CHILD_OUTPUT_MAX_CHARS - stderrBuffer.length;
      stderrBuffer += text.slice(0, remaining);
    } else if (!emittedOverflowMarker) {
      stderrBuffer += '\n...<stderr truncated>';
      emittedOverflowMarker = true;
    }
  });
};

let stdoutBuffer = '';
let stderrBuffer = '';
captureOutput(child.stdout, true);
captureOutput(child.stderr, false);

let childError;
const exitCode = await new Promise((resolve) => {
  child.on('error', (error) => {
    childError = error;
  });
  child.on('close', (code) => resolve(code ?? 1));
});
if (watchdog) {
  clearTimeout(watchdog);
}

if (timedOut) {
  process.exit(124);
}
if (childError instanceof Error) {
  console.error(`codex_spawn_error:${childError.message}`);
  process.exit(1);
}

if (stdoutBuffer.length > 0) {
  process.stdout.write(stdoutBuffer);
}
if (stderrBuffer.length > 0) {
  process.stderr.write(stderrBuffer);
}

process.exit(exitCode);
