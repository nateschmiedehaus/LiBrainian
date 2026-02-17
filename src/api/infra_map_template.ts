/**
 * @fileoverview T8 InfraMap Template Implementation
 *
 * WU-TMPL-008: T8 InfraMap Template
 *
 * Maps infrastructure components (K8s, Docker, Terraform, etc.) to services,
 * owners, and risk. Visualizes relationships between infrastructure elements
 * and identifies potential issues or misconfigurations.
 *
 * Key capabilities:
 * - Parse Kubernetes YAML files
 * - Parse Dockerfiles and docker-compose.yml
 * - Parse Terraform .tf files
 * - Parse Helm charts
 * - Build dependency graph
 * - Identify common issues (missing resources, circular deps, etc.)
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ContextPack } from '../types.js';
import type {
  ConstructionTemplate,
  TemplateContext,
  TemplateResult,
  TemplateSelectionEvidence,
} from './template_registry.js';
import {
  deterministic,
  sequenceConfidence,
  getEffectiveConfidence,
  type ConfidenceValue,
} from '../epistemics/confidence.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported infrastructure types.
 */
export type InfraType = 'kubernetes' | 'docker' | 'terraform' | 'helm' | 'auto';

/**
 * Input for InfraMap template execution.
 */
export interface InfraMapInput {
  /** Path to the repository */
  repoPath: string;
  /** Types of infrastructure to scan */
  infraTypes?: InfraType[];
  /** Whether to include secret values (default: false) */
  includeSecrets?: boolean;
}

/**
 * Component types in infrastructure.
 */
export type InfraComponentType =
  | 'deployment'
  | 'service'
  | 'configmap'
  | 'secret'
  | 'container'
  | 'volume'
  | 'resource';

/**
 * Represents an infrastructure component.
 */
export interface InfraComponent {
  /** Unique identifier */
  id: string;
  /** Type of component */
  type: InfraComponentType;
  /** Human-readable name */
  name: string;
  /** Kubernetes namespace (if applicable) */
  namespace?: string;
  /** Source file path */
  sourceFile: string;
  /** Component-specific properties */
  properties: Record<string, unknown>;
  /** IDs of components this depends on */
  dependencies: string[];
}

/**
 * Relationship types between components.
 */
export type InfraRelationshipType =
  | 'uses'
  | 'exposes'
  | 'mounts'
  | 'references'
  | 'depends_on';

/**
 * Represents a relationship between components.
 */
export interface InfraRelationship {
  /** Source component ID */
  fromId: string;
  /** Target component ID */
  toId: string;
  /** Type of relationship */
  type: InfraRelationshipType;
}

/**
 * Severity levels for infrastructure issues.
 */
export type InfraIssueSeverity = 'info' | 'warning' | 'error';

/**
 * Represents an identified infrastructure issue.
 */
