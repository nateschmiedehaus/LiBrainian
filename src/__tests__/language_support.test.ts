import { describe, it, expect } from 'vitest';
import { getLanguageFromExtension, getLanguageFromPath, SUPPORTED_LANGUAGES } from '../utils/language.js';

describe('language support mapping', () => {
  it('maps top language extensions', () => {
    const samples: Array<[string, string]> = [
      ['src/main.ts', 'typescript'],
      ['src/main.js', 'javascript'],
      ['src/main.py', 'python'],
      ['src/main.go', 'go'],
      ['src/main.rs', 'rust'],
      ['src/Main.java', 'java'],
      ['src/main.c', 'c'],
      ['src/main.cpp', 'cpp'],
      ['src/Main.cs', 'csharp'],
      ['src/Main.kt', 'kotlin'],
      ['src/Main.swift', 'swift'],
      ['src/Main.scala', 'scala'],
      ['src/main.dart', 'dart'],
      ['src/main.lua', 'lua'],
      ['src/main.r', 'r'],
      ['scripts/build.sh', 'bash'],
      ['db/schema.sql', 'sql'],
      ['config/settings.json', 'json'],
      ['public/index.html', 'html'],
      ['styles/main.css', 'css'],
      ['config/settings.yaml', 'yaml'],
      ['config/settings.yml', 'yaml'],
      ['Dockerfile', 'dockerfile'],
      ['infra/main.tf', 'hcl'],
      ['src/main.rb', 'ruby'],
      ['src/main.php', 'php'],
    ];

    for (const [filePath, expected] of samples) {
      expect(getLanguageFromPath(filePath)).toBe(expected);
    }
  });

  it('maps extensions directly', () => {
    expect(getLanguageFromExtension('.ts')).toBe('typescript');
    expect(getLanguageFromExtension('ts')).toBe('typescript');
    expect(getLanguageFromExtension('.kt')).toBe('kotlin');
    expect(getLanguageFromExtension('.cs')).toBe('csharp');
    expect(getLanguageFromExtension('.html')).toBe('html');
    expect(getLanguageFromExtension('.css')).toBe('css');
  });

  it('covers at least 20 languages', () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(20);
  });
});
