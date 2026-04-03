import { useEffect, useRef, useCallback } from 'react';
import type { SSEEvent } from '../types';

interface SSECallbacks {
  onLog?: (level: string, message: string, ts: string) => void;
  onLogBatch?: (logs: { level: string; message: string; ts: string }[]) => void;
  onProgress?: (current: number, total: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCase?: (data: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCaseBatch?: (data: any[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onResult?: (data: any) => void;
  onDone?: (status: string) => void;
  onError?: (err: Event) => void;
}

const FLUSH_INTERVAL = 300; // ms - flush batched updates every 300ms

export function useSSEBuffered(
  runId: number | null,
  phase: number | null,
  active: boolean,
  callbacks: SSECallbacks,
) {
  const esRef = useRef<EventSource | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  // Batch buffers
  const logBuffer = useRef<{ level: string; message: string; ts: string }[]>([]);
  const caseBuffer = useRef<unknown[]>([]);
  const lastProgress = useRef<{ current: number; total: number } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const flush = useCallback(() => {
    const cb = cbRef.current;
    if (logBuffer.current.length > 0) {
      if (cb.onLogBatch) {
        cb.onLogBatch(logBuffer.current);
      } else if (cb.onLog) {
        for (const l of logBuffer.current) cb.onLog(l.level, l.message, l.ts);
      }
      logBuffer.current = [];
    }
    if (caseBuffer.current.length > 0) {
      if (cb.onCaseBatch) {
        cb.onCaseBatch(caseBuffer.current);
      } else if (cb.onCase) {
        for (const c of caseBuffer.current) cb.onCase(c);
      }
      caseBuffer.current = [];
    }
    if (lastProgress.current) {
      cb.onProgress?.(lastProgress.current.current, lastProgress.current.total);
      lastProgress.current = null;
    }
  }, []);

  const close = useCallback(() => {
    if (flushTimer.current) {
      clearInterval(flushTimer.current);
      flushTimer.current = null;
    }
    flush(); // flush remaining data
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, [flush]);

  useEffect(() => {
    if (!active || runId == null || phase == null) {
      close();
      return;
    }

    if (esRef.current) return;

    const url = `/api/runs/${runId}/phase/${phase}/stream`;
    const es = new EventSource(url);
    esRef.current = es;

    // Start flush interval
    flushTimer.current = setInterval(flush, FLUSH_INTERVAL);

    es.onmessage = (ev) => {
      try {
        const data: SSEEvent = JSON.parse(ev.data);
        switch (data.type) {
          case 'log':
            logBuffer.current.push({ level: data.level, message: data.message, ts: data.ts });
            break;
          case 'progress':
            lastProgress.current = { current: data.current, total: data.total };
            break;
          case 'case':
            caseBuffer.current.push(data.data);
            break;
          case 'result':
            flush(); // flush pending before result
            cbRef.current.onResult?.(data.data);
            break;
          case 'done':
            flush(); // flush pending before done
            cbRef.current.onDone?.(data.status);
            if (flushTimer.current) {
              clearInterval(flushTimer.current);
              flushTimer.current = null;
            }
            es.close();
            esRef.current = null;
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = (err) => {
      flush();
      cbRef.current.onError?.(err);
      close();
    };

    return () => {
      close();
    };
  }, [runId, phase, active, close, flush]);

  return { close };
}
