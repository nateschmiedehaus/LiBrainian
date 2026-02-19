import { isNetworkAccessDisabled } from '../utils/runtime_controls.js';

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
  labels: string[];
  updatedAt: string | null;
}

export interface JiraSnapshot {
  source: 'jira';
  baseUrl: string;
  fetchedAt: string;
  issues: JiraIssue[];
  jql: string;
}

export interface JiraOptions {
  baseUrl?: string;
  email?: string;
  token?: string;
  jql?: string;
  projectKey?: string;
  maxResults?: number;
}

const DEFAULT_MAX_RESULTS = 20;

function resolveJql(options: JiraOptions): string | null {
  if (options.jql) return options.jql;
  if (process.env.JIRA_JQL) return process.env.JIRA_JQL;
  const project = options.projectKey ?? process.env.JIRA_PROJECT;
  return project ? `project = ${project} order by updated desc` : null;
}

type JiraFieldRecord = {
  summary?: unknown;
  status?: { name?: unknown };
  labels?: unknown;
  updated?: unknown;
};

type JiraIssueRecord = {
  key?: unknown;
  fields?: JiraFieldRecord;
};

type JiraSearchResponse = {
  issues?: unknown;
};

async function fetchJson(url: string, auth: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Jira API failed: ${response.status}`);
  return response.json();
}

function mapIssue(raw: JiraIssueRecord, baseUrl: string): JiraIssue {
  const key = String(raw?.key ?? '');
  const fields = raw?.fields ?? {};
  return {
    key,
    summary: String(fields.summary ?? ''),
    status: String(fields.status?.name ?? 'unknown'),
    url: `${baseUrl.replace(/\/$/, '')}/browse/${key}`,
    labels: Array.isArray(fields.labels) ? fields.labels.map((label) => String(label)) : [],
    updatedAt: typeof fields.updated === 'string' ? fields.updated : null,
  };
}

export async function loadJiraIssues(options: JiraOptions = {}): Promise<JiraSnapshot | null> {
  if (isNetworkAccessDisabled()) return noResult();
  const baseUrl = options.baseUrl ?? process.env.JIRA_BASE_URL;
  const email = options.email ?? process.env.JIRA_USER ?? process.env.JIRA_EMAIL;
  const token = options.token ?? process.env.JIRA_TOKEN;
  const jql = resolveJql(options);
  if (!baseUrl || !email || !token || !jql) return noResult();

  const maxResults = Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS);
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`;

  try {
    const payload = await fetchJson(url, auth);
    const issuesRaw =
      payload && typeof payload === 'object' && 'issues' in payload
        ? (payload as JiraSearchResponse).issues
        : undefined;
    const issues = Array.isArray(issuesRaw)
      ? issuesRaw.map((issue) => mapIssue(issue as JiraIssueRecord, baseUrl))
      : [];
    return { source: 'jira', baseUrl, fetchedAt: new Date().toISOString(), issues, jql };
  } catch {
    return noResult();
  }
}
import { noResult } from '../api/empty_values.js';
