import { create } from 'zustand';
import type { Task } from '../types';

type ModalType = 'newTask' | 'editTask' | 'newRun' | null;

interface UIStore {
  activeModal: ModalType;
  editingTask: Task | null;
  submitting: boolean;

  openModal: (modal: ModalType, task?: Task) => void;
  closeModal: () => void;
  setSubmitting: (v: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeModal: null,
  editingTask: null,
  submitting: false,

  openModal: (modal, task) => set({ activeModal: modal, editingTask: task || null }),
  closeModal: () => set({ activeModal: null, editingTask: null }),
  setSubmitting: (v) => set({ submitting: v }),
}));
