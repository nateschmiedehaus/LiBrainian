import type { LiBrainianStorage } from '../storage/types.js';
import type { TechniquePrimitive } from '../strategic/techniques.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

export interface InvalidTechniquePrimitiveRecord {
  id: string;
  reason: string;
  payload: unknown;
  recordedAt: string;
}

type TechniquePrimitiveState = {
  schema_version: 1;
  updatedAt: string;
  items: TechniquePrimitive[];
};

type InvalidPrimitiveState = {
  schema_version: 1;
  updatedAt: string;
  items: InvalidTechniquePrimitiveRecord[];
};

const PRIMITIVES_KEY = 'librarian.technique_primitives.v1';
const INVALID_PRIMITIVES_KEY = 'librarian.technique_primitives.invalid.v1';

export async function listTechniquePrimitives(
  storage: LiBrainianStorage,
  options: { allowInvalid?: boolean } = {}
): Promise<TechniquePrimitive[]> {
  const items = await loadPrimitiveState(storage);
  if (options.allowInvalid) return items;
  const invalidIds = new Set((await loadInvalidState(storage)).map((record) => record.id));
  return items.filter((item) => !invalidIds.has(item.id));
}

export async function listTechniquePrimitiveIds(
  storage: LiBrainianStorage,
  options: { allowInvalid?: boolean } = {}
): Promise<string[]> {
  const primitives = await listTechniquePrimitives(storage, options);
  return primitives.map((primitive) => primitive.id);
}

export async function getTechniquePrimitive(
  storage: LiBrainianStorage,
  id: string,
  options: { allowInvalid?: boolean } = {}
): Promise<TechniquePrimitive | null> {
  const primitives = await loadPrimitiveState(storage);
  const primitive = primitives.find((item) => item.id === id) ?? null;
  if (!primitive) return null;
  if (options.allowInvalid) return primitive;
  const invalidIds = new Set((await loadInvalidState(storage)).map((record) => record.id));
  return invalidIds.has(id) ? null : primitive;
}

export async function saveTechniquePrimitive(
  storage: LiBrainianStorage,
  primitive: TechniquePrimitive
): Promise<void> {
  const primitives = await loadPrimitiveState(storage);
  const next = primitives.filter((item) => item.id !== primitive.id);
  next.push(primitive);
  await writePrimitiveState(storage, next);
  await removeInvalidPrimitive(storage, primitive.id);
}

export async function deleteTechniquePrimitive(
  storage: LiBrainianStorage,
  id: string
): Promise<boolean> {
  const primitives = await loadPrimitiveState(storage);
  const next = primitives.filter((item) => item.id !== id);
  if (next.length === primitives.length) return false;
  await writePrimitiveState(storage, next);
  await removeInvalidPrimitive(storage, id);
  return true;
}

export async function listInvalidTechniquePrimitives(
  storage: LiBrainianStorage
): Promise<InvalidTechniquePrimitiveRecord[]> {
  return loadInvalidState(storage);
}

export async function clearInvalidTechniquePrimitives(storage: LiBrainianStorage): Promise<void> {
  await writeInvalidState(storage, []);
}

export async function recordInvalidTechniquePrimitive(
  storage: LiBrainianStorage,
  record: InvalidTechniquePrimitiveRecord
): Promise<void> {
  const records = await loadInvalidState(storage);
  const filtered = records.filter((entry) => entry.id !== record.id);
  filtered.push(record);
  await writeInvalidState(storage, filtered);
}

async function loadPrimitiveState(storage: LiBrainianStorage): Promise<TechniquePrimitive[]> {
  const raw = await storage.getState(PRIMITIVES_KEY);
  if (!raw) return [];
  const parsed = safeJsonParseSimple<TechniquePrimitiveState>(raw);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map((item) => ({ ...item }));
}

async function writePrimitiveState(storage: LiBrainianStorage, items: TechniquePrimitive[]): Promise<void> {
  const payload: TechniquePrimitiveState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    items,
  };
  await storage.setState(PRIMITIVES_KEY, JSON.stringify(payload));
}

async function loadInvalidState(storage: LiBrainianStorage): Promise<InvalidTechniquePrimitiveRecord[]> {
  const raw = await storage.getState(INVALID_PRIMITIVES_KEY);
  if (!raw) return [];
  const parsed = safeJsonParseSimple<InvalidPrimitiveState>(raw);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map((item) => ({ ...item }));
}

async function writeInvalidState(
  storage: LiBrainianStorage,
  items: InvalidTechniquePrimitiveRecord[]
): Promise<void> {
  const payload: InvalidPrimitiveState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    items,
  };
  await storage.setState(INVALID_PRIMITIVES_KEY, JSON.stringify(payload));
}

async function removeInvalidPrimitive(storage: LiBrainianStorage, id: string): Promise<void> {
  const records = await loadInvalidState(storage);
  const next = records.filter((record) => record.id !== id);
  if (next.length === records.length) return;
  await writeInvalidState(storage, next);
}
