import { useSyncExternalStore } from 'react';

/** Small typed wrapper around localStorage, tolerant to corrupt or missing values. */
export function readJson<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return isValid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Triggers a JSON file download in the browser. */
export function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface Store<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (fn: () => void) => () => void;
}

/** A value kept in localStorage that every component reading it follows. */
export function createStore<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): Store<T> {
  let value = readJson(key, fallback, isValid);
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      try {
        writeJson(key, next);
      } catch {
        // Storage full or unavailable: keep the value for this visit.
      }
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T>(s: Store<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
