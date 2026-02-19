import type { UserRecord } from './types';

const USERS: UserRecord[] = [
  {
    id: 'u_1',
    email: 'alex@example.com',
    passwordHash: 'pw_alex',
    active: true,
  },
  {
    id: 'u_2',
    email: 'sam@example.com',
    passwordHash: 'pw_sam',
    active: false,
  },
];

export async function loadUserByEmail(email: string): Promise<UserRecord | null> {
  const normalized = email.trim().toLowerCase();
  const match = USERS.find((user) => user.email.toLowerCase() === normalized);
  return match ?? null;
}
