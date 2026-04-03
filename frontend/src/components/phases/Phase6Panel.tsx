import React, { useCallback, useEffect } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useUIStore } from '../../stores/uiStore';
import { useSSE } from '../../hooks/useSSE';
import { LogBox } from '../shared/LogBox';
import { runPhase, cancelPhase } from '../../api/phases';
import type { Phase6Data } from '../../types';

export const Phase6Panel: React.FC = () => {
  const runStore = useRunStore();
  const ps = usePhaseStore();
  const { openModal } = useUIStore();
  const runId = runStore.selectedRunId;
  const runData = runStore.runData;

  const isRunning = ps.phaseStatus[6] === 'running';
  const data = ps.p6Data;

  // Load existing data
  useEffect(() => {
    if (!runData?.phases?.[6]) return;
    const p6 = runData.phases[6];
    const od = p6.output_data as Phase6Data | undefined;
    if (od) ps.setP6Data(od);
    // log_text 복원
    if (p6.log_text && ps.p6Logs.length === 0) {
      const restored = (p6.log_text as string).split('\n').filter(Boolean).map((line: string) => ({
        level: 'info' as const,
        message: line,
        ts: '',
      }));
      ps.setP6Logs(restored);
    }
  }, [runData]);

  // SSE
  useSSE(runId, 6, isRunning, {
    onLog: (level, message, ts) => ps.addP6Log({ level: level as 'info', message, ts }),
    onResult: (d) => {
      ps.setP6Data(d as Phase6Data);
      if ((d as any).learning_rate) {
        ps.setP6LearningRate((d as any).learning_rate as string);
      }
    },
    onDone: async (status) => {
      ps.setPhaseStatus(6, status === 'completed' ? 'completed' : 'failed');
      runStore.setRunningPhase(runId!, null);
      if (runId) {
        try {
          const data = await runStore.loadRunData(runId);
          ps.updatePhaseTabsFromRunData(data.phases || {});
        } catch { /* ignore */ }
      }
    },
  });

  const onRun = useCallback(async () => {
    if (!runId) return;
    ps.clearP6Logs();
    ps.setP6Data(null);
    ps.setPhaseStatus(6, 'running');
    runStore.setRunningPhase(runId, 6);
    try {
      await runPhase(runId, 6);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      ps.setPhaseStatus(6, 'failed');
      runStore.setRunningPhase(runId, null);
    }
  }, [runId, ps, runStore]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try { await cancelPhase(runId, 6); } catch { /* ignore */ }
  }, [runId]);

  return (
    <div>
      {/* Learning rate badge */}
      <div className="mb-4">
        <span className="inline-block py-1 px-3 rounded-[20px] bg-ctp-blue text-ctp-base text-xs font-bold">
          Learning Rate: {ps.p6LearningRate || data?.experiment_summary || '—'}
        </span>
      </div>

      {/* Backprop */}
      <div className="bg-warm-card border border-warm-border rounded-lg py-3 px-4 text-[13px] text-[#444] leading-relaxed mb-4">
        <h4 className="text-xs text-warm-muted mb-2">Backprop 분석</h4>
        <div className="whitespace-pre-wrap">
          {data?.backprop || <span className="text-warm-muted">Phase 6 실행 후 표시됩니다.</span>}
        </div>
      </div>

      {/* Effective elements */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">효과적 요소 (녹색)</h4>
        <div className="flex flex-wrap gap-1.5">
          {data?.effective?.length ? (
            data.effective.map((tag, i) => (
              <span key={i} className="py-0.5 px-2.5 rounded-xl bg-[#dcfce7] text-[#166534] text-xs font-medium">
                {tag}
              </span>
            ))
          ) : (
            <span className="text-warm-muted text-sm">없음</span>
          )}
        </div>
      </div>

      {/* Harmful elements */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">해로운 요소 (적색)</h4>
        <div className="flex flex-wrap gap-1.5">
          {data?.harmful?.length ? (
            data.harmful.map((tag, i) => (
              <span key={i} className="py-0.5 px-2.5 rounded-xl bg-[#fee2e2] text-[#991b1b] text-xs font-medium">
                {tag}
              </span>
            ))
          ) : (
            <span className="text-warm-muted text-sm">없음</span>
          )}
        </div>
      </div>

      {/* Next direction */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">다음 방향</h4>
        <textarea
          className="w-full border border-warm-border rounded-lg py-2.5 px-3.5 bg-warm-hover resize-y min-h-[80px] text-[13px] text-[#444] focus:border-ctp-mauve focus:outline-none"
          value={data?.next_direction || ''}
          placeholder="Phase 6 실행 후 채워집니다..."
          readOnly
        />
      </div>

      <LogBox logs={ps.p6Logs} />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
          onClick={onRun}
          disabled={isRunning}
        >Phase 6 실행</button>
        {isRunning && (
          <button className="py-2 px-3.5 bg-ctp-red text-ctp-base rounded-md font-semibold text-xs hover:opacity-85" onClick={onCancel}>
            ■ 중단
          </button>
        )}
      </div>

      {/* Next run section */}
      {(ps.phaseStatus[6] === 'completed' || ps.phaseStatus[6] === 'done') && (
        <div className="mt-6 py-5 px-5 bg-[#f0edf6] rounded-[10px] text-center">
          <p className="text-sm text-[#444] mb-3">Phase 6 분석이 완료되었습니다. 피드백을 반영한 다음 Run을 시작하세요.</p>
          <button
            className="py-2.5 px-6 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-sm hover:opacity-85"
            onClick={() => openModal('newRun')}
          >다음 Run 시작 →</button>
        </div>
      )}
    </div>
  );
};
