'use client';

import { useEffect, useRef } from 'react';
import { useNavigationLockStore } from '@/stores/navigation-lock-store';

/**
 * Locks bottom navigation while `active` is true.
 * Handles nested/overlapping async operations safely with a counter.
 */
export function useBottomNavLock(active: boolean) {
  const lock = useNavigationLockStore((s) => s.lock);
  const unlock = useNavigationLockStore((s) => s.unlock);
  const lockedRef = useRef(false);

  useEffect(() => {
    if (active && !lockedRef.current) {
      lock();
      lockedRef.current = true;
    } else if (!active && lockedRef.current) {
      unlock();
      lockedRef.current = false;
    }

    return () => {
      if (lockedRef.current) {
        unlock();
        lockedRef.current = false;
      }
    };
  }, [active, lock, unlock]);
}
