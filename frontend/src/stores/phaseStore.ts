import { create } from 'zustand';
import type { PhaseStatus, CaseResult, Candidate, LogEntry, SortState, FilterState, Phase5Data, Phase6Data, ChartData } from '../types';

interface PhaseStore {
  currentPhase: number;
  phaseStatus: Record<number, PhaseStatus>;

  // Phase 1
  p1Cases: CaseResult[];
  p1Sort: SortState;
  p1Filter: FilterState;
  p1Logs: LogEntry[];
  p1Progress: { current: number; total: number };
  p1EvalChart: ChartData | null;
  p1BucketChart: ChartData | null;
  p1Scores: { correct_plus_over: number; correct: number; over: number; wrong: number; total: number; correct_count: number; over_count: number; wrong_count: number } | null;

  // Phase 2
  p2Candidates: Candidate[];
  p2DesignSummary: string;
  p2Logs: LogEntry[];
  p2LearningRate: string;
  p2Feedback: string;
  selectedCandidateId: number | null;

  // Phase 3
  p3Logs: LogEntry[];
  p3Progress: { current: number; total: number };

  // Phase 4
  p4Cases: CaseResult[];
  p4Sort: SortState;
  p4Filter: FilterState;
  p4Logs: LogEntry[];
  p4Progress: { current: number; total: number };
  p4Scores: { correct_plus_over: number; correct: number; over: number; wrong: number } | null;

  // Phase 5
  p5Data: Phase5Data | null;
  p5Sort: SortState;
  p5Filter: FilterState;

  // Phase 6
  p6Data: Phase6Data | null;
  p6Logs: LogEntry[];
  p6LearningRate: string;

  // Actions
  setCurrentPhase: (p: number) => void;
  setPhaseStatus: (phase: number, status: PhaseStatus) => void;
  updatePhaseTabsFromRunData: (phases: Record<number, { status?: string }>) => void;

  // Phase 1 actions
  setP1Cases: (c: CaseResult[]) => void;
  addP1Case: (c: CaseResult) => void;
  addP1Cases: (c: CaseResult[]) => void;
  setP1Sort: (s: SortState) => void;
  setP1Filter: (f: FilterState) => void;
  setP1Logs: (l: LogEntry[]) => void;
  addP1Log: (l: LogEntry) => void;
  addP1Logs: (l: LogEntry[]) => void;
  clearP1Logs: () => void;
  setP1Progress: (p: { current: number; total: number }) => void;
  setP1Charts: (eval_: ChartData | null, bucket: ChartData | null) => void;
  setP1Scores: (s: PhaseStore['p1Scores']) => void;

  // Phase 2 actions
  setP2Candidates: (c: Candidate[]) => void;
  setP2DesignSummary: (s: string) => void;
  setP2Logs: (l: LogEntry[]) => void;
  addP2Log: (l: LogEntry) => void;
  clearP2Logs: () => void;
  setP2LearningRate: (r: string) => void;
  setP2Feedback: (f: string) => void;
  setSelectedCandidateId: (id: number | null) => void;

  // Phase 3 actions
  setP3Logs: (l: LogEntry[]) => void;
  addP3Log: (l: LogEntry) => void;
  clearP3Logs: () => void;
  setP3Progress: (p: { current: number; total: number }) => void;

  // Phase 4 actions
  setP4Cases: (c: CaseResult[]) => void;
  setP4Sort: (s: SortState) => void;
  setP4Filter: (f: FilterState) => void;
  setP4Logs: (l: LogEntry[]) => void;
  addP4Log: (l: LogEntry) => void;
  addP4Logs: (l: LogEntry[]) => void;
  clearP4Logs: () => void;
  setP4Progress: (p: { current: number; total: number }) => void;
  setP4Scores: (s: PhaseStore['p4Scores']) => void;

  // Phase 5 actions
  setP5Data: (d: Phase5Data | null) => void;
  setP5Sort: (s: SortState) => void;
  setP5Filter: (f: FilterState) => void;

  // Phase 6 actions
  setP6Data: (d: Phase6Data | null) => void;
  setP6Logs: (l: LogEntry[]) => void;
  addP6Log: (l: LogEntry) => void;
  clearP6Logs: () => void;
  setP6LearningRate: (r: string) => void;

  // Reset
  resetPhaseData: () => void;
}

const defaultSort: SortState = { col: null, dir: 1 };
const defaultFilter: FilterState = {};
const defaultProgress = { current: 0, total: 0 };

