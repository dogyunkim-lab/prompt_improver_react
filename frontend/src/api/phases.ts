import { apiFetch } from './client';
import type { Phase5Data } from '../types';

export function runPhase(runId: number, phase: number) {
  return apiFetch<{ ok: boolean }>(`/api/runs/${runId}/phase/${phase}/run`, { method: 'POST' });
}

export function cancelPhase(runId: number, phase: number) {
  return apiFetch<{ ok: boolean }>(`/api/runs/${runId}/phase/${phase}/cancel`, { method: 'POST' });
}

export function selectCandidate(runId: number, candidateId: number) {
  return apiFetch<{ ok: boolean; selected_candidate_id: number }>(
    `/api/runs/${runId}/select-candidate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: candidateId }),
    },
  );
}

export function connectDify(runId: number, objectId: string, candidateId?: number, label?: string) {
  return apiFetch<{ id: number; status: string; verified: boolean; message?: string }>(
    `/api/runs/${runId}/phase/3/connect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_id: objectId, candidate_id: candidateId, label }),
    },
  );
}

export function executeDify(runId: number) {
  return apiFetch<{ ok: boolean }>(`/api/runs/${runId}/phase/3/execute`, { method: 'POST' });
}

export function fetchPhase5(runId: number) {
  return apiFetch<Phase5Data>(`/api/runs/${runId}/phase/5`);
}

export function getSSEUrl(runId: number, phase: number): string {
  return `/api/runs/${runId}/phase/${phase}/stream`;
}
