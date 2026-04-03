import { useEffect, useRef, useCallback } from 'react';
import type { SSEEvent } from '../types';

interface SSECallbacks {
  onLog?: (level: string, message: string, ts: string) => void;
  onProgress?: (current: number, total: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCase?: (data: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onResult?: (data: any) => void;
  onDone?: (status: string) => void;
  onError?: (err: Event) => void;
}

export function useSSE(
  runId: number | null,
  phase: number | null,
  active: boolean,
  callbacks: SSECallbacks,
) {
  const esRef = useRef<EventSource | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active || runId == null || phase == null) {
      close();
      return;
    }

    // Avoid duplicate connections in StrictMode
    if (esRef.current) return;

    const url = `/api/runs/${runId}/phase/${phase}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const data: SSEEvent = JSON.parse(ev.data);
        switch (data.type) {
          case 'log':
            cbRef.current.onLog?.(data.level, data.message, data.ts);
            break;
          case 'progress':
            cbRef.current.onProgress?.(data.current, data.total);
            break;
          case 'case':
            cbRef.current.onCase?.(data.data);
            break;
          case 'result':
            cbRef.current.onResult?.(data.data);
            break;
          case 'done':
            cbRef.current.onDone?.(data.status);
            close();
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = (err) => {
      cbRef.current.onError?.(err);
      close();
    };

    return () => {
      close();
    };
  }, [runId, phase, active, close]);

  return { close };
}
