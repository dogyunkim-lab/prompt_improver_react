import React, { useCallback, useState, useEffect } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useSSE } from '../../hooks/useSSE';
import { LogBox } from '../shared/LogBox';
import { ProgressBar } from '../shared/ProgressBar';
import { connectDify, executeDify, cancelPhase } from '../../api/phases';
import { cn } from '../../utils/cn';

export const Phase3Panel: React.FC = () => {
  const runStore = useRunStore();
  const ps = usePhaseStore();
  const runId = runStore.selectedRunId;
  const runData = runStore.runData;

  const [objectId, setObjectId] = useState('');
  const [difyStatus, setDifyStatus] = useState<'none' | 'verified' | 'failed'>('none');
  const [difyMessage, setDifyMessage] = useState('');

  const isRunning = ps.phaseStatus[3] === 'running';

  // Load existing dify connections
  useEffect(() => {
    if (!runData?.dify_connections?.length) return;
    const conn = runData.dify_connections[0];
    if (conn) {
      setObjectId(conn.object_id || '');
      setDifyStatus(conn.status === 'verified' ? 'verified' : conn.status === 'failed' ? 'failed' : 'none');
    }
  }, [runData]);

  // SSE
  useSSE(runId, 3, isRunning, {
    onLog: (level, message, ts) => ps.addP3Log({ level: level as 'info', message, ts }),
    onProgress: (current, total) => ps.setP3Progress({ current, total }),
    onDone: async (status) => {
      ps.setPhaseStatus(3, status === 'completed' ? 'completed' : 'failed');
      runStore.setRunningPhase(runId!, null);
      if (runId) {
        try {
          const data = await runStore.loadRunData(runId);
          ps.updatePhaseTabsFromRunData(data.phases || {});
        } catch { /* ignore */ }
      }
    },
  });

  const onConnect = useCallback(async () => {
    if (!runId || !objectId.trim()) return;
    setDifyMessage('');
    try {
      const res = await connectDify(runId, objectId.trim(), ps.selectedCandidateId || undefined);
      setDifyStatus(res.status === 'verified' || res.verified ? 'verified' : 'failed');
      setDifyMessage(res.message || (res.verified ? '✓ 연결 성공' : '✕ 연결 실패'));
    } catch (e) {
      setDifyStatus('failed');
      setDifyMessage('연결 오류: ' + (e as Error).message);
    }
  }, [runId, objectId, ps.selectedCandidateId]);

  const onExecute = useCallback(async () => {
    if (!runId) return;
    ps.clearP3Logs();
    ps.setP3Progress({ current: 0, total: 0 });
    ps.setPhaseStatus(3, 'running');
    runStore.setRunningPhase(runId, 3);
    try {
      await executeDify(runId);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      ps.setPhaseStatus(3, 'failed');
      runStore.setRunningPhase(runId, null);
    }
  }, [runId, ps, runStore]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try { await cancelPhase(runId, 3); } catch { /* ignore */ }
  }, [runId]);

  // Selected candidate info
  const selectedCand = runData?.phases?.[2]?.candidates?.find(
    (c) => c.id === (runData.selected_candidate_id || ps.selectedCandidateId),
  );

  return (
    <div>
      {/* Selected candidate info */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        {selectedCand ? (
          <div>
            <h4 className="text-[13px] text-[#555] mb-2">선택된 후보: <span className="text-ctp-mauve font-bold">{selectedCand.candidate_label}</span></h4>
            <p className="text-xs text-[#555] leading-normal">{selectedCand.design_rationale}</p>
            <p className="text-[11px] text-warm-muted mt-1">{selectedCand.node_count}노드 · {selectedCand.mode}</p>
          </div>
        ) : (
          <div className="text-warm-muted text-sm">Phase 2에서 후보를 선택하세요.</div>
        )}
      </div>

      {/* Dify connection */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">Dify 워크플로우 연결</h4>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-bold text-ctp-mauve min-w-[60px] text-sm">Workflow</span>
          <input
            className="flex-1 min-w-[160px] py-[7px] px-2.5 border border-warm-border rounded-md bg-warm-hover text-warm-text text-[13px] focus:border-ctp-mauve focus:outline-none"
            placeholder="Dify Workflow Object ID"
            value={objectId}
            onChange={(e) => setObjectId(e.target.value)}
          />
          <button
            className="py-[7px] px-3.5 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-xs hover:opacity-85"
            onClick={onConnect}
          >연결 확인</button>
          {difyStatus !== 'none' && (
            <span className={cn('text-sm font-bold', difyStatus === 'verified' ? 'text-score-good' : 'text-score-bad')}>
              {difyStatus === 'verified' ? '✓' : '✕'}
            </span>
          )}
        </div>
        {difyMessage && (
          <p className={cn('text-xs mt-2', difyStatus === 'verified' ? 'text-score-good' : 'text-score-bad')}>
            {difyMessage}
          </p>
        )}
      </div>

      <ProgressBar label="전체 케이스 실행 진행" current={ps.p3Progress.current} total={ps.p3Progress.total} />
      <LogBox logs={ps.p3Logs} />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
          onClick={onExecute}
          disabled={isRunning || difyStatus !== 'verified'}
        >전체 케이스 실행</button>
        {isRunning && (
          <button className="py-2 px-3.5 bg-ctp-red text-ctp-base rounded-md font-semibold text-xs hover:opacity-85" onClick={onCancel}>
            ■ 중단
          </button>
        )}
      </div>
    </div>
  );
};
