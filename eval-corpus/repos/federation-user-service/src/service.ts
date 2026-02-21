import type { UserContract } from './contracts';

export function buildUserContract(id: string, email: string, status: UserContract['status']): UserContract {
  return { id, email, status };
}
