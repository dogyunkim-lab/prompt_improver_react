import { create } from 'zustand';
import type { Task } from '../types';
import * as taskApi from '../api/tasks';

interface TaskStore {
  tasks: Task[];
  selectedTaskId: number | null;
  taskFilter: string;
  expandedRunTaskIds: Record<number, boolean>;

  setTaskFilter: (f: string) => void;
  toggleExpand: (taskId: number) => void;
  setSelectedTaskId: (id: number | null) => void;
  loadTasks: () => Promise<void>;
  createTask: (data: { name: string; description?: string; generation_task?: string }) => Promise<Task>;
  updateTask: (id: number, data: { name?: string; description?: string; generation_task?: string }) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  refreshTasks: () => Promise<void>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  taskFilter: '',
  expandedRunTaskIds: {},

  setTaskFilter: (f) => set({ taskFilter: f }),

  toggleExpand: (taskId) =>
    set((s) => {
      const next = { ...s.expandedRunTaskIds };
      if (next[taskId]) delete next[taskId];
      else next[taskId] = true;
      return { expandedRunTaskIds: next };
    }),

  setSelectedTaskId: (id) => {
    set({ selectedTaskId: id });
    if (id != null) localStorage.setItem('lastTaskId', String(id));
  },

  loadTasks: async () => {
    try {
      const tasks = await taskApi.fetchTasks();
      set({ tasks: Array.isArray(tasks) ? tasks : [] });
    } catch {
      set({ tasks: [] });
    }
  },

  createTask: async (data) => {
    const task = await taskApi.createTask(data);
    await get().loadTasks();
    return task;
  },

  updateTask: async (id, data) => {
    await taskApi.updateTask(id, data);
    await get().loadTasks();
  },

  deleteTask: async (id) => {
    await taskApi.deleteTask(id);
    const s = get();
    if (s.selectedTaskId === id) {
      set({ selectedTaskId: null });
      localStorage.removeItem('lastTaskId');
      localStorage.removeItem('lastRunId');
    }
    await s.loadTasks();
  },

  refreshTasks: async () => {
    await get().loadTasks();
  },
}));
