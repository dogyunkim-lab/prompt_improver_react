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

const FLUSH_INTERVAL = 300;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 500;
const HEALTH_CHECK_MS = 3000;

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
  const healthTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCount = useRef(0);
  const doneReceived = useRef(false);

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

  const closeConnection = useCallback(() => {
    if (healthTimer.current) {
      clearInterval(healthTimer.current);
      healthTimer.current = null;
    }
    if (flushTimer.current) {
      clearInterval(flushTimer.current);
      flushTimer.current = null;
    }
    flush();
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, [flush]);

  const openConnection = useCallback(() => {
    if (runId == null || phase == null) return;
    // 기존 연결 정리
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const url = `/api/runs/${runId}/phase/${phase}/stream`;
    const es = new EventSource(url);
    esRef.current = es;
    doneReceived.current = false;

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
            flush();
            cbRef.current.onResult?.(data.data);
            break;
          case 'done':
            flush();
            doneReceived.current = true;
            cbRef.current.onDone?.(data.status);
            if (flushTimer.current) {
              clearInterval(flushTimer.current);
              flushTimer.current = null;
            }
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
      // 이미 done을 받았으면 에러 무시
      if (doneReceived.current) return;

      // 연결 에러 시 정리 후 재시도
      es.close();
      esRef.current = null;
      if (flushTimer.current) {
        clearInterval(flushTimer.current);
        flushTimer.current = null;
      }

      if (retryCount.current < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, retryCount.current);
        retryCount.current++;
        setTimeout(() => {
          // active 상태이고 done을 아직 안 받았으면 재연결
          if (!doneReceived.current && runId != null && phase != null) {
            openConnection();
          }
        }, delay);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, phase, flush]);

  // 메인 연결 관리
  useEffect(() => {
    if (!active || runId == null || phase == null) {
      closeConnection();
      retryCount.current = 0;
      doneReceived.current = false;
      return;
    }

    // 이미 살아있는 연결이 있으면 스킵
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

  // 탭 전환 시 연결 상태 확인 + 재연결
  useEffect(() => {
    if (!active || runId == null || phase == null) return;

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (doneReceived.current) return;

      // 탭이 다시 보일 때 연결 상태 확인
      const es = esRef.current;
      if (!es || es.readyState === EventSource.CLOSED) {
        retryCount.current = 0;
        openConnection();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [active, runId, phase, openConnection]);

  // 주기적 연결 상태 확인 (3초마다)
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
