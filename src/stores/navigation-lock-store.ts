'use client';

import { create } from 'zustand';

interface NavigationLockState {
  lockCount: number;
  lock: () => void;
  unlock: () => void;
}

export const useNavigationLockStore = create<NavigationLockState>((set) => ({
  lockCount: 0,
  lock: () => set((state) => ({ lockCount: state.lockCount + 1 })),
  unlock: () =>
    set((state) => ({
      lockCount: Math.max(0, state.lockCount - 1),
    })),
}));
