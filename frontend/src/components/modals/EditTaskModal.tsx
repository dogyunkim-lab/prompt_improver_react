import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '../shared/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';
import { fetchAnchorList } from '../../api/tasks';

export const EditTaskModal: React.FC = () => {
  const { activeModal, editingTask, closeModal, submitting, setSubmitting } = useUIStore();
  const { updateTask } = useTaskStore();
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
  const [anchorFile, setAnchorFile] = useState('');
  const [anchorOptions, setAnchorOptions] = useState<{ filename: string; name: string }[]>([]);
  const [labelListInput, setLabelListInput] = useState('');
  const [labelDefinitionsInput, setLabelDefinitionsInput] = useState('');
  const [showLLM, setShowLLM] = useState(false);
  const [showSimLLM, setShowSimLLM] = useState(false);
  const [showAnchor, setShowAnchor] = useState(false);

  useEffect(() => {
    if (activeModal === 'editTask') {
      fetchAnchorList().then(setAnchorOptions).catch(() => setAnchorOptions([]));
    }
  }, [activeModal]);

  useEffect(() => {
    if (editingTask) {
      setName(editingTask.name || '');
      setDesc(editingTask.description || '');
      setTaskType((editingTask.task_type as 'summarization' | 'classification') || 'summarization');
      setGenType(editingTask.generation_task || '');
      setGptBase(editingTask.gpt_api_base || '');
      setGptKey(editingTask.gpt_api_key || '');
      setGptModel(editingTask.gpt_model || '');
      setSimBase(editingTask.sim_api_base || '');
      setSimKey(editingTask.sim_api_key || '');
      setSimModel(editingTask.sim_model || '');
      setAnchorFile(editingTask.anchor_guide_file || '');
      // Classification 라벨 메타데이터 (배열/객체 → 텍스트)
      if (Array.isArray(editingTask.label_list)) {
        setLabelListInput(editingTask.label_list.join('\n'));
      } else {
        setLabelListInput('');
      }
      if (editingTask.label_definitions && typeof editingTask.label_definitions === 'object') {
        const lines = Object.entries(editingTask.label_definitions)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        setLabelDefinitionsInput(lines);
      } else {
        setLabelDefinitionsInput('');
      }
      setShowLLM(!!(editingTask.gpt_api_base || editingTask.gpt_api_key || editingTask.gpt_model));
      setShowSimLLM(!!(editingTask.sim_api_base || editingTask.sim_api_key || editingTask.sim_model));
      setShowAnchor(!!editingTask.anchor_guide_file);
    }
  }, [editingTask]);

  const onSubmit = useCallback(async () => {
    if (!editingTask || !name.trim()) return;
    if (taskType === 'classification' && !labelListInput.trim()) {
      alert('Classification 유형은 [라벨 집합]을 반드시 입력해야 합니다.');
      return;
    }
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
        anchor_guide_file: anchorFile || '',
        ...(taskType === 'classification' ? {
          label_list: labelListInput.trim(),
          label_definitions: labelDefinitionsInput.trim(),
        } : {}),
      });
      closeModal();
    } catch (e) {
      alert('저장 오류: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [editingTask, name, desc, taskType, genType, gptBase, gptKey, gptModel, simBase, simKey, simModel, anchorFile, labelListInput, labelDefinitionsInput, updateTask, closeModal, setSubmitting]);

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
            title="변경 사항을 저장합니다"
          >저장</button>
        </>
      }
    >
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="실험을 구분하는 이름입니다">Task명 *</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="실험 목적이나 메모를 입력합니다">설명</label>
        <input
          className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="Task 유형은 새 실험 생성 시 한 번만 설정 가능하며, 이후 변경할 수 없습니다.">Task 유형 (변경 불가)</label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            className={`flex-1 py-2 px-3 rounded-[7px] text-[13px] font-semibold border cursor-not-allowed ${taskType === 'summarization' ? 'bg-ctp-mauve/60 text-ctp-base border-ctp-mauve/60' : 'bg-warm-hover/40 text-warm-muted border-warm-border opacity-50'}`}
            title="Summarization 유형 (변경 불가)"
          >Summarization</button>
          <button
            type="button"
            disabled
            className={`flex-1 py-2 px-3 rounded-[7px] text-[13px] font-semibold border cursor-not-allowed ${taskType === 'classification' ? 'bg-ctp-mauve/60 text-ctp-base border-ctp-mauve/60' : 'bg-warm-hover/40 text-warm-muted border-warm-border opacity-50'}`}
            title="Classification 유형 (변경 불가)"
          >Classification</button>
        </div>
        <p className="text-[11px] text-[#888] mt-1">
          Task 유형은 새 실험 생성 시에만 설정할 수 있으며, 이후에는 변경할 수 없습니다.
        </p>
      </div>
      {taskType === 'classification' && (
        <>
          <div className="mb-3.5">
            <label className="block text-xs text-[#666] mb-1 font-semibold" title="이 분류 Task에서 사용하는 모든 라벨 (정확한 텍스트). 줄바꿈 또는 콤마로 구분합니다. 모델은 반드시 이 집합 안에서만 라벨을 출력해야 합니다.">
              라벨 집합 * <span className="text-ctp-peach">(분류 전용)</span>
            </label>
            <textarea
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none font-mono resize-y"
              placeholder={'예) 줄바꿈 또는 콤마로 구분\n민원\n문의\n칭찬\n기타'}
              rows={4}
              value={labelListInput}
              onChange={(e) => setLabelListInput(e.target.value)}
            />
            <p className="text-[11px] text-[#888] mt-1">
              모델이 출력해야 할 라벨의 정확한 텍스트입니다. Phase 1/2의 모든 분석에서 이 집합이 컨텍스트로 사용됩니다.
            </p>
          </div>
          <div className="mb-3.5">
            <label className="block text-xs text-[#666] mb-1 font-semibold" title="각 라벨의 정의/판정 기준. 한 줄에 '라벨: 정의' 형식 또는 JSON 객체로 입력합니다. 비워두면 라벨 이름만 사용합니다.">
              라벨 정의 <span className="text-[#888]">(분류 전용, 권장)</span>
            </label>
            <textarea
              className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none font-mono resize-y"
              placeholder={'예) 라벨: 정의 형식 또는 JSON\n민원: 환불·취소·이의 제기 등 처리 요구가 명시된 경우\n문의: 단순 정보·이용 방법 등 답변 요청\n칭찬: 만족·감사 표현이 주된 경우\n기타: 위 셋에 해당하지 않는 모든 경우'}
              rows={6}
              value={labelDefinitionsInput}
              onChange={(e) => setLabelDefinitionsInput(e.target.value)}
            />
            <p className="text-[11px] text-[#888] mt-1">
              각 라벨의 변별 기준을 명시하면 Phase 1 진단·Phase 2 전략 설계의 정확도가 크게 향상됩니다.
            </p>
          </div>
        </>
      )}
      <div className="mb-3.5">
        <label className="block text-xs text-[#666] mb-1 font-semibold" title="이 실험에서 다루는 요약 종류 (예: 민원내용). GPT가 분석 시 참고합니다.">요약 유형</label>
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
