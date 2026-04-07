import { apiFetch } from './client';
import type { Task } from '../types';

export function fetchTasks(): Promise<Task[]> {
  return apiFetch<Task[]>('/api/tasks');
}

export function createTask(data: { name: string; description?: string; generation_task?: string; gpt_api_base?: string; gpt_api_key?: string; gpt_model?: string; sim_api_base?: string; sim_api_key?: string; sim_model?: string }): Promise<Task> {
  return apiFetch<Task>('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function updateTask(id: number, data: { name?: string; description?: string; generation_task?: string; gpt_api_base?: string; gpt_api_key?: string; gpt_model?: string; sim_api_base?: string; sim_api_key?: string; sim_model?: string }): Promise<Task> {
  return apiFetch<Task>(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteTask(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
}
