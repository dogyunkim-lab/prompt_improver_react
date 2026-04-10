import React, { useCallback, useEffect, useState } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useUIStore } from '../../stores/uiStore';
import { useSSE } from '../../hooks/useSSE';
import { LogBox } from '../shared/LogBox';
import { ReasoningSelect } from '../shared/ReasoningSelect';
import { useTaskStore } from '../../stores/taskStore';
import { runPhase, cancelPhase } from '../../api/phases';
import type { Phase6Data } from '../../types';

export const Phase6Panel: React.FC = () => {
  const runStore = useRunStore();
  const ps = usePhaseStore();
  const { openModal } = useUIStore();
  const runId = runStore.selectedRunId;
  const runData = runStore.runData;

  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const currentTask = tasks.find((t) => t.id === selectedTaskId);

  const isRunning = ps.phaseStatus[6] === 'running';
  const [reasoning, setReasoning] = useState('low');
  const data = ps.p6Data;

  // Load existing data
  useEffect(() => {
    if (!runData?.phases?.[6]) return;
    const p6 = runData.phases[6];
    // output_data는 spread되어 최상위에 존재 (p6.output_data가 아닌 p6 자체)
    const { status: _s, log_text: _l, cases: _c, ...od } = p6 as any;
    if (od && (od.backprop || od.effective || od.next_direction)) {
      ps.setP6Data(od as Phase6Data);
      if (od.learning_rate) ps.setP6LearningRate(od.learning_rate);
    }
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
      await runPhase(runId, 6, reasoning);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      ps.setPhaseStatus(6, 'failed');
      runStore.setRunningPhase(runId, null);
    }
  }, [runId, reasoning, ps, runStore]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try { await cancelPhase(runId, 6); } catch { /* ignore */ }
  }, [runId]);

  return (
    <div>
      {/* Learning rate badge */}
      <div className="mb-4">
        <span className="inline-block py-1 px-3 rounded-[20px] bg-ctp-blue text-ctp-base text-xs font-bold" title="이전 실험 성적에 따라 다음 Run에서의 변경 폭을 자동 조절합니다 (explore/major/medium/minor)">
          Learning Rate: {ps.p6LearningRate || data?.experiment_summary || '—'}
        </span>
      </div>

      {/* Backprop */}
      <div className="bg-warm-card border border-warm-border rounded-lg py-3 px-4 text-[13px] text-[#444] leading-relaxed mb-4">
        <h4 className="text-xs text-warm-muted mb-2" title="프롬프트 변경이 각 케이스에 어떤 영향을 미쳤는지 분석합니다">Backprop 분석</h4>
        <div className="whitespace-pre-wrap">
          {data?.backprop || <span className="text-warm-muted">Phase 6 실행 후 표시됩니다.</span>}
        </div>
      </div>

      {/* Effective elements */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3" title="다음 Run에서 반드시 유지해야 할 변경점입니다">효과적 요소 (녹색)</h4>
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
        <h4 className="text-[13px] text-[#555] mb-3" title="다음 Run에서 제거해야 할 변경점입니다">해로운 요소 (적색)</h4>
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
        <h4 className="text-[13px] text-[#555] mb-3" title="다음 Run에서의 구체적인 개선 방향입니다. Continue 모드 시 Phase 2에 자동 주입됩니다.">다음 방향</h4>
        <textarea
          className="w-full border border-warm-border rounded-lg py-2.5 px-3.5 bg-warm-hover resize-y min-h-[80px] text-[13px] text-[#444] focus:border-ctp-mauve focus:outline-none"
          value={data?.next_direction || ''}
          placeholder="Phase 6 실행 후 채워집니다..."
          readOnly
        />
      </div>

      <LogBox logs={ps.p6Logs} />

      <div className="flex items-center gap-3 flex-wrap">
        <ReasoningSelect
          value={reasoning}
          onChange={setReasoning}
          disabled={isRunning}
          modelName={currentTask?.gpt_model}
        />
        <button
          className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
          onClick={onRun}
          disabled={isRunning}
          title="이번 Run의 결과를 종합 분석하여 다음 Run의 개선 방향을 GPT가 도출합니다"
        >Phase 6 실행</button>
        {isRunning && (
          <button className="py-2 px-3.5 bg-ctp-red text-ctp-base rounded-md font-semibold text-xs hover:opacity-85" onClick={onCancel} title="현재 실행을 중단합니다">
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
            title="이 Run의 Phase 6 피드백을 자동 반영하는 Continue 모드 Run을 생성합니다"
          >다음 Run 시작 →</button>
        </div>
      )}
    </div>
  );
};
