export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  url: string;
  state: string;
  isPullRequest: boolean;
  labels: string[];
  updatedAt: string | null;
}

export interface GitHubIssueFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

export interface GitHubIssueSnapshot {
  source: 'github';
  repository: string;
  fetchedAt: string;
  issues: GitHubIssue[];
  filesByIssue: Record<number, GitHubIssueFile[]>;
}

export interface GitHubIssueOptions {
  token?: string;
  repo?: string;
  baseUrl?: string;
  maxIssues?: number;
  maxFilesPerPr?: number;
}

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_MAX_ISSUES = 20;
const DEFAULT_MAX_FILES = 50;

type GitHubLabelRecord = { name?: unknown };
type GitHubIssueRecord = {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  html_url?: unknown;
  state?: unknown;
  pull_request?: unknown;
  labels?: unknown;
  updated_at?: unknown;
};
type GitHubFileRecord = {
  filename?: unknown;
  status?: unknown;
  additions?: unknown;
  deletions?: unknown;
  changes?: unknown;
};

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'librarian-ai',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status}`);
  }
  return response.json();
}

function parseRepo(repo: string): { owner: string; name: string } | null {
  const trimmed = repo.trim().replace(/^https?:\/\/github\.com\//, '');
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length < 2) return noResult();
  return { owner: parts[0]!, name: parts[1]! };
}

function mapIssue(raw: GitHubIssueRecord): GitHubIssue {
  const labelsRaw = Array.isArray(raw.labels) ? raw.labels : [];
  const labels = labelsRaw.map((label) => {
    if (label && typeof label === 'object') {
      return String((label as GitHubLabelRecord).name ?? '');
    }
    return String(label ?? '');
  });
  return {
    id: Number(raw.id),
    number: Number(raw.number),
    title: String(raw.title ?? ''),
    url: String(raw.html_url ?? ''),
    state: String(raw.state ?? 'unknown'),
    isPullRequest: Boolean(raw.pull_request),
    labels,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}

function mapFiles(raw: GitHubFileRecord[]): GitHubIssueFile[] {
  return raw.map((entry) => {
    return {
      filename: String(entry?.filename ?? ''),
      status: String(entry?.status ?? ''),
      additions: Number(entry?.additions ?? 0),
      deletions: Number(entry?.deletions ?? 0),
      changes: Number(entry?.changes ?? 0),
    };
  });
}

export async function loadGitHubIssues(options: GitHubIssueOptions = {}): Promise<GitHubIssueSnapshot | null> {
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY ?? process.env.GITHUB_REPO;
  if (!token || !repo) return noResult();
  const parsed = parseRepo(repo);
  if (!parsed) return noResult();

  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const maxIssues = Math.max(1, options.maxIssues ?? DEFAULT_MAX_ISSUES);
  const maxFilesPerPr = Math.max(1, options.maxFilesPerPr ?? DEFAULT_MAX_FILES);
  const issuesUrl = `${baseUrl}/repos/${parsed.owner}/${parsed.name}/issues?state=open&per_page=${Math.min(100, maxIssues)}`;

  try {
    const rawIssues = await fetchJson(issuesUrl, token);
    const issueList = Array.isArray(rawIssues) ? rawIssues : [];
    const issues = issueList.slice(0, maxIssues).map((entry) => mapIssue(entry as GitHubIssueRecord));
    const filesByIssue: Record<number, GitHubIssueFile[]> = {};
    for (const issue of issues) {
      if (!issue.isPullRequest) continue;
      const filesUrl = `${baseUrl}/repos/${parsed.owner}/${parsed.name}/pulls/${issue.number}/files?per_page=${Math.min(100, maxFilesPerPr)}`;
      try {
        const rawFiles = await fetchJson(filesUrl, token);
        const fileList = Array.isArray(rawFiles) ? rawFiles : [];
        filesByIssue[issue.number] = mapFiles(fileList.slice(0, maxFilesPerPr) as GitHubFileRecord[]);
      } catch {
        continue;
      }
    }
    return {
      source: 'github',
      repository: `${parsed.owner}/${parsed.name}`,
      fetchedAt: new Date().toISOString(),
      issues,
      filesByIssue,
    };
  } catch {
    return noResult();
  }
}
import { noResult } from '../api/empty_values.js';
