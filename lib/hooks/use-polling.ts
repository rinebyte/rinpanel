"use client";

import { useEffect, useState } from "react";

export interface PollState<T> {
  data: T | null;
  error: boolean;
  loading: boolean;
}

export function usePolling<T>(url: string, intervalMs: number): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: false, loading: true });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as T;
        if (active) setState({ data, error: false, loading: false });
      } catch (e) {
        if (active && !(e instanceof DOMException && e.name === "AbortError")) {
          setState((s) => ({ data: s.data, error: true, loading: false }));
        }
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, [url, intervalMs]);

  return state;
}
