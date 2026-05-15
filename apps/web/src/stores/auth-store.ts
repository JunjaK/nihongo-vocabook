'use client';

import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { fetchProfile, type UserProfile } from '@/lib/profile/fetch';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Cached user_settings row. Loaded once when user becomes non-null. */
  profile: UserProfile | null;
  profileLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  /** Replace the cached profile (call this after a successful save). */
  setProfile: (profile: UserProfile | null) => void;
  /** Fetch profile from /api/profile and cache it. No-op if not signed in. */
  loadProfile: () => Promise<void>;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  profile: null,
  profileLoading: false,
  setUser: (user) => {
    const current = get().user;
    // Skip if same user ID to avoid unnecessary re-renders / repo recreation.
    // The early-return also protects the profile cache from being reset on
    // re-fires of the same auth state (initial getUser + onAuthStateChange).
    if (current?.id === user?.id && !get().loading) return;
    set({ user, loading: false, profile: null, profileLoading: false });
  },
  setLoading: (loading) => set({ loading }),
  setProfile: (profile) => set({ profile }),
  loadProfile: async () => {
    if (!get().user) {
      set({ profile: null, profileLoading: false });
      return;
    }
    set({ profileLoading: true });
    try {
      const profile = await fetchProfile();
      set({ profile, profileLoading: false });
    } catch {
      set({ profileLoading: false });
    }
  },
  clear: () => set({ user: null, loading: false, profile: null, profileLoading: false }),
}));
