'use client';

import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  setUser: (user) => {
    // Skip if same user ID to avoid unnecessary re-renders / repo recreation
    const current = get().user;
    if (current?.id === user?.id && !get().loading) return;
    set({ user, loading: false });
  },
  setLoading: (loading) => set({ loading }),
  clear: () => set({ user: null, loading: false }),
}));
