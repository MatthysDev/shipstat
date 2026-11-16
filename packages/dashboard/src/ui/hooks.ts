import { useEffect, useState } from 'react';

interface AsyncState<T> {
  key: string;
  data?: T;
  error?: string;
}

/**
 * Runs an async loader whenever `deps` change. The previous data stays visible while the
 * next one loads; `loading` is derived, so no state is set synchronously in the effect.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<AsyncState<T>>({ key: '' });
  useEffect(() => {
    let alive = true;
    fn().then(
      (data) => alive && setState({ key, data }),
      (e: unknown) => alive && setState((s) => ({ key, data: s.data, error: e instanceof Error ? e.message : String(e) }))
    );
    return () => {
      alive = false;
    };
    // `key` captures deps by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { data: state.data, error: state.key === key ? state.error : undefined, loading: state.key !== key };
}