export interface InfraIssue {
  /** Issue severity */
  severity: InfraIssueSeverity;
  /** Component ID affected */
  component: string;
  /** Issue description */
  message: string;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Parse result from individual file parsing.
 */
export interface InfraParseResult {
  /** Parsed components */
  components: InfraComponent[];
  /** Identified relationships */
  relationships: InfraRelationship[];
  /** Parse issues */
  issues: InfraIssue[];
}

/**
 * Graph representation of infrastructure.
 */
export interface InfraGraph {
  /** Graph nodes */
  nodes: Array<{ id: string; label: string; type: string }>;
  /** Graph edges */
  edges: Array<{ from: string; to: string; label: string }>;
}

/**
 * Output from InfraMap template execution.
 */
export interface InfraMapOutput {
  /** All discovered components */
  components: InfraComponent[];
  /** All relationships between components */
  relationships: InfraRelationship[];
  /** Identified issues */
  issues: InfraIssue[];
  /** Summary statistics */
  summary: {
    totalComponents: number;
    byType: Record<string, number>;
    namespaces: string[];
    issueCount: number;
  };
  /** Graph representation */
  graph: InfraGraph;
  /** Confidence in the analysis */
  confidence: ConfidenceValue;
}

/**
 * InfraMap template type alias.
 */
export type InfraMapTemplate = ConstructionTemplate;

// ============================================================================
// KUBERNETES PARSING
// ============================================================================

/**
 * Parse Kubernetes YAML content.
 *
 * @param content - YAML content
 * @param sourceFile - Source file path
 * @returns Parse result with components, relationships, and issues
 */
export function parseKubernetesYaml(content: string, sourceFile: string): InfraParseResult {
  const components: InfraComponent[] = [];
  const relationships: InfraRelationship[] = [];
  const issues: InfraIssue[] = [];

  try {
    // Split multi-document YAML
    const documents = content.split(/^---\s*$/m).filter(doc => doc.trim());

    for (const doc of documents) {
      const parsed = parseYamlDocument(doc);
      if (!parsed) continue;

      const kind = parsed.kind as string;
      const metadata = parsed.metadata as Record<string, unknown> | undefined;
      const name = (metadata?.name as string) || 'unnamed';
      const namespace = (metadata?.namespace as string) || undefined;
      const spec = parsed.spec as Record<string, unknown> | undefined;

      const componentType = mapK8sKindToComponentType(kind);
      const id = `${componentType}:${name}`;

      const component: InfraComponent = {
        id,
        type: componentType,
        name,
        namespace,
        sourceFile,
        properties: {},
        dependencies: [],
      };

      // Extract type-specific properties
      switch (kind?.toLowerCase()) {
        case 'deployment':
        case 'statefulset':
        case 'daemonset':
          extractDeploymentInfo(component, spec);
          break;
        case 'service':
          extractServiceInfo(component, spec);
          break;
        case 'configmap':
          extractConfigMapInfo(component, parsed.data as Record<string, unknown> | undefined);
          break;
        case 'secret':
          extractSecretInfo(component, parsed.data as Record<string, unknown> | undefined);
          break;
      }

      components.push(component);
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      component: sourceFile,
      message: `Failed to parse Kubernetes YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Build relationships from dependencies
  for (const comp of components) {
    for (const dep of comp.dependencies) {
      relationships.push({
        fromId: comp.id,
        toId: dep,
        type: 'references',
      });
    }
  }

  return { components, relationships, issues };
}

/**
 * Map Kubernetes kind to component type.
 */
function mapK8sKindToComponentType(kind: string): InfraComponentType {
  const kindLower = kind?.toLowerCase() || '';
  switch (kindLower) {
    case 'deployment':
    case 'statefulset':
    case 'daemonset':
    case 'replicaset':
      return 'deployment';
    case 'service':
    case 'ingress':
      return 'service';
    case 'configmap':
      return 'configmap';
    case 'secret':
      return 'secret';
    case 'persistentvolumeclaim':
    case 'persistentvolume':
      return 'volume';
    default:
      return 'resource';
  }
}

/**
 * Extract deployment-specific information.
 */
function extractDeploymentInfo(component: InfraComponent, spec: Record<string, unknown> | undefined): void {
  if (!spec) return;

  const template = spec.template as Record<string, unknown> | undefined;
  const templateSpec = template?.spec as Record<string, unknown> | undefined;
  const containers = templateSpec?.containers as Array<Record<string, unknown>> | undefined;
  const volumes = templateSpec?.volumes as Array<Record<string, unknown>> | undefined;

  if (containers) {
    component.properties.containers = containers.map(c => ({
      name: c.name,
      image: c.image,
      resources: c.resources,
    }));

    // Extract dependencies from volume mounts
    const volumeMounts: Array<{ name: string; mountPath: string }> = [];
    for (const container of containers) {
      const mounts = container.volumeMounts as Array<Record<string, unknown>> | undefined;
      if (mounts) {
        for (const mount of mounts) {
          volumeMounts.push({
            name: mount.name as string,
            mountPath: mount.mountPath as string,
          });
        }
      }
    }
    if (volumeMounts.length > 0) {
      component.properties.volumeMounts = volumeMounts;
    }
  }

  // Extract dependencies from volumes
  if (volumes) {
    for (const vol of volumes) {
      if (vol.configMap) {
        const cmName = (vol.configMap as Record<string, unknown>).name as string;
        component.dependencies.push(`configMap:${cmName}`);
      }
      if (vol.secret) {
        const secretName = (vol.secret as Record<string, unknown>).secretName as string;
        component.dependencies.push(`secret:${secretName}`);
      }
    }
  }
}

/**
 * Extract service-specific information.
 */
function extractServiceInfo(component: InfraComponent, spec: Record<string, unknown> | undefined): void {
  if (!spec) return;

  component.properties.selector = spec.selector;
  component.properties.type = spec.type || 'ClusterIP';
  component.properties.ports = spec.ports;
}

/**
 * Extract ConfigMap information.
 */
function extractConfigMapInfo(component: InfraComponent, data: Record<string, unknown> | undefined): void {
  if (!data) {
    component.properties.keys = [];
    return;
  }
  component.properties.keys = Object.keys(data);
}

/**
 * Extract Secret information.
 */
function extractSecretInfo(component: InfraComponent, data: Record<string, unknown> | undefined): void {
  if (!data) {
    component.properties.keys = [];
    return;
  }
  // Only store keys, never values
  component.properties.keys = Object.keys(data);
}

// ============================================================================
// DOCKERFILE PARSING
// ============================================================================

/**
 * Parse Dockerfile content.
 *
 * @param content - Dockerfile content
 * @param sourceFile - Source file path
 * @returns Parse result with components, relationships, and issues
 */
export function parseDockerfile(content: string, sourceFile: string): InfraParseResult {
  const components: InfraComponent[] = [];
  const relationships: InfraRelationship[] = [];
  const issues: InfraIssue[] = [];

  const lines = content.split('\n');
  let currentStage: InfraComponent | null = null;
  let stageIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse FROM instruction
    const fromMatch = trimmed.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (fromMatch) {
      const baseImage = fromMatch[1];
      const stageName = fromMatch[2] || `stage_${stageIndex}`;

      // Save previous stage
      if (currentStage) {
        components.push(currentStage);
      }

      currentStage = {
        id: `container:${stageName}`,
        type: 'container',
        name: stageName,
        sourceFile,
        properties: {
          baseImage,
          stage: stageName,
          envVars: [] as string[],
          buildArgs: [] as string[],
          exposedPorts: [] as number[],
          hasHealthcheck: false,
        },
        dependencies: [],
      };

      stageIndex++;
      continue;
    }

    if (!currentStage) {
      // Handle FROM instruction missing at start
      issues.push({
        severity: 'error',
        component: sourceFile,
        message: 'Dockerfile does not start with FROM instruction',
      });
      continue;
    }

    // Parse ENV instruction
    const envMatch = trimmed.match(/^ENV\s+(\S+)/i);
    if (envMatch) {
      (currentStage.properties.envVars as string[]).push(envMatch[1].split('=')[0]);
      continue;
    }

    // Parse ARG instruction
    const argMatch = trimmed.match(/^ARG\s+(\S+)/i);
    if (argMatch) {
      (currentStage.properties.buildArgs as string[]).push(argMatch[1].split('=')[0]);
      continue;
    }

    // Parse EXPOSE instruction
    const exposeMatch = trimmed.match(/^EXPOSE\s+(\d+)/i);
    if (exposeMatch) {
      (currentStage.properties.exposedPorts as number[]).push(parseInt(exposeMatch[1], 10));
      continue;
    }

    // Parse HEALTHCHECK instruction
    if (trimmed.match(/^HEALTHCHECK/i)) {
      currentStage.properties.hasHealthcheck = true;
      continue;
    }

    // Parse COPY --from for multi-stage builds
    const copyFromMatch = trimmed.match(/^COPY\s+--from=(\S+)/i);
    if (copyFromMatch) {
      const fromStage = copyFromMatch[1];
      currentStage.dependencies.push(`container:${fromStage}`);
      relationships.push({
        fromId: currentStage.id,
        toId: `container:${fromStage}`,
        type: 'uses',
      });
    }
  }

  // Don't forget the last stage
  if (currentStage) {
    components.push(currentStage);
  }

  return { components, relationships, issues };
}

// ============================================================================
// DOCKER-COMPOSE PARSING
// ============================================================================

/**
 * Parse docker-compose.yml content.
 *
 * @param content - YAML content
 * @param sourceFile - Source file path
 * @returns Parse result with components, relationships, and issues
 */
export function parseDockerCompose(content: string, sourceFile: string): InfraParseResult {
  const components: InfraComponent[] = [];
  const relationships: InfraRelationship[] = [];
  const issues: InfraIssue[] = [];

  try {
    const parsed = parseYamlDocument(content);
    if (!parsed) return { components, relationships, issues };

    const services = parsed.services as Record<string, Record<string, unknown>> | undefined;
    const volumes = parsed.volumes as Record<string, unknown> | undefined;
    const networks = parsed.networks as Record<string, unknown> | undefined;

    // Parse services
    if (services) {
      for (const [serviceName, serviceConfig] of Object.entries(services)) {
        const component: InfraComponent = {
          id: `service:${serviceName}`,
          type: 'service',
          name: serviceName,
          sourceFile,
          properties: {
            image: serviceConfig.image,
            build: serviceConfig.build,
            ports: serviceConfig.ports,
            environment: serviceConfig.environment,
            volumes: serviceConfig.volumes,
            networks: serviceConfig.networks,
          },
          dependencies: [],
        };

        // Extract depends_on
        const dependsOn = serviceConfig.depends_on as string[] | Record<string, unknown> | undefined;
        if (dependsOn) {
          const deps = Array.isArray(dependsOn) ? dependsOn : Object.keys(dependsOn);
          for (const dep of deps) {
            component.dependencies.push(`service:${dep}`);
            relationships.push({
              fromId: `service:${serviceName}`,
              toId: `service:${dep}`,
              type: 'depends_on',
            });
          }
        }

        components.push(component);
      }
    }

    // Parse volumes
    if (volumes) {
      for (const volumeName of Object.keys(volumes)) {
        components.push({
          id: `volume:${volumeName}`,
          type: 'volume',
          name: volumeName,
          sourceFile,
          properties: {},
          dependencies: [],
        });
      }
    }

    // Parse networks (as resources)
    if (networks) {
      for (const networkName of Object.keys(networks)) {
        components.push({
          id: `network:${networkName}`,
          type: 'resource',
          name: networkName,
          sourceFile,
          properties: { resourceType: 'network' },
          dependencies: [],
        });
      }
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      component: sourceFile,
      message: `Failed to parse docker-compose: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return { components, relationships, issues };
}

// ============================================================================
// TERRAFORM PARSING
// ============================================================================

/**
 * Parse Terraform file content.
 *
 * @param content - Terraform HCL content
 * @param sourceFile - Source file path
 * @returns Parse result with components, relationships, and issues
 */
export function parseTerraformFile(content: string, sourceFile: string): InfraParseResult {
  const components: InfraComponent[] = [];
  const relationships: InfraRelationship[] = [];
  const issues: InfraIssue[] = [];

  try {
    // Simple HCL parser for resource, data, module, and variable blocks
    const blockRegex = /(resource|data|module|variable|output)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/g;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
      const blockType = match[1];
      const typeName = match[2];
      const resourceName = match[3] || typeName;

      let id: string;
      let name: string;

      switch (blockType) {
        case 'resource':
          id = `${typeName}.${resourceName}`;
          name = id;
          break;
        case 'data':
          id = `data.${typeName}.${resourceName}`;
          name = id;
          break;
        case 'module':
          id = `module.${typeName}`;
          name = id;
          break;
        case 'variable':
        case 'output':
          id = `${blockType}.${typeName}`;
          name = id;
          break;
        default:
          continue;
      }

      // Extract block content (simple brace matching)
      const blockStart = match.index + match[0].length;
      const blockContent = extractBlockContent(content, blockStart);

      const component: InfraComponent = {
        id,
        type: 'resource',
        name,
        sourceFile,
        properties: {
          blockType,
          resourceType: blockType === 'resource' ? typeName : undefined,
        },
        dependencies: [],
      };

      // Extract dependencies from references (e.g., aws_vpc.main.id)
      if (blockType === 'resource' || blockType === 'module') {
        const refRegex = /\b([a-z_]+\.[a-z_][a-z0-9_]*)\./gi;
        let refMatch;
        const seenRefs = new Set<string>();

        while ((refMatch = refRegex.exec(blockContent)) !== null) {
          const ref = refMatch[1];
          // Exclude self-references and common patterns
          if (!seenRefs.has(ref) && ref !== id && !ref.startsWith('var.') && !ref.startsWith('local.')) {
            seenRefs.add(ref);
            component.dependencies.push(ref);
          }
        }
      }

      // Extract source for modules
      if (blockType === 'module') {
        const sourceMatch = blockContent.match(/source\s*=\s*"([^"]+)"/);
        if (sourceMatch) {
          component.properties.source = sourceMatch[1];
        }
      }

      components.push(component);
    }

    // Build relationships
    for (const comp of components) {
      for (const dep of comp.dependencies) {
        // Check if dependency exists
        const exists = components.some(c => c.name === dep || c.name.endsWith(`.${dep}`));
        relationships.push({
          fromId: comp.id,
          toId: dep,
          type: 'references',
        });
      }
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      component: sourceFile,
      message: `Failed to parse Terraform file: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return { components, relationships, issues };
}

/**
 * Extract block content by matching braces.
 */
function extractBlockContent(content: string, startIndex: number): string {
  let braceCount = 1;
  let endIndex = startIndex;

  while (braceCount > 0 && endIndex < content.length) {
    const char = content[endIndex];
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    endIndex++;
  }

  return content.slice(startIndex, endIndex - 1);
}

// ============================================================================
// HELM CHART PARSING
// ============================================================================

/**
 * Parse Helm chart file content.
 *
 * @param content - YAML content
 * @param sourceFile - Source file path
 * @returns Parse result with components, relationships, and issues
 */
export function parseHelmChart(content: string, sourceFile: string): InfraParseResult {
  const components: InfraComponent[] = [];
  const relationships: InfraRelationship[] = [];
  const issues: InfraIssue[] = [];

  try {
    const parsed = parseYamlDocument(content);
    if (!parsed) return { components, relationships, issues };

    const fileName = path.basename(sourceFile);

    if (fileName === 'Chart.yaml') {
      // Parse Chart.yaml metadata
      const component: InfraComponent = {
        id: `chart:${parsed.name || 'unnamed'}`,
        type: 'resource',
        name: String(parsed.name || 'unnamed'),
        sourceFile,
        properties: {
          chartName: parsed.name,
          version: parsed.version,
          appVersion: parsed.appVersion,
          description: parsed.description,
        },
        dependencies: [],
      };

      // Extract dependencies
      const dependencies = parsed.dependencies as Array<Record<string, unknown>> | undefined;
      if (dependencies) {
        for (const dep of dependencies) {
          const depName = dep.name as string;
          component.dependencies.push(`chart:${depName}`);
          relationships.push({
            fromId: component.id,
            toId: `chart:${depName}`,
            type: 'depends_on',
          });
        }
      }

      components.push(component);
    } else if (fileName === 'values.yaml') {
      // Parse values.yaml
      components.push({
        id: `values:${sourceFile}`,
        type: 'configmap',
        name: 'values',
        sourceFile,
        properties: {
          isValuesFile: true,
          defaultValues: parsed,
        },
        dependencies: [],
      });
    }
  } catch (error) {
    issues.push({
      severity: 'error',
      component: sourceFile,
      message: `Failed to parse Helm chart: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return { components, relationships, issues };
}

// ============================================================================
// YAML PARSING UTILITY
// ============================================================================

interface YamlParseState {
  lines: string[];
  index: number;
}

/**
 * Simple YAML parser for basic structures.
 * Handles nested objects, arrays, and multi-line values.
 */
function parseYamlDocument(content: string): Record<string, unknown> | null {
  try {
    const lines = content.split('\n');
    const state: YamlParseState = { lines, index: 0 };
    return parseYamlObject(state, -1);
  } catch {
    return null;
  }
}

/**
 * Parse a YAML object starting at the current position.
 */
function parseYamlObject(state: YamlParseState, parentIndent: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  while (state.index < state.lines.length) {
    const rawLine = state.lines[state.index];

    // Skip empty lines and comments
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      state.index++;
      continue;
    }

    const indent = rawLine.search(/\S/);
    const line = rawLine.trim();

    // If we've dedented past our level, we're done with this object
    if (indent <= parentIndent && parentIndent >= 0) {
      break;
    }

    // Handle array items at this level
    if (line.startsWith('- ')) {
      // This shouldn't happen in an object context - skip
      state.index++;
      continue;
    }

    // Handle key-value pairs
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      state.index++;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const valueStr = line.slice(colonIndex + 1).trim();

    state.index++;

    if (valueStr === '') {
      // Check next line to see if it's an array or object
      if (state.index < state.lines.length) {
        const nextLine = state.lines[state.index];
        const nextTrimmed = nextLine.trim();
        const nextIndent = nextLine.search(/\S/);

        if (nextTrimmed.startsWith('- ') && nextIndent > indent) {
          // It's an array
          result[key] = parseYamlArray(state, indent);
        } else if (nextIndent > indent && nextTrimmed !== '') {
          // It's a nested object
          result[key] = parseYamlObject(state, indent);
        } else {
          result[key] = null;
        }
      } else {
        result[key] = null;
      }
    } else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
      // Inline array
      const arrayContent = valueStr.slice(1, -1);
      if (arrayContent.trim() === '') {
        result[key] = [];
      } else {
        result[key] = arrayContent.split(',').map(s => parseYamlValue(s.trim()));
      }
    } else if (valueStr.startsWith('{') && valueStr.endsWith('}')) {
      // Inline object
      result[key] = parseInlineObject(valueStr);
    } else {
      result[key] = parseYamlValue(valueStr);
    }
  }

  return result;
}

/**
 * Parse a YAML array starting at the current position.
 */
function parseYamlArray(state: YamlParseState, parentIndent: number): unknown[] {
  const result: unknown[] = [];

  while (state.index < state.lines.length) {
    const rawLine = state.lines[state.index];

    // Skip empty lines and comments
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      state.index++;
      continue;
    }

    const indent = rawLine.search(/\S/);
    const line = rawLine.trim();

    // If we've dedented, we're done with this array
    if (indent <= parentIndent) {
      break;
    }

    if (line.startsWith('- ')) {
      const valueStr = line.slice(2).trim();

      if (valueStr === '') {
        // Array of objects
        state.index++;
        const obj = parseYamlObject(state, indent);
        result.push(obj);
      } else if (valueStr.includes(':') && !valueStr.startsWith('"') && !valueStr.startsWith("'")) {
        // Inline object in array
        const colonIdx = valueStr.indexOf(':');
        const key = valueStr.slice(0, colonIdx).trim();
        const val = valueStr.slice(colonIdx + 1).trim();

        state.index++;

        // Check if there are more properties for this object
        const item: Record<string, unknown> = {};
        item[key] = val === '' ? null : parseYamlValue(val);

        // Continue reading properties at deeper indentation
        while (state.index < state.lines.length) {
          const nextRawLine = state.lines[state.index];
          if (!nextRawLine.trim() || nextRawLine.trim().startsWith('#')) {
            state.index++;
            continue;
          }
          const nextIndent = nextRawLine.search(/\S/);
          const nextLine = nextRawLine.trim();

          if (nextIndent <= indent || nextLine.startsWith('- ')) {
            break;
          }

          const nextColonIdx = nextLine.indexOf(':');
          if (nextColonIdx > 0) {
            const nextKey = nextLine.slice(0, nextColonIdx).trim();
            const nextVal = nextLine.slice(nextColonIdx + 1).trim();
            item[nextKey] = nextVal === '' ? null : parseYamlValue(nextVal);
          }
          state.index++;
        }

        result.push(item);
      } else {
        // Simple value in array
        result.push(parseYamlValue(valueStr));
        state.index++;
      }
    } else {
      // Not an array item, we're done
      break;
    }
  }

