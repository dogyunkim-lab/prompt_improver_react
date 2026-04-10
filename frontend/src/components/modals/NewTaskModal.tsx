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
  const [taskType, setTaskType] = useState<'summarization' | 'classification'>('summarization');
  const [genType, setGenType] = useState('');
  const [gptBase, setGptBase] = useState('');
  const [gptKey, setGptKey] = useState('');
  const [gptModel, setGptModel] = useState('');
  const [simBase, setSimBase] = useState('');
  const [simKey, setSimKey] = useState('');
  const [simModel, setSimModel] = useState('');
  const [judgeBase, setJudgeBase] = useState('');
  const [judgeKey, setJudgeKey] = useState('');
  const [judgeModel, setJudgeModel] = useState('');
  const [anchorFile, setAnchorFile] = useState('');
  const [anchorOptions, setAnchorOptions] = useState<{ filename: string; name: string }[]>([]);
  const [showLLM, setShowLLM] = useState(false);
  const [showSimLLM, setShowSimLLM] = useState(false);
  const [showJudgeLLM, setShowJudgeLLM] = useState(false);
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
        task_type: taskType,
        generation_task: genType.trim() || undefined,
        gpt_api_base: gptBase.trim() || undefined,
        gpt_api_key: gptKey.trim() || undefined,
        gpt_model: gptModel.trim() || undefined,
        sim_api_base: simBase.trim() || undefined,
        sim_api_key: simKey.trim() || undefined,
        sim_model: simModel.trim() || undefined,
        judge_api_base: judgeBase.trim() || undefined,
        judge_api_key: judgeKey.trim() || undefined,
        judge_model: judgeModel.trim() || undefined,
        anchor_guide_file: anchorFile || undefined,
      });
      setSelectedTaskId(task.id);
      setName('');
      setDesc('');
      setTaskType('summarization');
      setGenType('');
      setGptBase('');
      setGptKey('');
      setGptModel('');
      setSimBase('');
      setSimKey('');
      setSimModel('');
      setJudgeBase('');
      setJudgeKey('');
      setJudgeModel('');
      setAnchorFile('');
      closeModal();
    } catch (e) {
      alert('생성 오류: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [name, desc, taskType, genType, gptBase, gptKey, gptModel, simBase, simKey, simModel, judgeBase, judgeKey, judgeModel, anchorFile, createTask, setSelectedTaskId, closeModal, setSubmitting]);

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
            title="새 실험을 생성합니다"
          >만들기</button>
        </>
      }
    >
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="실험을 구분하는 이름입니다">Task명 *</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          placeholder="실험 이름 입력"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="실험 목적이나 메모를 입력합니다">설명</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          placeholder="실험에 대한 설명"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="Task 유형을 선택합니다. Summarization은 LLM Judge로 정답/과답/오답 판정, Classification은 텍스트 일치 비교로 정답/오답 판정합니다.">Task 유형 *</label>
        <div className="flex gap-2">
          <button
            type="button"
            className={`flex-1 py-2 px-3 rounded-[7px] text-[13px] font-semibold border ${taskType === 'summarization' ? 'bg-ctp-mauve text-ctp-base border-ctp-mauve' : 'bg-warm-hover text-warm-text border-warm-border hover:border-ctp-mauve'}`}
            onClick={() => setTaskType('summarization')}
            title="STT 등의 입력으로부터 요약을 생성하는 Task. Phase 4에서 LLM Judge로 정답/과답/오답을 판정합니다."
          >Summarization</button>
          <button
            type="button"
            className={`flex-1 py-2 px-3 rounded-[7px] text-[13px] font-semibold border ${taskType === 'classification' ? 'bg-ctp-mauve text-ctp-base border-ctp-mauve' : 'bg-warm-hover text-warm-text border-warm-border hover:border-ctp-mauve'}`}
            onClick={() => setTaskType('classification')}
            title="STT 등의 입력으로부터 라벨을 생성하는 Task. Phase 4에서 reference와 generated 텍스트 일치 비교로 정답/오답을 판정합니다."
          >Classification</button>
        </div>
        <p className="text-[11px] text-[#888] mt-1">
          {taskType === 'summarization'
            ? 'Summarization: Phase 4 LLM Judge 사용 (정답/과답/오답)'
            : 'Classification: Phase 4 텍스트 일치 비교 (정답/오답)'}
        </p>
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="이 실험에서 다루는 요약 종류 (예: 민원내용). GPT가 분석 시 참고합니다.">요약 유형</label>
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
          title="Phase 1/2/6 분석에 사용할 LLM을 지정합니다. 비워두면 서버 기본값을 사용합니다."
        >{showLLM ? '▾ 분석 LLM 설정 접기' : '▸ 분석 LLM 설정 (Phase 1/2/6)'}</button>
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
          title="Phase 2 Mini-validation에서 워크플로우 시뮬레이션에 사용할 생성 모델입니다. 실제 Dify 워크플로우 모델과 동일하게 설정하세요."
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
          className="text-xs text-ctp-blue font-semibold hover:underline"
          onClick={() => setShowJudgeLLM(!showJudgeLLM)}
          title="Phase 4 Judge에 사용할 LLM. Judge는 GPT 기준으로 설계되었으므로 GPT 권장. 비워두면 분석 LLM 설정을 사용합니다."
        >{showJudgeLLM ? '▾ Judge LLM 설정 접기' : '▸ Judge LLM 설정 (Phase 4 — GPT 권장)'}</button>
      </div>
      {showJudgeLLM && (
        <div className="pl-2 border-l-2 border-ctp-blue/30 mb-3.5 space-y-2.5">
          <p className="text-[11px] text-[#888]">Phase 4 Judge 판정 및 Phase 2 mini-validation 판정에 사용. Judge 프롬프트는 GPT 기준으로 설계되어 있으므로 GPT 계열 권장. 비워두면 분석 LLM 설정으로 폴백합니다.</p>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">API Base URL</label>
            <input
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-blue focus:outline-none"
              placeholder="비워두면 분석 LLM 설정 사용"
              value={judgeBase}
              onChange={(e) => setJudgeBase(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">API Key</label>
            <input
              type="password"
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-blue focus:outline-none"
              placeholder="비워두면 분석 LLM 설정 사용"
              value={judgeKey}
              onChange={(e) => setJudgeKey(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-[#666] mb-1 font-semibold">모델명</label>
            <input
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-blue focus:outline-none"
              placeholder="예: gpt-oss-120b-26"
              value={judgeModel}
              onChange={(e) => setJudgeModel(e.target.value)}
            />
          </div>
        </div>
      )}
      <div className="mb-1">
        <button
          type="button"
          className="text-xs text-ctp-peach font-semibold hover:underline"
          onClick={() => setShowAnchor(!showAnchor)}
          title="Phase 2에서 GPT가 프롬프트를 설계할 때 항상 참조하는 고정 가이드입니다"
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
