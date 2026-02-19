import { validateEmail, validatePassword } from '../validation/user';
import { loadUserByEmail } from '../user/repository';

export interface AuthResult {
  ok: boolean;
  userId?: string;
  reason?: string;
}

export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
  if (!validateEmail(email)) {
    return { ok: false, reason: 'invalid_email' };
  }
  if (!validatePassword(password)) {
    return { ok: false, reason: 'invalid_password' };
  }

  const user = await loadUserByEmail(email);
  if (!user) {
    return { ok: false, reason: 'unknown_user' };
  }
  if (!user.active) {
    return { ok: false, reason: 'inactive_user' };
  }
  if (user.passwordHash !== password) {
    return { ok: false, reason: 'wrong_password' };
  }

  return { ok: true, userId: user.id };
}
