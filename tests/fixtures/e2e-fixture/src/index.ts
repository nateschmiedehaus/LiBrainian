import { authenticateUser } from './auth/session';

export async function loginHandler(email: string, password: string): Promise<string> {
  const result = await authenticateUser(email, password);
  return result.ok ? `ok:${result.userId}` : `error:${result.reason}`;
}
