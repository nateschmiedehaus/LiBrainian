import { getConstructableClassificationMap } from '../constructions/constructable_registry.js';

export const CONSTRUCTION_TO_CLASSIFICATION_MAP: Record<string, string> =
  getConstructableClassificationMap() as Record<string, string>;

export function isConstructionEnabled(
  constructionId: string,
  enabledConstructables: string[] | undefined
): boolean {
  if (enabledConstructables === undefined) {
    return true;
  }
  return enabledConstructables.includes(constructionId);
}

export function getConstructionIdFromClassification<TClassification extends string>(
  classificationFlag: TClassification,
  constructionToClassification: Record<string, TClassification>
): string | undefined {
  for (const [constructionId, flag] of Object.entries(constructionToClassification)) {
    if (flag === classificationFlag) {
      return constructionId;
    }
  }
  return undefined;
}