  return result;
}

/**
 * Parse an inline object like { key: value, key2: value2 }.
 */
function parseInlineObject(str: string): Record<string, unknown> {
  const content = str.slice(1, -1).trim();
  if (!content) return {};

  const result: Record<string, unknown> = {};
  const parts = content.split(',');

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).trim();
      const value = part.slice(colonIdx + 1).trim();
      result[key] = parseYamlValue(value);
    }
  }

  return result;
}

/**
 * Parse a YAML value to appropriate type.
 */
function parseYamlValue(value: string): unknown {
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

// ============================================================================
// GRAPH BUILDING
// ============================================================================

/**
 * Build a graph representation from components.
 *
 * @param components - Infrastructure components
 * @returns Graph with nodes and edges
 */
export function buildInfraGraph(components: InfraComponent[]): InfraGraph {
  const nodes = components.map(c => ({
    id: c.id,
    label: c.name,
    type: c.type,
  }));

  const edges: InfraGraph['edges'] = [];
  const componentIds = new Set(components.map(c => c.id));

  for (const component of components) {
    for (const dep of component.dependencies) {
      edges.push({
        from: component.id,
        to: dep,
        label: componentIds.has(dep) ? 'depends_on' : 'references_external',
      });
    }
  }

  return { nodes, edges };
}

// ============================================================================
// ISSUE DETECTION
// ============================================================================

/**
 * Sensitive key patterns that shouldn't be in ConfigMaps.
 */
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /key$/i,
  /token/i,
  /credential/i,
  /api_key/i,
  /apikey/i,
];