export const usePhaseStore = create<PhaseStore>((set) => ({
  currentPhase: 1,
  phaseStatus: {},

  p1Cases: [], p1Sort: { ...defaultSort }, p1Filter: { ...defaultFilter },
  p1Logs: [], p1Progress: { ...defaultProgress },
  p1EvalChart: null, p1BucketChart: null, p1Scores: null,

  p2Candidates: [], p2DesignSummary: '', p2Logs: [], p2LearningRate: '',
  p2Feedback: '', selectedCandidateId: null,

  p3Logs: [], p3Progress: { ...defaultProgress },

  p4Cases: [], p4Sort: { ...defaultSort }, p4Filter: { ...defaultFilter },
  p4Logs: [], p4Progress: { ...defaultProgress }, p4Scores: null,

  p5Data: null, p5Sort: { ...defaultSort }, p5Filter: { ...defaultFilter },

  p6Data: null, p6Logs: [], p6LearningRate: '',

  setCurrentPhase: (p) => {
    set({ currentPhase: p });
    localStorage.setItem('lastPhase', String(p));
  },

  setPhaseStatus: (phase, status) =>
    set((s) => ({ phaseStatus: { ...s.phaseStatus, [phase]: status } })),

  updatePhaseTabsFromRunData: (phases) =>
    set(() => {
      const ps: Record<number, PhaseStatus> = {};
      for (let i = 1; i <= 6; i++) {
        const ph = phases[i];
        ps[i] = (ph?.status as PhaseStatus) || 'idle';
      }
      // Phase 5 unlock when Phase 4 done
      const p4 = phases[4];
      if (p4?.status === 'completed' || p4?.status === 'done') {
        if (ps[5] === 'idle') ps[5] = 'done';
      }
      return { phaseStatus: ps };
    }),

  // P1
  setP1Cases: (c) => set({ p1Cases: c }),
  addP1Case: (c) => set((s) => ({ p1Cases: [...s.p1Cases, c] })),
  addP1Cases: (c) => set((s) => {
    const existingIds = new Set(s.p1Cases.map((x) => x.id));
    const deduped = c.filter((x) => !existingIds.has(x.id));
    return { p1Cases: [...s.p1Cases, ...deduped] };
  }),
  setP1Sort: (s) => set({ p1Sort: s }),
  setP1Filter: (f) => set({ p1Filter: f }),
  setP1Logs: (l) => set({ p1Logs: l }),
  addP1Log: (l) => set((s) => ({ p1Logs: [...s.p1Logs, l] })),
  addP1Logs: (ls) => set((s) => ({ p1Logs: [...s.p1Logs, ...ls] })),
  clearP1Logs: () => set({ p1Logs: [] }),
  setP1Progress: (p) => set({ p1Progress: p }),
  setP1Charts: (eval_, bucket) => set({ p1EvalChart: eval_, p1BucketChart: bucket }),
  setP1Scores: (s) => set({ p1Scores: s }),

  // P2
  setP2Candidates: (c) => set({ p2Candidates: c }),
  setP2DesignSummary: (s) => set({ p2DesignSummary: s }),
  setP2Logs: (l) => set({ p2Logs: l }),
  addP2Log: (l) => set((s) => ({ p2Logs: [...s.p2Logs, l] })),
  clearP2Logs: () => set({ p2Logs: [] }),
  setP2LearningRate: (r) => set({ p2LearningRate: r }),
  setP2Feedback: (f) => set({ p2Feedback: f }),
  setSelectedCandidateId: (id) => set({ selectedCandidateId: id }),

  // P3
  setP3Logs: (l) => set({ p3Logs: l }),
  addP3Log: (l) => set((s) => ({ p3Logs: [...s.p3Logs, l] })),
  clearP3Logs: () => set({ p3Logs: [] }),
  setP3Progress: (p) => set({ p3Progress: p }),

  // P4
  setP4Cases: (c) => set({ p4Cases: c }),
  setP4Sort: (s) => set({ p4Sort: s }),
  setP4Filter: (f) => set({ p4Filter: f }),
  setP4Logs: (l) => set({ p4Logs: l }),
  addP4Log: (l) => set((s) => ({ p4Logs: [...s.p4Logs, l] })),
  addP4Logs: (ls) => set((s) => ({ p4Logs: [...s.p4Logs, ...ls] })),
  clearP4Logs: () => set({ p4Logs: [] }),
  setP4Progress: (p) => set({ p4Progress: p }),
  setP4Scores: (s) => set({ p4Scores: s }),

  // P5
  setP5Data: (d) => set({ p5Data: d }),
  setP5Sort: (s) => set({ p5Sort: s }),
  setP5Filter: (f) => set({ p5Filter: f }),

  // P6
  setP6Data: (d) => set({ p6Data: d }),
  setP6Logs: (l) => set({ p6Logs: l }),
  addP6Log: (l) => set((s) => ({ p6Logs: [...s.p6Logs, l] })),
  clearP6Logs: () => set({ p6Logs: [] }),
  setP6LearningRate: (r) => set({ p6LearningRate: r }),

  resetPhaseData: () =>
    set({
      p1Cases: [], p1Logs: [], p1Progress: { ...defaultProgress },
      p1EvalChart: null, p1BucketChart: null, p1Scores: null,
      p2Candidates: [], p2DesignSummary: '', p2Logs: [], p2LearningRate: '', p2Feedback: '',
      selectedCandidateId: null,
      p3Logs: [], p3Progress: { ...defaultProgress },
      p4Cases: [], p4Logs: [], p4Progress: { ...defaultProgress }, p4Scores: null,
      p5Data: null,
      p6Data: null, p6Logs: [], p6LearningRate: '',
    }),
}));
