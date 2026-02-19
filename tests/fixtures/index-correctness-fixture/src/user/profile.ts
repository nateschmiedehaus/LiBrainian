export interface UserProfile {
  id: string;
  displayName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface UserProfileRepository {
  getById(id: string): UserProfile | null;
  save(profile: UserProfile): void;
}

export function loadUserProfile(repo: UserProfileRepository, userId: string): UserProfile | null {
  return repo.getById(userId);
}

export function saveUserProfile(repo: UserProfileRepository, profile: UserProfile): void {
  repo.save(profile);
}

export function calculateProfileCompleteness(profile: UserProfile): number {
  let fieldsFilled = 0;
  if (profile.displayName) fieldsFilled += 1;
  if (profile.email) fieldsFilled += 1;
  if (profile.phone) fieldsFilled += 1;
  if (profile.avatarUrl) fieldsFilled += 1;
  return Math.round((fieldsFilled / 4) * 100);
}

export function renderProfileCard(profile: UserProfile): string {
  const completeness = calculateProfileCompleteness(profile);
  return `${profile.displayName} (${completeness}% complete)`;
}
