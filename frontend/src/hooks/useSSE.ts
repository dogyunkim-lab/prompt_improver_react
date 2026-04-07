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

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 500;
const HEALTH_CHECK_MS = 3000;

export function useSSE(
  runId: number | null,
  phase: number | null,
  active: boolean,
  callbacks: SSECallbacks,
) {
  const esRef = useRef<EventSource | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const retryCount = useRef(0);
  const doneReceived = useRef(false);
  const healthTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const closeConnection = useCallback(() => {
    if (healthTimer.current) {
      clearInterval(healthTimer.current);
      healthTimer.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const openConnection = useCallback(() => {
    if (runId == null || phase == null) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const url = `/api/runs/${runId}/phase/${phase}/stream`;
    const es = new EventSource(url);
    esRef.current = es;
    doneReceived.current = false;

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
            doneReceived.current = true;
            cbRef.current.onDone?.(data.status);
            if (healthTimer.current) {
              clearInterval(healthTimer.current);
              healthTimer.current = null;
            }
            es.close();
            esRef.current = null;
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      if (doneReceived.current) return;
      es.close();
      esRef.current = null;

      if (retryCount.current < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, retryCount.current);
        retryCount.current++;
        setTimeout(() => {
          if (!doneReceived.current && runId != null && phase != null) {
            openConnection();
          }
        }, delay);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, phase]);

  // 메인 연결 관리
  useEffect(() => {
    if (!active || runId == null || phase == null) {
      closeConnection();
      retryCount.current = 0;
      doneReceived.current = false;
      return;
    }

    if (esRef.current && esRef.current.readyState !== EventSource.CLOSED) {
      return;
    }

    retryCount.current = 0;
    doneReceived.current = false;
    openConnection();

    return () => {
      closeConnection();
    };
  }, [runId, phase, active, openConnection, closeConnection]);

  // 탭 전환 시 재연결
  useEffect(() => {
    if (!active || runId == null || phase == null) return;

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (doneReceived.current) return;
      const es = esRef.current;
      if (!es || es.readyState === EventSource.CLOSED) {
        retryCount.current = 0;
        openConnection();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [active, runId, phase, openConnection]);

  // 주기적 연결 상태 확인
  useEffect(() => {
    if (!active || runId == null || phase == null) return;

    healthTimer.current = setInterval(() => {
      if (doneReceived.current) return;
      const es = esRef.current;
      if (!es || es.readyState === EventSource.CLOSED) {
        retryCount.current = 0;
        openConnection();
      }
    }, HEALTH_CHECK_MS);

    return () => {
      if (healthTimer.current) {
        clearInterval(healthTimer.current);
        healthTimer.current = null;
      }
    };
  }, [active, runId, phase, openConnection]);

  return { close: closeConnection };
}
