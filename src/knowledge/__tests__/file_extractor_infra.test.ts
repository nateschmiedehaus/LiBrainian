import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractFileKnowledge } from '../extractors/file_extractor.js';

describe('extractFileKnowledge infra heuristics', () => {
  it('extracts meaningful concepts from a Dockerfile without LLM', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-file-extractor-infra-'));
    try {
      const dockerfilePath = path.join(workspace, 'Dockerfile');
      await fs.writeFile(
        dockerfilePath,
        [
          'FROM node:20-alpine AS build',
          'WORKDIR /app',
          'COPY package.json package-lock.json ./',
          'RUN npm ci',
          'COPY . .',
          'RUN npm run build',
          'FROM nginx:1.27-alpine',
          'COPY --from=build /app/dist /usr/share/nginx/html',
          'EXPOSE 8080',
        ].join('\n'),
        'utf8',
      );

      const result = await extractFileKnowledge(
        { absolutePath: dockerfilePath, workspaceRoot: workspace },
        { skipLlm: true },
      );

      expect(result.file.category).toBe('config');
      expect(result.file.role).toBe('configuration');
      expect(result.file.mainConcepts).toContain('Dockerfile');
      expect(result.file.mainConcepts).toContain('node:20-alpine');
      expect(result.file.mainConcepts).toContain('nginx:1.27-alpine');
      expect(result.file.mainConcepts).toContain('stage:build');
      expect(result.file.mainConcepts).toContain('port:8080');
      expect(result.file.llmEvidence).toBeUndefined();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('extracts meaningful concepts from Terraform/HCL without LLM', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-file-extractor-infra-'));
    try {
      const tfPath = path.join(workspace, 'main.tf');
      await fs.writeFile(
        tfPath,
        [
          'terraform { required_version = \">= 1.5.0\" }',
          'provider \"aws\" { region = \"us-east-1\" }',
          'resource \"aws_s3_bucket\" \"assets\" { bucket = \"example-assets\" }',
          'module \"vpc\" { source = \"terraform-aws-modules/vpc/aws\" }',
        ].join('\n'),
        'utf8',
      );

      const result = await extractFileKnowledge(
        { absolutePath: tfPath, workspaceRoot: workspace },
        { skipLlm: true },
      );

      expect(result.file.category).toBe('config');
      expect(result.file.role).toBe('configuration');
      expect(result.file.mainConcepts).toContain('Terraform');
      expect(result.file.mainConcepts).toContain('provider:aws');
      expect(result.file.mainConcepts).toContain('resource:aws_s3_bucket');
      expect(result.file.mainConcepts).toContain('name:assets');
      expect(result.file.mainConcepts).toContain('module:vpc');
      expect(result.file.llmEvidence).toBeUndefined();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

