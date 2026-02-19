export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function validateEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function validatePhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return normalized.length === 10;
}
