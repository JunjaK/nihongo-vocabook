export interface UserProfile {
  nickname: string | null;
  avatarUrl: string | null;
  jlptLevel: number | null;
  studyPurpose: string | null;
}

export async function fetchProfile(): Promise<UserProfile> {
  const res = await fetch('/api/profile');
  if (!res.ok) {
    throw new Error('Failed to fetch profile');
  }
  return res.json() as Promise<UserProfile>;
}

export async function saveProfile(data: Partial<UserProfile>): Promise<void> {
  const res = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? 'Failed to save profile');
  }
}
