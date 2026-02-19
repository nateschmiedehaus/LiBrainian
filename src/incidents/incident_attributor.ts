import { normalizeIncidentFilePath } from './file_path_normalizer.js';
import {
  createFunctionRangeMapper,
  type FunctionRangeMapperDeps,
  type IndexedFunctionRange,
} from './function_range_mapper.js';
import { parseStackTrace, type ParsedStackFrame } from './stack_frame_parser.js';

export type { IndexedFunctionRange } from './function_range_mapper.js';

export interface IncidentAttributorDeps extends FunctionRangeMapperDeps {
  workspaceRoot: string;
}

export interface IncidentAttributionInput {
  stackTrace: string;
}

export interface IncidentFrameAttribution extends ParsedStackFrame {
  functionIds: string[];
}

export interface IncidentAttributionSummary {
  parsedFrameCount: number;
  normalizedFrameCount: number;
  attributedFrameCount: number;
  unattributedFrameCount: number;
}

export interface IncidentAttributionReport {
  frames: IncidentFrameAttribution[];
  functionIds: string[];
  summary: IncidentAttributionSummary;
}

export interface IncidentAttributor {
  attributeIncident(input: IncidentAttributionInput): Promise<IncidentAttributionReport>;
}

export function createIncidentAttributor(deps: IncidentAttributorDeps): IncidentAttributor {
  return new DefaultIncidentAttributor(deps);
}

class DefaultIncidentAttributor implements IncidentAttributor {
  private readonly workspaceRoot: string;
  private readonly functionMapper;

  constructor(deps: IncidentAttributorDeps) {
    this.workspaceRoot = deps.workspaceRoot;
    const mapperDeps: FunctionRangeMapperDeps = {
      getFunctionsByPath: deps.getFunctionsByPath,
    };
    this.functionMapper = createFunctionRangeMapper(mapperDeps);
  }

  async attributeIncident(input: IncidentAttributionInput): Promise<IncidentAttributionReport> {
    const parsedFrames = parseStackTrace(input.stackTrace);
    const normalizedFrames = parsedFrames
      .map((frame) => this.normalizeFrame(frame))
      .filter((frame): frame is ParsedStackFrame => frame !== null);

    const mapped = await this.functionMapper.mapFrames(normalizedFrames);
    const frames: IncidentFrameAttribution[] = mapped.map((entry) => ({
      ...entry.frame,
      functionIds: entry.functionIds,
    }));

    const attributedFrameCount = frames.filter((frame) => frame.functionIds.length > 0).length;
    const functionIds = Array.from(new Set(frames.flatMap((frame) => frame.functionIds))).sort((a, b) =>
      a.localeCompare(b)
    );

    return {
      frames,
      functionIds,
      summary: {
        parsedFrameCount: parsedFrames.length,
        normalizedFrameCount: normalizedFrames.length,
        attributedFrameCount,
        unattributedFrameCount: normalizedFrames.length - attributedFrameCount,
      },
    };
  }

  private normalizeFrame(frame: ParsedStackFrame): ParsedStackFrame | null {
    const normalizedFilePath = normalizeIncidentFilePath(frame.filePath, this.workspaceRoot);
    if (!normalizedFilePath) return null;

    return {
      ...frame,
      filePath: normalizedFilePath,
    };
  }
}
