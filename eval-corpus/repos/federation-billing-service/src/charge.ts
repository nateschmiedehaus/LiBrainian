import type { UserContract } from './contracts';

export function chargeUser(user: UserContract, cents: number): string {
  if (user.status !== 'active') {
    throw new Error('Cannot charge disabled user');
  }
  return `charged:${user.id}:${cents}`;
}
