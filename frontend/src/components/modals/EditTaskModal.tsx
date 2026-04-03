import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '../shared/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';

export const EditTaskModal: React.FC = () => {
  const { activeModal, editingTask, closeModal, submitting, setSubmitting } = useUIStore();
  const { updateTask } = useTaskStore();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [genType, setGenType] = useState('');

  useEffect(() => {
    if (editingTask) {
      setName(editingTask.name || '');
      setDesc(editingTask.description || '');
      setGenType(editingTask.generation_task || '');
    }
  }, [editingTask]);

  const onSubmit = useCallback(async () => {
    if (!editingTask || !name.trim()) return;
    setSubmitting(true);
    try {
      await updateTask(editingTask.id, {
        name: name.trim(),
        description: desc.trim() || undefined,
        generation_task: genType.trim() || undefined,
      });
      closeModal();
    } catch (e) {
      alert('저장 오류: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [editingTask, name, desc, genType, updateTask, closeModal, setSubmitting]);

  return (
    <Modal
      open={activeModal === 'editTask'}
      onClose={closeModal}
      title="Task 편집"
      footer={
        <>
          <button
            className="py-2 px-4 bg-transparent text-ctp-mauve rounded-md font-semibold text-[13px] border border-ctp-mauve hover:bg-ctp-mauve/10"
            onClick={closeModal}
          >취소</button>
          <button
            className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
            onClick={onSubmit}
            disabled={!name.trim() || submitting}
          >저장</button>
        </>
      }
    >
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold">Task명 *</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold">설명</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold">요약 유형</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          value={genType}
          onChange={(e) => setGenType(e.target.value)}
        />
      </div>
    </Modal>
  );
};
