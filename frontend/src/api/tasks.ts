import { apiFetch } from './client';
import type { Task } from '../types';

export function fetchTasks(): Promise<Task[]> {
  return apiFetch<Task[]>('/api/tasks');
}

export function fetchAnchorList(): Promise<{ filename: string; name: string }[]> {
  return apiFetch('/api/tasks/anchors/list');
}

export function createTask(data: {
  name: string; description?: string; generation_task?: string;
  task_type?: 'summarization' | 'classification';
  gpt_api_base?: string; gpt_api_key?: string; gpt_model?: string;
  sim_api_base?: string; sim_api_key?: string; sim_model?: string;
  anchor_guide_file?: string;
  label_list?: string[] | string;
  label_definitions?: Record<string, string> | string;
}): Promise<Task> {
  return apiFetch<Task>('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function updateTask(id: number, data: {
  name?: string; description?: string; generation_task?: string;
  task_type?: 'summarization' | 'classification';
  gpt_api_base?: string; gpt_api_key?: string; gpt_model?: string;
  sim_api_base?: string; sim_api_key?: string; sim_model?: string;
  anchor_guide_file?: string;
  label_list?: string[] | string;
  label_definitions?: Record<string, string> | string;
}): Promise<Task> {
  return apiFetch<Task>(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteTask(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
}
