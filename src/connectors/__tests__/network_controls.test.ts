import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGitHubIssues } from '../github_issues.js';
import { loadJiraIssues } from '../jira.js';
import { loadPagerDutyIncidents } from '../pagerduty.js';

function setEnv(name: string, value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[name] = value;
  } else {
    delete process.env[name];
  }
}

describe('integration network controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LIBRARIAN_OFFLINE;
    delete process.env.LIBRARIAN_LOCAL_ONLY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_USER;
    delete process.env.JIRA_TOKEN;
    delete process.env.PAGERDUTY_TOKEN;
  });

  it('skips GitHub API calls when offline mode is enabled', async () => {
    setEnv('LIBRARIAN_OFFLINE', '1');
    setEnv('GITHUB_TOKEN', 'test-token');
    setEnv('GITHUB_REPOSITORY', 'owner/repo');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await loadGitHubIssues();

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips Jira API calls when local-only mode is enabled', async () => {
    setEnv('LIBRARIAN_LOCAL_ONLY', '1');
    setEnv('JIRA_BASE_URL', 'https://jira.example.com');
    setEnv('JIRA_USER', 'test@example.com');
    setEnv('JIRA_TOKEN', 'token');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await loadJiraIssues();

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips PagerDuty API calls when offline mode is enabled', async () => {
    setEnv('LIBRARIAN_OFFLINE', '1');
    setEnv('PAGERDUTY_TOKEN', 'token');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await loadPagerDutyIncidents();

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
