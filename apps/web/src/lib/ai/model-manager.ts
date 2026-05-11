'use client';

import type { ModelStatus, ModelStatusListener } from './types';

const INSTALLED_KEY = 'gemma4-model-installed';
const DISMISSED_KEY = 'gemma4-download-prompt-dismissed';

let currentStatus: ModelStatus = { state: 'not_installed' };
const listeners = new Set<ModelStatusListener>();

function readInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(INSTALLED_KEY) === 'true';
}

function emit() {
  for (const listener of listeners) listener(currentStatus);
}

if (typeof window !== 'undefined' && readInstalled()) {
  currentStatus = { state: 'installed' };
}

export function getModelStatus(): ModelStatus {
  return currentStatus;
}

export function subscribeModelStatus(listener: ModelStatusListener): () => void {
  listeners.add(listener);
  listener(currentStatus);
  return () => {
    listeners.delete(listener);
  };
}

export function setModelStatus(status: ModelStatus): void {
  currentStatus = status;
  if (typeof window !== 'undefined') {
    if (status.state === 'installed') {
      localStorage.setItem(INSTALLED_KEY, 'true');
    } else if (status.state === 'not_installed') {
      localStorage.removeItem(INSTALLED_KEY);
    }
  }
  emit();
}

export function isDownloadPromptDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(DISMISSED_KEY) === 'true';
}

export function setDownloadPromptDismissed(dismissed: boolean): void {
  if (typeof window === 'undefined') return;
  if (dismissed) {
    localStorage.setItem(DISMISSED_KEY, 'true');
  } else {
    localStorage.removeItem(DISMISSED_KEY);
  }
}

export async function deleteModel(): Promise<void> {
  if (typeof window === 'undefined') return;
  if ('caches' in window) {
    const names = await caches.keys();
    // Match both our project-specific key (`env.cacheKey` set in gemma-web)
    // and the upstream default — the latter covers caches left over from
    // earlier builds before we renamed.
    await Promise.all(
      names
        .filter(
          (name) =>
            name.startsWith('nivoca-gemma-cache') ||
            name.startsWith('transformers-cache'),
        )
        .map((name) => caches.delete(name)),
    );
  }
  setModelStatus({ state: 'not_installed' });
}

export async function requestStoragePersist(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
