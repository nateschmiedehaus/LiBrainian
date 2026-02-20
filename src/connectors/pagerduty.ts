import { isNetworkAccessDisabled } from '../utils/runtime_controls.js';

export interface PagerDutyIncident {
  id: string;
  title: string;
  status: string;
  urgency: string;
  url: string;
  service: string;
  createdAt: string | null;
}

export interface PagerDutySnapshot {
  source: 'pagerduty';
  fetchedAt: string;
  incidents: PagerDutyIncident[];
}

export interface PagerDutyOptions {
  token?: string;
  baseUrl?: string;
  serviceIds?: string[];
  since?: string;
  maxResults?: number;
}

const DEFAULT_BASE_URL = 'https://api.pagerduty.com';
const DEFAULT_MAX_RESULTS = 20;

type PagerDutyApiIncident = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  urgency?: unknown;
  html_url?: unknown;
  service?: { summary?: unknown };
  created_at?: unknown;
};

type PagerDutyApiResponse = {
  incidents?: unknown;
};

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Token token=${token}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
    },
  });
  if (!response.ok) throw new Error(`PagerDuty API failed: ${response.status}`);
  return response.json();
}

function parseServiceIds(options: PagerDutyOptions): string[] {
  if (options.serviceIds?.length) return options.serviceIds;
  const env = process.env.PAGERDUTY_SERVICE_IDS;
  return env ? env.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function mapIncident(raw: PagerDutyApiIncident): PagerDutyIncident {
  return {
    id: String(raw?.id ?? ''),
    title: String(raw?.title ?? ''),
    status: String(raw?.status ?? 'unknown'),
    urgency: String(raw?.urgency ?? 'unknown'),
    url: String(raw?.html_url ?? ''),
    service: String(raw?.service?.summary ?? ''),
    createdAt: typeof raw?.created_at === 'string' ? raw.created_at : null,
  };
}

export async function loadPagerDutyIncidents(options: PagerDutyOptions = {}): Promise<PagerDutySnapshot | null> {
  if (isNetworkAccessDisabled()) return noResult();
  const token = options.token ?? process.env.PAGERDUTY_TOKEN;
  if (!token) return noResult();
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const maxResults = Math.max(1, options.maxResults ?? DEFAULT_MAX_RESULTS);
  const serviceIds = parseServiceIds(options);
  const since = options.since ?? process.env.PAGERDUTY_SINCE;
  const params = new URLSearchParams({ limit: String(maxResults), statuses: 'triggered,acknowledged' });
  if (since) params.set('since', since);
  for (const id of serviceIds) params.append('service_ids[]', id);
  const url = `${baseUrl}/incidents?${params.toString()}`;

  try {
    const payload = await fetchJson(url, token);
    const incidentsRaw =
      payload && typeof payload === 'object' && 'incidents' in payload
        ? (payload as PagerDutyApiResponse).incidents
        : undefined;
    const incidents = Array.isArray(incidentsRaw)
      ? incidentsRaw.map((entry) => mapIncident(entry as PagerDutyApiIncident))
      : [];
    return { source: 'pagerduty', fetchedAt: new Date().toISOString(), incidents };
  } catch {
    return noResult();
  }
}
import { noResult } from '../api/empty_values.js';
