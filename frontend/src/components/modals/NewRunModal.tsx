import React, { useState, useCallback, useEffect } from 'react';
import { Modal } from '../shared/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useTaskStore } from '../../stores/taskStore';
import { useRunStore } from '../../stores/runStore';
import { usePhaseStore } from '../../stores/phaseStore';
import { createRun } from '../../api/runs';
import type { Run } from '../../types';

export const NewRunModal: React.FC = () => {
  const { activeModal, closeModal, submitting, setSubmitting } = useUIStore();
  const { selectedTaskId, tasks, refreshTasks } = useTaskStore();
  const { setSelectedRunId, loadRunData } = useRunStore();
  const { setCurrentPhase, resetPhaseData, updatePhaseTabsFromRunData } = usePhaseStore();
  const [startMode, setStartMode] = useState<'zero' | 'continue'>('zero');
  const [baseRunId, setBaseRunId] = useState<number | null>(null);

  // 모달 열릴 때 최신 runs 데이터 가져오기
  useEffect(() => {
    if (activeModal === 'newRun') refreshTasks();
  }, [activeModal]);

  const task = tasks.find((t) => t.id === selectedTaskId);
  const runs = task?.runs || [];
  const hasCompletedRuns = runs.some((r: Run) => r.score_total != null);

  const onSubmit = useCallback(async () => {
    if (!selectedTaskId) return;
    setSubmitting(true);
    try {
      const run = await createRun(selectedTaskId, {
        start_mode: startMode,
        ...(startMode === 'continue' && baseRunId ? { base_run_id: baseRunId } : {}),
      });
      await refreshTasks();
      resetPhaseData();
      setSelectedRunId(run.id);
      const data = await loadRunData(run.id);
      updatePhaseTabsFromRunData(data.phases || {});
      setCurrentPhase(1);
      closeModal();
    } catch (e) {
      alert('Run 생성 오류: ' + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [selectedTaskId, startMode, baseRunId, refreshTasks, resetPhaseData, setSelectedRunId, loadRunData, updatePhaseTabsFromRunData, setCurrentPhase, closeModal, setSubmitting]);

  return (
    <Modal
      open={activeModal === 'newRun'}
      onClose={closeModal}
      title="새 Run 시작"
      footer={
        <>
          <button
            className="py-2 px-4 bg-transparent text-ctp-mauve rounded-md font-semibold text-[13px] border border-ctp-mauve hover:bg-ctp-mauve/10"
            onClick={closeModal}
          >취소</button>
          <button
            className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
            onClick={onSubmit}
            disabled={submitting}
            title="새 Run을 생성하고 Phase 1 화면으로 이동합니다"
          >생성</button>
        </>
      }
    >
      <p className="text-xs text-warm-muted mb-4 leading-relaxed">
        새 Run을 생성하고 Phase 1 화면에서 Judge JSON과 프롬프트를 업로드하세요.
      </p>

      {hasCompletedRuns && (
        <div className="mb-4">
          <label className="block text-xs text-[#666] mb-2 font-semibold">시작 모드</label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px] text-[#444] cursor-pointer" title="새 Judge JSON을 업로드하고 처음부터 분석합니다">
              <input
                type="radio"
                name="startMode"
                checked={startMode === 'zero'}
                onChange={() => { setStartMode('zero'); setBaseRunId(null); }}
                className="accent-ctp-mauve"
              />
              처음부터 (Zero)
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#444] cursor-pointer" title="이전 Run의 Phase 4 판정 결과를 자동으로 사용합니다. Phase 6 피드백도 자동 주입됩니다.">
              <input
                type="radio"
                name="startMode"
                checked={startMode === 'continue'}
                onChange={() => {
                  setStartMode('continue');
                  const lastRun = runs[runs.length - 1];
                  if (lastRun) setBaseRunId(lastRun.id);
                }}
                className="accent-ctp-mauve"
              />
              이전 Run 이어서 (Continue)
            </label>
          </div>

          {startMode === 'continue' && (
            <div className="mt-3">
              <label className="block text-xs text-[#666] mb-1 font-semibold" title="어떤 Run의 결과를 기반으로 이어서 실험할지 선택합니다">기반 Run 선택</label>
              <select
                className="w-full py-2 px-3 border border-warm-border rounded-[7px] bg-warm-hover text-warm-text text-[13px]"
                value={baseRunId || ''}
                onChange={(e) => setBaseRunId(Number(e.target.value))}
              >
                {runs.filter((r: Run) => r.score_total != null).map((r: Run) => (
                  <option key={r.id} value={r.id}>
                    Run {r.run_number} ({r.score_total != null ? `${Math.round(r.score_total * 100)}%` : '—'})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
