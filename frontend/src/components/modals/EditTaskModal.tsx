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
  const [gptBase, setGptBase] = useState('');
  const [gptKey, setGptKey] = useState('');
  const [gptModel, setGptModel] = useState('');
  const [simBase, setSimBase] = useState('');
  const [simKey, setSimKey] = useState('');
  const [simModel, setSimModel] = useState('');
  const [showLLM, setShowLLM] = useState(false);
  const [showSimLLM, setShowSimLLM] = useState(false);

  useEffect(() => {
    if (editingTask) {
      setName(editingTask.name || '');
      setDesc(editingTask.description || '');
      setGenType(editingTask.generation_task || '');
      setGptBase(editingTask.gpt_api_base || '');
      setGptKey(editingTask.gpt_api_key || '');
      setGptModel(editingTask.gpt_model || '');
      setSimBase(editingTask.sim_api_base || '');
      setSimKey(editingTask.sim_api_key || '');
      setSimModel(editingTask.sim_model || '');
      setShowLLM(!!(editingTask.gpt_api_base || editingTask.gpt_api_key || editingTask.gpt_model));
      setShowSimLLM(!!(editingTask.sim_api_base || editingTask.sim_api_key || editingTask.sim_model));
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
        gpt_api_base: gptBase.trim(),
        gpt_api_key: gptKey.trim(),
        gpt_model: gptModel.trim(),
        sim_api_base: simBase.trim(),
        sim_api_key: simKey.trim(),
        sim_model: simModel.trim(),
      });
      closeModal();
    } catch (e) {
      alert('저장 오류: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [editingTask, name, desc, genType, gptBase, gptKey, gptModel, simBase, simKey, simModel, updateTask, closeModal, setSubmitting]);

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
      <div className="mb-1">
        <button
          type="button"
          className="text-xs text-ctp-mauve font-semibold hover:underline"
          onClick={() => setShowLLM(!showLLM)}
        >{showLLM ? '▾ LLM 설정 접기' : '▸ LLM 설정 (선택)'}</button>
      </div>
      {showLLM && (
        <div className="pl-2 border-l-2 border-ctp-mauve/30 mb-3.5 space-y-2.5">
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">API Base URL</label>
            <input
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
              placeholder="기본값 사용 시 비워두세요"
              value={gptBase}
              onChange={(e) => setGptBase(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">API Key</label>
            <input
              type="password"
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
              placeholder="기본값 사용 시 비워두세요"
              value={gptKey}
              onChange={(e) => setGptKey(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">모델명</label>
            <input
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
              placeholder="기본값 사용 시 비워두세요"
              value={gptModel}
              onChange={(e) => setGptModel(e.target.value)}
            />
          </div>
        </div>
      )}
      <div className="mb-1">
        <button
          type="button"
          className="text-xs text-ctp-teal font-semibold hover:underline"
          onClick={() => setShowSimLLM(!showSimLLM)}
        >{showSimLLM ? '▾ 시뮬레이션 LLM 설정 접기' : '▸ 시뮬레이션 LLM 설정 (Mini-validation 생성 모델)'}</button>
      </div>
      {showSimLLM && (
        <div className="pl-2 border-l-2 border-ctp-teal/30 mb-3.5 space-y-2.5">
          <p className="text-[11px] text-[#888]">Mini-validation에서 워크플로우 시뮬레이션에 사용할 생성 모델 (예: qwen3.5-35B-A3B)</p>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">API Base URL</label>
            <input
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-teal focus:outline-none"
              placeholder="기본값 사용 시 비워두세요"
              value={simBase}
              onChange={(e) => setSimBase(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">API Key</label>
            <input
              type="password"
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-teal focus:outline-none"
              placeholder="기본값 사용 시 비워두세요"
              value={simKey}
              onChange={(e) => setSimKey(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">모델명</label>
            <input
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-teal focus:outline-none"
              placeholder="예: qwen3.5-35B-A3B"
              value={simModel}
              onChange={(e) => setSimModel(e.target.value)}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};
