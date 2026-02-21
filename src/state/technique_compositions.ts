import type { LiBrainianStorage } from '../storage/types.js';
import type { TechniqueComposition } from '../strategic/techniques.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

type TechniqueCompositionState = {
  schema_version: 1;
  updatedAt: string;
  items: TechniqueComposition[];
};

const COMPOSITIONS_KEY = 'librarian.technique_compositions.v1';

export async function listTechniqueCompositions(
  storage: LiBrainianStorage
): Promise<TechniqueComposition[]> {
  const raw = await storage.getState(COMPOSITIONS_KEY);
  if (!raw) return [];
  const parsed = safeJsonParseSimple<TechniqueCompositionState>(raw);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map((item) => ({ ...item }));
}

export async function listTechniqueCompositionSummaries(
  storage: LiBrainianStorage
): Promise<Array<{ id: string; primitiveIds: string[] }>> {
  const items = await listTechniqueCompositions(storage);
  return items.map((composition) => ({
    id: composition.id,
    primitiveIds: [...composition.primitiveIds],
  }));
}

export async function getTechniqueComposition(
  storage: LiBrainianStorage,
  id: string
): Promise<TechniqueComposition | null> {
  const compositions = await listTechniqueCompositions(storage);
  return compositions.find((item) => item.id === id) ?? null;
}

export async function saveTechniqueComposition(
  storage: LiBrainianStorage,
  composition: TechniqueComposition
): Promise<void> {
  const compositions = await listTechniqueCompositions(storage);
  const next = compositions.filter((item) => item.id !== composition.id);
  next.push(composition);
  await writeCompositionState(storage, next);
}

export async function deleteTechniqueComposition(
  storage: LiBrainianStorage,
  id: string
): Promise<boolean> {
  const compositions = await listTechniqueCompositions(storage);
  const next = compositions.filter((item) => item.id !== id);
  if (next.length === compositions.length) return false;
  await writeCompositionState(storage, next);
  return true;
}

async function writeCompositionState(
  storage: LiBrainianStorage,
  items: TechniqueComposition[]
): Promise<void> {
  const payload: TechniqueCompositionState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    items,
  };
  await storage.setState(COMPOSITIONS_KEY, JSON.stringify(payload));
}
