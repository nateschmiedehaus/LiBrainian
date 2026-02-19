import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.js';
import { createSkillAuditConstruction } from '../../constructions/skill_audit.js';

export interface AuditSkillCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

export async function auditSkillCommand(options: AuditSkillCommandOptions): Promise<void> {
  const { args, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const json = Boolean(values.json);
  const skillPathArg = args[0];
  if (!skillPathArg || skillPathArg.trim().length === 0) {
    throw new CliError('Missing SKILL.md path. Usage: librarian audit-skill <path-to-SKILL.md>', 'INVALID_ARGUMENT');
  }

  const skillPath = path.resolve(options.workspace, skillPathArg);
  let content: string;
  try {
    content = await fs.readFile(skillPath, 'utf8');
  } catch (error) {
    throw new CliError(
      `Failed to read skill file ${skillPath}: ${error instanceof Error ? error.message : String(error)}`,
      'INVALID_ARGUMENT',
    );
  }

  const result = await createSkillAuditConstruction().audit({
    skillContent: content,
    skillPath,
    workdir: options.workspace,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('librarian skill audit');
  console.log('====================\n');
  console.log(`Skill: ${skillPath}`);
  console.log(`Risk score: ${result.riskScore}/100`);
  console.log(`Verdict: ${result.verdict.toUpperCase()}`);
  if (typeof result.cvssScore === 'number') {
    console.log(`CVSS: ${result.cvssScore.toFixed(1)}`);
  }
  console.log('');

  if (result.maliciousPatterns.length > 0) {
    console.log('Findings:');
    for (const finding of result.maliciousPatterns) {
      console.log(`  [${finding.severity.toUpperCase()}] ${finding.type} @ ${finding.location}`);
      console.log(`    -> ${finding.description}`);
      console.log(`    -> ${finding.evidence}`);
    }
    console.log('');
  } else {
    console.log('Findings: none\n');
  }

  console.log(`Recommendation: ${result.recommendation}`);
}
