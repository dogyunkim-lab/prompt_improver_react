import React, { useState, useCallback } from 'react';
import { Modal } from '../shared/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';

export const NewTaskModal: React.FC = () => {
  const { activeModal, closeModal, submitting, setSubmitting } = useUIStore();
  const { createTask, setSelectedTaskId } = useTaskStore();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [genType, setGenType] = useState('');

  const onSubmit = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const task = await createTask({
        name: name.trim(),
        description: desc.trim() || undefined,
        generation_task: genType.trim() || undefined,
      });
      setSelectedTaskId(task.id);
      setName('');
      setDesc('');
      setGenType('');
      closeModal();
    } catch (e) {
      alert('생성 오류: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [name, desc, genType, createTask, setSelectedTaskId, closeModal, setSubmitting]);

  return (
    <Modal
      open={activeModal === 'newTask'}
      onClose={closeModal}
      title="새 실험 만들기"
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
          >만들기</button>
        </>
      }
    >
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold">Task명 *</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          placeholder="실험 이름 입력"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold">설명</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          placeholder="실험에 대한 설명"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold">요약 유형</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          placeholder="예: 불편사항 요약"
          value={genType}
          onChange={(e) => setGenType(e.target.value)}
        />
      </div>
    </Modal>
  );
};
