import { apiFetch } from './client';
import type { Run, RunDetail } from '../types';

export function fetchRuns(taskId: number): Promise<Run[]> {
  return apiFetch<Run[]>(`/api/tasks/${taskId}/runs`);
}

export function createRun(taskId: number, data: { start_mode: 'zero' | 'continue'; base_run_id?: number }): Promise<Run> {
  return apiFetch<Run>(`/api/tasks/${taskId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function fetchRunDetail(runId: number): Promise<RunDetail> {
  return apiFetch<RunDetail>(`/api/runs/${runId}`);
}

export function fetchRunSummary(runId: number) {
  return apiFetch<{ current_run: RunDetail; task_history: Run[] }>(`/api/runs/${runId}/summary`);
}

export function deleteRun(runId: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/runs/${runId}`, { method: 'DELETE' });
}
