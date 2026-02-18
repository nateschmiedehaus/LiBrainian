const TRACE_MARKER_PATTERN = /^unverified_by_trace\(([^)]+)\):?\s*(.*)$/i;

export interface ParsedTraceMarkerMessage {
  code?: string;
  userMessage: string;
  rawMessage: string;
}

export function parseTraceMarkerMessage(message: string | undefined): ParsedTraceMarkerMessage {
  const rawMessage = String(message ?? '').trim();
  const match = rawMessage.match(TRACE_MARKER_PATTERN);
  if (!match) {
    return {
      userMessage: rawMessage,
      rawMessage,
    };
  }

  const code = (match[1] ?? '').trim();
  const detail = (match[2] ?? '').trim();
  return {
    code: code || undefined,
    userMessage: detail || code.replace(/_/g, ' '),
    rawMessage,
  };
}

export function sanitizeTraceMarkerMessage(message: string | undefined): string {
  return parseTraceMarkerMessage(message).userMessage;
}

export function sanitizeTraceStatus(status: string | undefined): string {
  const normalized = String(status ?? '').trim();
  if (!normalized) return normalized;
  if (normalized === 'unverified_by_trace') return 'needs_verification';
  return sanitizeTraceMarkerMessage(normalized);
}
