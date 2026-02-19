/**
 * @fileoverview ClawHub pre-submission audit helper.
 */

import { createSkillAuditConstruction, type SkillAuditOutput } from '../constructions/skill_audit.js';

export interface ClawhubAuditRequest {
  skillContent: string;
  submitterGithubHandle?: string;
}

export interface ClawhubAuditResponse {
  status: 'allow' | 'review' | 'blocked';
  riskScore: number;
  verdict: SkillAuditOutput['verdict'];
  recommendation: string;
  findings: SkillAuditOutput['maliciousPatterns'];
  evidence: string[];
}

export async function auditClawhubSkillSubmission(
  request: ClawhubAuditRequest,
): Promise<ClawhubAuditResponse> {
  const audit = await createSkillAuditConstruction().audit({
    skillContent: request.skillContent,
  });
  const status: ClawhubAuditResponse['status'] = audit.riskScore >= 70
    ? 'blocked'
    : audit.riskScore >= 30
      ? 'review'
      : 'allow';
  return {
    status,
    riskScore: audit.riskScore,
    verdict: audit.verdict,
    recommendation: audit.recommendation,
    findings: audit.maliciousPatterns,
    evidence: audit.evidence,
  };
}
