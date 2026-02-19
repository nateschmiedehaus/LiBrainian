export type EvidenceConfidence = 'verified' | 'inferred';

export interface EvidenceRef {
  file: string;
  line: number;
  endLine?: number;
  snippet: string;
  claim: string;
  confidence: EvidenceConfidence;
  contentHash?: string;
  verifiedAt?: string;
  stale?: boolean;
}

export interface EvidenceEntry extends EvidenceRef {
  claimId: string;
  entityId: string;
  entityType: 'function' | 'module';
  createdAt: string;
}
