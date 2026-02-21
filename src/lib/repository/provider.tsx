'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { createClient } from '@/lib/supabase/client';
import { SupabaseRepository } from './supabase-repo';
import { IndexedDBRepository } from './indexeddb-repo';
import type { DataRepository } from './types';

const RepositoryContext = createContext<DataRepository | null>(null);

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);

  const repo = useMemo<DataRepository>(() => {
    if (user) {
      const supabase = createClient();
      return new SupabaseRepository(supabase);
    }
    return new IndexedDBRepository();
  }, [user]);

  return (
    <RepositoryContext.Provider value={repo}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): DataRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error('useRepository must be used within RepositoryProvider');
  return repo;
}
