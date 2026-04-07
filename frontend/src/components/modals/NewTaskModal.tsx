import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '../shared/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';
import { fetchAnchorList } from '../../api/tasks';

export const NewTaskModal: React.FC = () => {
  const { activeModal, closeModal, submitting, setSubmitting } = useUIStore();
  const { createTask, setSelectedTaskId } = useTaskStore();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [genType, setGenType] = useState('');
  const [gptBase, setGptBase] = useState('');
  const [gptKey, setGptKey] = useState('');
  const [gptModel, setGptModel] = useState('');
  const [simBase, setSimBase] = useState('');
  const [simKey, setSimKey] = useState('');
  const [simModel, setSimModel] = useState('');
  const [anchorFile, setAnchorFile] = useState('');
  const [anchorOptions, setAnchorOptions] = useState<{ filename: string; name: string }[]>([]);
  const [showLLM, setShowLLM] = useState(false);
  const [showSimLLM, setShowSimLLM] = useState(false);
  const [showAnchor, setShowAnchor] = useState(false);

  useEffect(() => {
    if (activeModal === 'newTask') {
      fetchAnchorList().then(setAnchorOptions).catch(() => setAnchorOptions([]));
    }
  }, [activeModal]);

  const onSubmit = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const task = await createTask({
        name: name.trim(),
        description: desc.trim() || undefined,
        generation_task: genType.trim() || undefined,
        gpt_api_base: gptBase.trim() || undefined,
        gpt_api_key: gptKey.trim() || undefined,
        gpt_model: gptModel.trim() || undefined,
        sim_api_base: simBase.trim() || undefined,
        sim_api_key: simKey.trim() || undefined,
        sim_model: simModel.trim() || undefined,
        anchor_guide_file: anchorFile || undefined,
      });
      setSelectedTaskId(task.id);
      setName('');
      setDesc('');
      setGenType('');
      setGptBase('');
      setGptKey('');
      setGptModel('');
      setSimBase('');
      setSimKey('');
      setSimModel('');
      setAnchorFile('');
      closeModal();
    } catch (e) {
      alert('생성 오류: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [name, desc, genType, gptBase, gptKey, gptModel, simBase, simKey, simModel, anchorFile, createTask, setSelectedTaskId, closeModal, setSubmitting]);

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
      <div className="mb-1">
        <button
          type="button"
          className="text-xs text-ctp-peach font-semibold hover:underline"
          onClick={() => setShowAnchor(!showAnchor)}
        >{showAnchor ? '▾ 앵커 가이드 접기' : '▸ 앵커 가이드 (Phase 2 전략 고정 가이드)'}</button>
      </div>
      {showAnchor && (
        <div className="pl-2 border-l-2 border-ctp-peach/30 mb-3.5 space-y-2.5">
          <p className="text-[11px] text-[#888]">Phase 2에서 GPT가 프롬프트를 설계할 때 참조하는 고정 가이드입니다. prompts/anchors/ 폴더에서 선택합니다.</p>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">앵커 가이드 파일</label>
            <select
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-peach focus:outline-none"
              value={anchorFile}
              onChange={(e) => setAnchorFile(e.target.value)}
            >
              <option value="">사용 안 함</option>
              {anchorOptions.map((a) => (
                <option key={a.filename} value={a.filename}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
};
