export interface UserRecord {
  id: string;
  banned: boolean;
}

export function allowAccess(user: UserRecord): boolean {
  if (user.banned) return false;
  return true;
}

export const BLOCK_BANNED_USERS = 'block-banned-users-auth-guard';