/**
 * Detect common infrastructure issues.
 *
 * @param components - Infrastructure components
 * @returns Array of identified issues
 */
export function detectInfraIssues(components: InfraComponent[]): InfraIssue[] {
  const issues: InfraIssue[] = [];
  const componentById = new Map(components.map(c => [c.id, c]));
  const referencedIds = new Set<string>();

  // Collect all referenced IDs
  for (const comp of components) {
    for (const dep of comp.dependencies) {
      referencedIds.add(dep);
    }
  }

  for (const component of components) {
    // Check for missing dependencies
    for (const dep of component.dependencies) {
      if (!componentById.has(dep)) {
        issues.push({
          severity: 'error',
          component: component.id,
          message: `References missing component: ${dep}`,
          suggestion: `Ensure ${dep} is defined in your infrastructure configuration`,
        });
      }
    }

    // Check for unused ConfigMaps/Secrets
    if ((component.type === 'configmap' || component.type === 'secret') && !referencedIds.has(component.id)) {
      issues.push({
        severity: 'warning',
        component: component.id,
        message: `${component.type} '${component.name}' appears to be unused`,
        suggestion: 'Consider removing if not needed, or add reference from workload',
      });
    }

    // Check for missing resource limits in deployments
    if (component.type === 'deployment') {
      const containers = component.properties.containers as Array<{
        name: string;
        resources?: { limits?: unknown; requests?: unknown };
      }> | undefined;

      if (containers) {
        for (const container of containers) {
          if (!container.resources?.limits && !container.resources?.requests) {
            issues.push({
              severity: 'warning',
              component: component.id,
              message: `Container '${container.name}' has no resource limits defined`,
              suggestion: 'Add resource requests and limits to prevent resource starvation',
            });
          }
        }

        // Check for latest tag
        for (const container of containers) {
          const image = (container as { image?: string }).image;
          if (image && (image.endsWith(':latest') || !image.includes(':'))) {
            issues.push({
              severity: 'warning',
              component: component.id,
              message: `Container uses 'latest' or untagged image: ${image}`,
              suggestion: 'Use specific image tags for reproducible deployments',
            });
          }
        }
      }
    }

    // Check for sensitive data in ConfigMaps
    if (component.type === 'configmap') {
      const keys = component.properties.keys as string[] | undefined;
      if (keys) {
        for (const key of keys) {
          if (SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key))) {
            issues.push({
              severity: 'warning',
              component: component.id,
              message: `ConfigMap contains potentially sensitive key: ${key}`,
              suggestion: 'Consider using a Secret instead for sensitive data',
            });
          }
        }
      }
    }
  }

  // Check for circular dependencies using DFS
  const detectedCycles = new Set<string>();

  function detectCycle(startId: string): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    function dfs(componentId: string): void {
      if (recursionStack.has(componentId)) {
        // Found a cycle
        const cycleStart = path.indexOf(componentId);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart).concat(componentId);
          const cycleKey = cycle.slice().sort().join(',');
          if (!detectedCycles.has(cycleKey)) {
            detectedCycles.add(cycleKey);
            issues.push({
              severity: 'warning',
              component: componentId,
              message: `Circular dependency detected: ${cycle.join(' -> ')}`,
              suggestion: 'Review and break the dependency cycle',
            });
          }
        }
        return;
      }

      if (visited.has(componentId)) return;

      visited.add(componentId);
      recursionStack.add(componentId);
      path.push(componentId);

      const component = componentById.get(componentId);
      if (component) {
        for (const dep of component.dependencies) {
          if (componentById.has(dep)) {
            dfs(dep);
          }
        }
      }

      path.pop();
      recursionStack.delete(componentId);
    }

    dfs(startId);
  }

  for (const component of components) {
    detectCycle(component.id);
  }

  return issues;
}

