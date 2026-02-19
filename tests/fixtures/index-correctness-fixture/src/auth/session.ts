type SessionRecord = {
  userId: string;
  issuedAt: number;
};

const SESSION_RECORDS = new Map<string, SessionRecord>();

export function hashSessionToken(raw: string): string {
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return `sess_${Math.abs(hash).toString(16)}`;
}

export function createSessionToken(userId: string): string {
  const issuedAt = Date.now();
  const token = hashSessionToken(`${userId}:${issuedAt}`);
  SESSION_RECORDS.set(token, { userId, issuedAt });
  return token;
}

export function verifySessionToken(token: string): boolean {
  if (!token) {
    return false;
  }
  const record = SESSION_RECORDS.get(token);
  if (!record) {
    return false;
  }
  const expected = hashSessionToken(`${record.userId}:${record.issuedAt}`);
  return token === expected;
}

export function refreshSession(token: string): string | null {
  if (!verifySessionToken(token)) {
    return null;
  }
  const record = SESSION_RECORDS.get(token);
  if (!record) {
    return null;
  }
  SESSION_RECORDS.delete(token);
  return createSessionToken(record.userId);
}
