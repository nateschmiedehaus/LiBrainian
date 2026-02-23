import { z } from 'zod';

export const OPERATIONAL_PROOF_BUNDLE_KIND = 'OperationalProofBundle.v1' as const;

export const OperationalProofBundleCheckSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  commandLine: z.string().min(1),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number().finite().nonnegative(),
  passed: z.boolean(),
  missingOutputSubstrings: z.array(z.string()),
  missingFilePaths: z.array(z.string()),
  stdout: z.string(),
  stderr: z.string(),
});

export const OperationalProofBundleSchema = z.object({
  kind: z.literal(OPERATIONAL_PROOF_BUNDLE_KIND),
  generatedAt: z.string().datetime({ offset: true }),
  source: z.string().min(1),
  passed: z.boolean(),
  failureCount: z.number().int().nonnegative(),
  checks: z.array(OperationalProofBundleCheckSchema).min(1),
});

export type OperationalProofBundleCheck = z.infer<typeof OperationalProofBundleCheckSchema>;
export type OperationalProofBundle = z.infer<typeof OperationalProofBundleSchema>;

export function parseOperationalProofBundle(value: unknown): OperationalProofBundle {
  return OperationalProofBundleSchema.parse(value);
}

export function createOperationalProofBundle(input: {
  source: string;
  checks: OperationalProofBundleCheck[];
  generatedAt?: string;
}): OperationalProofBundle {
  const failureCount = input.checks.filter((entry) => !entry.passed).length;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return parseOperationalProofBundle({
    kind: OPERATIONAL_PROOF_BUNDLE_KIND,
    generatedAt,
    source: input.source,
    passed: failureCount === 0,
    failureCount,
    checks: input.checks,
  });
}
