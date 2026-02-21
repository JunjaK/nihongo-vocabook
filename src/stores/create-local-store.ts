'use client';

import {
  createContext,
  createElement,
  useContext,
  useRef,
  type ReactNode,
} from 'react';
import { createStore, useStore, type StateCreator, type StoreApi } from 'zustand';

export function createLocalStore<T>(initializer: StateCreator<T>) {
  const StoreContext = createContext<StoreApi<T> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const storeRef = useRef<StoreApi<T> | null>(null);
    if (!storeRef.current) {
      storeRef.current = createStore(initializer);
    }
    return createElement(StoreContext, { value: storeRef.current }, children);
  }

  function useLocalStore<U>(selector: (state: T) => U): U {
    const store = useContext(StoreContext);
    if (!store) throw new Error('Missing Provider');
    return useStore(store, selector);
  }

  return { Provider, useStore: useLocalStore };
}
