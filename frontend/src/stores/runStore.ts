import { create } from 'zustand';
import type { RunDetail } from '../types';
import { fetchRunDetail } from '../api/runs';

interface RunStore {
  selectedRunId: number | null;
  runData: RunDetail | null;
  runningPhase: Record<number, number>; // runId -> phase

  setSelectedRunId: (id: number | null) => void;
  loadRunData: (runId: number) => Promise<RunDetail>;
  setRunData: (data: RunDetail | null) => void;
  setRunningPhase: (runId: number, phase: number | null) => void;
  clearRun: () => void;
}

export const useRunStore = create<RunStore>((set) => ({
  selectedRunId: null,
  runData: null,
  runningPhase: {},

  setSelectedRunId: (id) => {
    set({ selectedRunId: id });
    if (id != null) localStorage.setItem('lastRunId', String(id));
  },

  loadRunData: async (runId: number) => {
    const data = await fetchRunDetail(runId);
    set({ runData: data, selectedRunId: runId });
    return data;
  },

  setRunData: (data) => set({ runData: data }),

  setRunningPhase: (runId, phase) =>
    set((s) => {
      const next = { ...s.runningPhase };
      if (phase == null) delete next[runId];
      else next[runId] = phase;
      return { runningPhase: next };
    }),

  clearRun: () => set({ selectedRunId: null, runData: null }),
}));
