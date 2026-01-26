import type { LibrarianStorage } from '../storage/types.js';
import type { VerificationPlan } from '../strategic/verification_plan.js';
import type { AdequacyReport } from '../api/difficulty_detectors.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

type VerificationPlanRecord = VerificationPlan & {
  adequacyReport?: AdequacyReport | null;
};

type VerificationPlanState = {
  schema_version: 1;
  updatedAt: string;
  items: VerificationPlanRecord[];
};

const VERIFICATION_PLANS_KEY = 'librarian.verification_plans.v1';

export async function listVerificationPlans(
  storage: LibrarianStorage,
  options: { limit?: number } = {}
): Promise<VerificationPlan[]> {
  const records = await loadVerificationPlans(storage);
  const sorted = records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const limit = options.limit;
  const sliced = typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
  return sliced.map((item) => ({ ...item }));
}

export async function getVerificationPlan(
  storage: LibrarianStorage,
  id: string
): Promise<VerificationPlan | null> {
  const records = await loadVerificationPlans(storage);
  return records.find((item) => item.id === id) ?? null;
}

export async function saveVerificationPlan(
  storage: LibrarianStorage,
  plan: VerificationPlan,
  options: { adequacyReport?: AdequacyReport | null } = {}
): Promise<void> {
  const records = await loadVerificationPlans(storage);
  const next = records.filter((item) => item.id !== plan.id);
  next.push(normalizePlan(plan, options.adequacyReport));
  await writeVerificationPlans(storage, next);
}

export async function deleteVerificationPlan(
  storage: LibrarianStorage,
  id: string
): Promise<boolean> {
  const records = await loadVerificationPlans(storage);
  const next = records.filter((item) => item.id !== id);
  if (next.length === records.length) return false;
  await writeVerificationPlans(storage, next);
  return true;
}

function normalizePlan(
  plan: VerificationPlan,
  adequacyReport?: AdequacyReport | null
): VerificationPlanRecord {
  const createdAt = plan.createdAt ?? new Date().toISOString();
  const updatedAt = plan.updatedAt ?? createdAt;
  return { ...plan, createdAt, updatedAt, adequacyReport };
}

async function loadVerificationPlans(storage: LibrarianStorage): Promise<VerificationPlanRecord[]> {
  const raw = await storage.getState(VERIFICATION_PLANS_KEY);
  if (!raw) return [];
  const parsed = safeJsonParseSimple<VerificationPlanState>(raw);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map((item) => ({ ...item }));
}

async function writeVerificationPlans(
  storage: LibrarianStorage,
  items: VerificationPlanRecord[]
): Promise<void> {
  const payload: VerificationPlanState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    items,
  };
  await storage.setState(VERIFICATION_PLANS_KEY, JSON.stringify(payload));
}
