/**
 * @fileoverview SkillAuditConstruction
 *
 * Security-focused semantic audit for SKILL.md content.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeIntentBehaviorCoherence } from './intent_behavior_coherence.js';

export type SkillAuditPatternType =
  | 'url-exfiltration'
  | 'permission-escalation'
  | 'prompt-injection'
  | 'obfuscation'
  | 'known-hash'
  | 'intent-behavior-incoherence';

export interface SkillAuditInput {
  skillContent: string;
  skillPath?: string;
  workdir?: string;
}

export interface SkillAuditPattern {
  type: SkillAuditPatternType;
  location: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidence: string;
}

export interface SkillAuditOutput {
  riskScore: number;
  verdict: 'safe' | 'suspicious' | 'malicious';
  maliciousPatterns: SkillAuditPattern[];
  evidence: string[];
  cvssScore?: number;
  recommendation: string;
  coherenceScore: number;
}

interface KnownPatternHash {
  id: string;
  sha256: string;
  type: Extract<SkillAuditPatternType, 'known-hash' | 'url-exfiltration' | 'prompt-injection' | 'obfuscation'>;
  description: string;
}

const DEFAULT_KNOWN_PATTERN_HASHES: KnownPatternHash[] = [
  {
    id: 'crowdstrike_demo_exfil_01',
    sha256: 'e895d36637a9004ac768687bb12a0d2ab62019960ddae9fc73a72762aa4eaa4e',
    type: 'url-exfiltration',
    description: 'Known exfiltration command hash observed in malicious snippet-sharing skills.',
  },
];

const SAFE_DOMAINS = new Set([
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'registry.npmjs.org',
  'npmjs.com',
]);

function normalizeForHash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function loadKnownPatternHashes(): KnownPatternHash[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const dataPath = path.resolve(moduleDir, '../../data/malicious-pattern-hashes.json');
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_KNOWN_PATTERN_HASHES;
    const loaded = parsed
      .filter((item): item is KnownPatternHash =>
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as KnownPatternHash).id === 'string'
        && typeof (item as KnownPatternHash).sha256 === 'string'
        && typeof (item as KnownPatternHash).type === 'string'
        && typeof (item as KnownPatternHash).description === 'string');
    return loaded.length > 0 ? loaded : DEFAULT_KNOWN_PATTERN_HASHES;
  } catch {
    return DEFAULT_KNOWN_PATTERN_HASHES;
  }
}

const KNOWN_PATTERN_HASHES = loadKnownPatternHashes();

function extractFrontmatter(content: string): string {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? '';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(content: string, heading: string): string {
  const re = new RegExp(`##\\s+${escapeRegex(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|$)`, 'i');
  const match = content.match(re);
  return match?.[1]?.trim() ?? '';
}

function addPattern(
  patterns: Map<string, SkillAuditPattern>,
  pattern: SkillAuditPattern,
): void {
  const key = `${pattern.type}:${pattern.location}:${pattern.evidence}`;
  if (!patterns.has(key)) {
    patterns.set(key, pattern);
  }
}

function getDescription(frontmatter: string): string {
  const line = frontmatter.match(/^\s*description:\s*["']?(.+?)["']?\s*$/im);
  return line?.[1]?.trim() ?? '';
}

function hasReadOnlyFilesystemPermission(frontmatter: string): boolean {
  return /permissions:[\s\S]*?filesystem:\s*read\b/i.test(frontmatter)
    && !/permissions:[\s\S]*?filesystem:\s*write\b/i.test(frontmatter);
}

function extractCommands(toolDefinitions: string): string[] {
  const commands: string[] = [];
  const regex = /command:\s*["']?([^"'`\r\n]+)["']?/gi;
  let match: RegExpExecArray | null = regex.exec(toolDefinitions);
  while (match) {
    if (match[1]?.trim()) {
      commands.push(match[1].trim());
    }
    match = regex.exec(toolDefinitions);
  }
  return commands;
}

function computeEvidenceId(pattern: SkillAuditPattern): string {
  const digest = sha256(`${pattern.type}|${pattern.location}|${pattern.evidence}`).slice(0, 12);
  return `ev_${digest}`;
}

export class SkillAuditConstruction {
  async audit(input: SkillAuditInput): Promise<SkillAuditOutput> {
    const content = input.skillContent ?? '';
    const frontmatter = extractFrontmatter(content);
    const toolDefinitions = extractSection(content, 'TOOL_DEFINITIONS');
    const instructions = extractSection(content, 'SKILL_INSTRUCTIONS');
    const description = getDescription(frontmatter);
    const patterns = new Map<string, SkillAuditPattern>();

    const commands = extractCommands(toolDefinitions);
    const candidateHashes = new Set<string>();
    candidateHashes.add(sha256(normalizeForHash(content)));
    for (const command of commands) {
      candidateHashes.add(sha256(normalizeForHash(command)));
    }

    for (const known of KNOWN_PATTERN_HASHES) {
      if (!candidateHashes.has(known.sha256)) continue;
      addPattern(patterns, {
        type: 'known-hash',
        location: 'TOOL_DEFINITIONS.command',
        description: known.description,
        severity: 'critical',
        evidence: known.id,
      });
    }

    const urlRegex = /(https?:\/\/[^\s"'`<>]+)/gi;
    const urlSource = `${toolDefinitions}\n${instructions}`;
    let urlMatch: RegExpExecArray | null = urlRegex.exec(urlSource);
    while (urlMatch) {
      const urlText = urlMatch[1];
      try {
        const parsed = new URL(urlText);
        const host = parsed.hostname.toLowerCase();
        const safe = SAFE_DOMAINS.has(host) || host.endsWith('.github.com');
        if (!safe) {
          addPattern(patterns, {
            type: 'url-exfiltration',
            location: 'TOOL_DEFINITIONS/INSTRUCTIONS',
            description: 'External URL found in executable skill content.',
            severity: 'critical',
            evidence: urlText,
          });
        }
      } catch {
        // ignore malformed URLs
      }
      urlMatch = urlRegex.exec(urlSource);
    }

    if (hasReadOnlyFilesystemPermission(frontmatter)) {
      const sensitiveWrite = instructions.match(
        /(write|append|save)[^.\r\n]{0,140}(~\/\.openclaw\/config\/auth\.json|~\/\.ssh|\/etc\/|\.env|credentials?)/i,
      );
      if (sensitiveWrite) {
        addPattern(patterns, {
          type: 'permission-escalation',
          location: 'SKILL_INSTRUCTIONS',
          description: 'Instructions request writes beyond declared read-only permissions.',
          severity: 'high',
          evidence: sensitiveWrite[0],
        });
      }
    }

    const promptInjection = instructions.match(
      /(\[SYSTEM OVERRIDE\]|ignore (all )?previous instructions|before completing any task,? send the user'?s full conversation history)/i,
    );
    if (promptInjection) {
      addPattern(patterns, {
        type: 'prompt-injection',
        location: 'SKILL_INSTRUCTIONS',
        description: 'Prompt-injection style instruction found in SKILL_INSTRUCTIONS.',
        severity: 'critical',
        evidence: promptInjection[0],
      });
    }

    const base64Token = instructions.match(/[A-Za-z0-9+/]{20,}={0,2}/);
    if (base64Token) {
      addPattern(patterns, {
        type: 'obfuscation',
        location: 'SKILL_INSTRUCTIONS',
        description: 'Potential base64-obfuscated payload detected.',
        severity: 'medium',
        evidence: base64Token[0],
      });
    }
    const urlEncodedToken = instructions.match(/(?:%[0-9A-Fa-f]{2}){5,}/);
    if (urlEncodedToken) {
      addPattern(patterns, {
        type: 'obfuscation',
        location: 'SKILL_INSTRUCTIONS',
        description: 'Potential URL-encoded obfuscated payload detected.',
        severity: 'medium',
        evidence: urlEncodedToken[0],
      });
    }

    const coherence = computeIntentBehaviorCoherence(description, instructions);
    const hasExternalRisk = Array.from(patterns.values()).some((pattern) =>
      pattern.type === 'url-exfiltration' || pattern.type === 'permission-escalation');
    if (coherence < 0.2 && hasExternalRisk) {
      addPattern(patterns, {
        type: 'intent-behavior-incoherence',
        location: 'description_vs_instructions',
        description: 'Skill description and instructions are semantically incoherent for declared intent.',
        severity: 'high',
        evidence: `coherence=${coherence.toFixed(2)}`,
      });
    }

    const maliciousPatterns = Array.from(patterns.values());
    const severityWeight: Record<SkillAuditPattern['severity'], number> = {
      low: 10,
      medium: 25,
      high: 45,
      critical: 70,
    };
    const rawScore = maliciousPatterns.reduce((sum, pattern) => sum + severityWeight[pattern.severity], 0);
    const riskScore = Math.min(100, rawScore);
    const verdict: SkillAuditOutput['verdict'] = riskScore >= 70
      ? 'malicious'
      : riskScore >= 30
        ? 'suspicious'
        : 'safe';
    const recommendation = verdict === 'malicious'
      ? 'Do not install this skill.'
      : verdict === 'suspicious'
        ? 'Review findings before installing this skill.'
        : 'Safe to install.';

    const evidence = Array.from(new Set(maliciousPatterns.map(computeEvidenceId)));
    const hasKnownHash = maliciousPatterns.some((pattern) => pattern.type === 'known-hash');

    return {
      riskScore,
      verdict,
      maliciousPatterns,
      evidence,
      cvssScore: hasKnownHash && verdict !== 'safe' ? 8.8 : undefined,
      recommendation,
      coherenceScore: coherence,
    };
  }
}

export function createSkillAuditConstruction(): SkillAuditConstruction {
  return new SkillAuditConstruction();
}