// ============================================================================
// AUTO-DETECTION
// ============================================================================

/**
 * Auto-detect infrastructure types in a repository.
 *
 * @param repoPath - Path to the repository
 * @returns Array of detected infrastructure types
 */
export function autoDetectInfraTypes(repoPath: string): InfraType[] {
  const types = new Set<InfraType>();

  try {
    const files = scanDirectoryRecursive(repoPath, 3); // Max depth of 3

    for (const file of files) {
      const basename = path.basename(file);
      const ext = path.extname(file);

      // Detect Dockerfile
      if (basename === 'Dockerfile' || basename.startsWith('Dockerfile.')) {
        types.add('docker');
      }

      // Detect docker-compose
      if (basename === 'docker-compose.yml' || basename === 'docker-compose.yaml' ||
          basename.startsWith('docker-compose.')) {
        types.add('docker');
      }

      // Detect Terraform
      if (ext === '.tf') {
        types.add('terraform');
      }

      // Detect Helm
      if (basename === 'Chart.yaml') {
        types.add('helm');
      }

      // Detect Kubernetes YAML
      if ((ext === '.yaml' || ext === '.yml') && !basename.includes('docker-compose')) {
        try {
          const content = readFileSync(file, 'utf-8');
          if (content.includes('apiVersion:') && content.includes('kind:')) {
            types.add('kubernetes');
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Return empty array if we can't scan
  }

  return Array.from(types);
}

/**
 * Recursively scan a directory for files.
 */
function scanDirectoryRecursive(dirPath: string, maxDepth: number, currentDepth = 0): string[] {
  if (currentDepth >= maxDepth) return [];

  const results: string[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      // Skip common non-infrastructure directories
      if (['node_modules', '.git', 'dist', 'build', 'vendor'].includes(entry)) continue;

      const fullPath = path.join(dirPath, entry);
      try {
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          results.push(...scanDirectoryRecursive(fullPath, maxDepth, currentDepth + 1));
        } else if (stat.isFile()) {
          results.push(fullPath);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {
    // Return empty if directory is inaccessible
  }

  return results;
}

// ============================================================================
// TEMPLATE CREATION
// ============================================================================

/**
 * Create the T8 InfraMap template.
 *
 * @returns InfraMap construction template
 */
export function createInfraMapTemplate(): InfraMapTemplate {
  return {
    id: 'T8',
    name: 'InfraMap',
    description: 'Map infrastructure (k8s, IaC, containers) to services, owners, and risk.',
    supportedUcs: ['UC-081', 'UC-082'],
    requiredMaps: ['InfraMap', 'OwnerMap', 'RiskMap'],
    optionalMaps: [],
    requiredObjects: ['map', 'pack'],
    outputEnvelope: {
      packTypes: ['InfraPack'],
      requiresAdequacy: true,
      requiresVerificationPlan: false,
    },
    execute: executeInfraMap,
  };
}

/**
 * Execute the InfraMap template.
 *
 * @param context - Template execution context
 * @returns Template execution result
 */
async function executeInfraMap(context: TemplateContext): Promise<TemplateResult> {
  const now = new Date().toISOString();
  const evidence: TemplateSelectionEvidence[] = [{
    templateId: 'T8',
    selectedAt: now,
    reason: 'InfraMap template selected for infrastructure analysis',
    intentKeywords: extractIntentKeywords(context.intent),
  }];

  const disclosures: string[] = [];
  const allComponents: InfraComponent[] = [];
  const allRelationships: InfraRelationship[] = [];
  const allIssues: InfraIssue[] = [];

  const repoPath = context.workspace || process.cwd();

  // Check if repo exists
  if (!existsSync(repoPath)) {
    disclosures.push(`error: Repository path not found: ${repoPath}`);
    return buildErrorResult(evidence, disclosures);
  }

  // Auto-detect or use specified infra types
  const detectedTypes = autoDetectInfraTypes(repoPath);

  if (detectedTypes.length === 0) {
    disclosures.push('no_infrastructure: No infrastructure files detected in repository');
    return buildEmptyResult(evidence, disclosures);
  }

  let scanConfidence: ConfidenceValue = deterministic(true, 'infra_files_found');

  // Scan and parse infrastructure files
  try {
    const files = scanDirectoryRecursive(repoPath, 5);

    for (const file of files) {
      const basename = path.basename(file);
      const ext = path.extname(file);
      const relativePath = path.relative(repoPath, file);

      try {
        const content = readFileSync(file, 'utf-8');

        // Parse based on file type
        if (basename === 'Dockerfile' || basename.startsWith('Dockerfile.')) {
          const result = parseDockerfile(content, relativePath);
          allComponents.push(...result.components);
          allRelationships.push(...result.relationships);
          allIssues.push(...result.issues);
        } else if (basename.includes('docker-compose') && (ext === '.yml' || ext === '.yaml')) {
          const result = parseDockerCompose(content, relativePath);
          allComponents.push(...result.components);
          allRelationships.push(...result.relationships);
          allIssues.push(...result.issues);
        } else if (ext === '.tf') {
          const result = parseTerraformFile(content, relativePath);
          allComponents.push(...result.components);
          allRelationships.push(...result.relationships);
          allIssues.push(...result.issues);
        } else if (basename === 'Chart.yaml' || basename === 'values.yaml') {
          const result = parseHelmChart(content, relativePath);
          allComponents.push(...result.components);
          allRelationships.push(...result.relationships);
          allIssues.push(...result.issues);
        } else if ((ext === '.yaml' || ext === '.yml') && content.includes('apiVersion:')) {
          const result = parseKubernetesYaml(content, relativePath);
          allComponents.push(...result.components);
          allRelationships.push(...result.relationships);
          allIssues.push(...result.issues);
        }
      } catch (error) {
        allIssues.push({
          severity: 'warning',
          component: relativePath,
          message: `Failed to parse file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  } catch (error) {
    disclosures.push(`error: Failed to scan repository: ${error instanceof Error ? error.message : String(error)}`);
    scanConfidence = deterministic(false, 'scan_failed');
  }

  // Detect additional issues
  const detectedIssues = detectInfraIssues(allComponents);
  allIssues.push(...detectedIssues);

  // Build graph
  const graph = buildInfraGraph(allComponents);

  // Compute summary
  const byType: Record<string, number> = {};
  const namespaces = new Set<string>();

  for (const component of allComponents) {
    byType[component.type] = (byType[component.type] || 0) + 1;
    if (component.namespace) {
      namespaces.add(component.namespace);
    }
  }

  // Build confidence
  const parseConfidence = deterministic(allIssues.filter(i => i.severity === 'error').length === 0, 'parsing_complete');
  const graphConfidence = deterministic(true, 'graph_built');

  const overallConfidence = sequenceConfidence([
    scanConfidence,
    parseConfidence,
    graphConfidence,
  ]);

  // Build output
  const infraMapOutput: InfraMapOutput = {
    components: allComponents,
    relationships: allRelationships,
    issues: allIssues,
    summary: {
      totalComponents: allComponents.length,
      byType,
      namespaces: Array.from(namespaces),
      issueCount: allIssues.length,
    },
    graph,
    confidence: overallConfidence,
  };

  // Create context pack
  const contextPack = buildContextPack(infraMapOutput, context, detectedTypes);

  // Add disclosures for detected issues
  if (allIssues.filter(i => i.severity === 'error').length > 0) {
    disclosures.push(`issues_detected: ${allIssues.filter(i => i.severity === 'error').length} error(s) found`);
  }
  if (allIssues.filter(i => i.severity === 'warning').length > 0) {
    disclosures.push(`warnings_detected: ${allIssues.filter(i => i.severity === 'warning').length} warning(s) found`);
  }

  return {
    success: true,
    packs: [contextPack],
    adequacy: null,
    verificationPlan: null,
    disclosures,
    traceId: `trace_T8_${Date.now()}`,
    evidence,
  };
}

/**
 * Build a ContextPack from InfraMapOutput.
 */
function buildContextPack(
  output: InfraMapOutput,
  context: TemplateContext,
  detectedTypes: InfraType[]
): ContextPack {
  const keyFacts: string[] = [
    `Infrastructure types: ${detectedTypes.join(', ')}`,
    `Total components: ${output.summary.totalComponents}`,
    `Components by type: ${Object.entries(output.summary.byType).map(([k, v]) => `${k}(${v})`).join(', ')}`,
  ];

  if (output.summary.namespaces.length > 0) {
    keyFacts.push(`Namespaces: ${output.summary.namespaces.join(', ')}`);
  }

  keyFacts.push(`Issues: ${output.summary.issueCount} (${output.issues.filter(i => i.severity === 'error').length} errors, ${output.issues.filter(i => i.severity === 'warning').length} warnings)`);

  // Add component summaries
  const componentsByType = new Map<string, InfraComponent[]>();
  for (const comp of output.components) {
    const existing = componentsByType.get(comp.type) || [];
    existing.push(comp);
    componentsByType.set(comp.type, existing);
  }

  for (const [type, components] of componentsByType) {
    if (components.length <= 5) {
      keyFacts.push(`${type}: ${components.map(c => c.name).join(', ')}`);
    } else {
      keyFacts.push(`${type}: ${components.slice(0, 5).map(c => c.name).join(', ')} ... and ${components.length - 5} more`);
    }
  }

  // Add critical issues
  const criticalIssues = output.issues.filter(i => i.severity === 'error');
  for (const issue of criticalIssues.slice(0, 5)) {
    keyFacts.push(`ERROR: ${issue.message}`);
  }

  const confidenceValue = getEffectiveConfidence(output.confidence);

  return {
    packId: `infra_pack_${Date.now()}`,
    packType: 'function_context', // Using existing pack type
    targetId: `infra:${context.workspace || 'unknown'}`,
    summary: `InfraMap analysis: ${output.summary.totalComponents} components, ${output.summary.issueCount} issues`,
    keyFacts,
    codeSnippets: [],
    relatedFiles: output.components.map(c => c.sourceFile).filter((f, i, arr) => arr.indexOf(f) === i),
    confidence: confidenceValue,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      string: '1.0.0',
      qualityTier: 'mvp',
      indexedAt: new Date(),
      indexerVersion: '1.0.0',
      features: ['infra_map'],
    },
    invalidationTriggers: output.components.map(c => c.sourceFile).filter((f, i, arr) => arr.indexOf(f) === i),
  };
}

/**
 * Build an empty result when no infrastructure is found.
 */
function buildEmptyResult(
  evidence: TemplateSelectionEvidence[],
  disclosures: string[]
): TemplateResult {
  return {
    success: true,
    packs: [{
      packId: `infra_pack_empty_${Date.now()}`,
      packType: 'function_context',
      targetId: 'infra:empty',
      summary: 'No infrastructure files detected',
      keyFacts: ['No Kubernetes, Docker, Terraform, or Helm files found'],
      codeSnippets: [],
      relatedFiles: [],
      confidence: 1.0,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: {
        major: 1,
        minor: 0,
        patch: 0,
        string: '1.0.0',
        qualityTier: 'mvp',
        indexedAt: new Date(),
        indexerVersion: '1.0.0',
        features: ['infra_map'],
      },
      invalidationTriggers: [],
    }],
    adequacy: null,
    verificationPlan: null,
    disclosures,
    traceId: `trace_T8_${Date.now()}`,
    evidence,
  };
}

/**
 * Build an error result.
 */
function buildErrorResult(
  evidence: TemplateSelectionEvidence[],
  disclosures: string[]
): TemplateResult {
  return {
    success: false,
    packs: [],
    adequacy: null,
    verificationPlan: null,
    disclosures,
    traceId: `trace_T8_${Date.now()}`,
    evidence,
  };
}

/**
 * Extract intent keywords for evidence.
 */
function extractIntentKeywords(intent: string): string[] {
  const keywords = [
    'infrastructure', 'infra', 'kubernetes', 'k8s', 'docker', 'container',
    'terraform', 'iac', 'deploy', 'service', 'helm', 'compose',
  ];
  const intentLower = intent.toLowerCase();
  return keywords.filter(k => intentLower.includes(k));
}
