import { apiFetch } from './client';

export function uploadJudge(runId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<{ ok: boolean; file_path: string; original_name: string }>(
    `/api/runs/${runId}/upload-judge`,
    { method: 'POST', body: form },
  );
}

export function uploadPrompt(runId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<{ ok: boolean; file_path: string; original_name: string }>(
    `/api/runs/${runId}/upload-prompt`,
    { method: 'POST', body: form },
  );
}

export function saveUserGuide(runId: number, userGuide: string) {
  return apiFetch<{ ok: boolean }>(`/api/runs/${runId}/user-guide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_guide: userGuide }),
  });
}
