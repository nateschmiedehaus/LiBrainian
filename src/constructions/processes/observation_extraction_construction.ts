import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface ObservationExtractionInput {
  output: string;
  incrementalPrefix?: string;
  blockStart?: string;
  blockEnd?: string;
}

export interface ObservationExtractionOutput {
  incrementalObservations: Array<Record<string, unknown>>;
  fullObservation: Record<string, unknown> | null;
  parseWarnings: string[];
}

export function createObservationExtractionConstruction(): Construction<
  ObservationExtractionInput,
  ObservationExtractionOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'observation-extractor',
    name: 'Observation Extractor',
    description: 'Extracts incremental PATROL_OBS lines and full JSON observation blocks.',
    async execute(input: ObservationExtractionInput): Promise<ObservationExtractionOutput> {
      const prefix = input.incrementalPrefix ?? 'PATROL_OBS: ';
      const blockStart = input.blockStart ?? 'PATROL_OBSERVATION_JSON_START';
      const blockEnd = input.blockEnd ?? 'PATROL_OBSERVATION_JSON_END';
      const warnings: string[] = [];

      const incrementalObservations: Array<Record<string, unknown>> = [];
      for (const line of input.output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(prefix)) continue;
        const raw = trimmed.slice(prefix.length).trim();
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            incrementalObservations.push(parsed as Record<string, unknown>);
          }
        } catch (error) {
          warnings.push(`incremental_parse_failed:${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let fullObservation: Record<string, unknown> | null = null;
      const startIndex = input.output.indexOf(blockStart);
      const endIndex = input.output.indexOf(blockEnd);
      if (startIndex >= 0 && endIndex > startIndex) {
        const jsonBlock = input.output
          .slice(startIndex + blockStart.length, endIndex)
          .trim();
        if (jsonBlock) {
          try {
            const parsed = JSON.parse(jsonBlock);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              fullObservation = parsed as Record<string, unknown>;
            }
          } catch (error) {
            warnings.push(`full_parse_failed:${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      return {
        incrementalObservations,
        fullObservation,
        parseWarnings: warnings,
      };
    },
  };
}
