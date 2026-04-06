import React, { useCallback, useState, useEffect } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useSSEBuffered } from '../../hooks/useSSEBuffered';
import { LogBox } from '../shared/LogBox';
import { ProgressBar } from '../shared/ProgressBar';
import { connectDify, executeDify, cancelPhase } from '../../api/phases';
import { cn } from '../../utils/cn';

export const Phase3Panel: React.FC = () => {
  const selectedRunId = useRunStore((s) => s.selectedRunId);
  const runData = useRunStore((s) => s.runData);
  const loadRunData = useRunStore((s) => s.loadRunData);
  const setRunningPhase = useRunStore((s) => s.setRunningPhase);

  const phaseStatus = usePhaseStore((s) => s.phaseStatus);
  const p3Logs = usePhaseStore((s) => s.p3Logs);
  const p3Progress = usePhaseStore((s) => s.p3Progress);
  const selectedCandidateId = usePhaseStore((s) => s.selectedCandidateId);

  const setP3Logs = usePhaseStore((s) => s.setP3Logs);
  const addP3Log = usePhaseStore((s) => s.addP3Log);
  const clearP3Logs = usePhaseStore((s) => s.clearP3Logs);
  const setP3Progress = usePhaseStore((s) => s.setP3Progress);
  const setPhaseStatus = usePhaseStore((s) => s.setPhaseStatus);
  const updatePhaseTabsFromRunData = usePhaseStore((s) => s.updatePhaseTabsFromRunData);

  const runId = selectedRunId;
  const [objectId, setObjectId] = useState('');
  const [difyStatus, setDifyStatus] = useState<'none' | 'verified' | 'failed'>('none');
  const [difyMessage, setDifyMessage] = useState('');

  const isRunning = phaseStatus[3] === 'running';

  useEffect(() => {
    // log_text 복원
    const p3 = runData?.phases?.[3];
    if (p3?.log_text && p3Logs.length === 0) {
      const restored = (p3.log_text as string).split('\n').filter(Boolean).map((line: string) => ({
        level: 'info' as const,
        message: line,
        ts: '',
      }));
      setP3Logs(restored);
    }
    if (!runData?.dify_connections?.length) return;
    const conn = runData.dify_connections[0];
    if (conn) {
      setObjectId(conn.object_id || '');
      setDifyStatus(conn.status === 'verified' ? 'verified' : conn.status === 'failed' ? 'failed' : 'none');
    }
  }, [runData]);

  useSSEBuffered(runId, 3, isRunning, {
    onLog: (level, message, ts) => addP3Log({ level: level as 'info', message, ts }),
    onProgress: (current, total) => setP3Progress({ current, total }),
    onDone: async (status) => {
      setPhaseStatus(3, status === 'completed' ? 'completed' : 'failed');
      setRunningPhase(runId!, null);
      if (runId) {
        try {
          const data = await loadRunData(runId);
          updatePhaseTabsFromRunData(data.phases || {});
        } catch { /* ignore */ }
      }
    },
  });

  const onConnect = useCallback(async () => {
    if (!runId || !objectId.trim()) return;
    setDifyMessage('');
    try {
      const res = await connectDify(runId, objectId.trim(), selectedCandidateId || undefined);
      setDifyStatus(res.status === 'verified' || res.verified ? 'verified' : 'failed');
      setDifyMessage(res.message || (res.verified ? '✓ 연결 성공' : '✕ 연결 실패'));
    } catch (e) {
      setDifyStatus('failed');
      setDifyMessage('연결 오류: ' + (e as Error).message);
    }
  }, [runId, objectId, selectedCandidateId]);

  const onExecute = useCallback(async () => {
    if (!runId) return;
    clearP3Logs();
    setP3Progress({ current: 0, total: 0 });
    setPhaseStatus(3, 'running');
    setRunningPhase(runId, 3);
    try {
      await executeDify(runId);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      setPhaseStatus(3, 'failed');
      setRunningPhase(runId, null);
    }
  }, [runId, clearP3Logs, setP3Progress, setPhaseStatus, setRunningPhase]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try { await cancelPhase(runId, 3); } catch { /* ignore */ }
  }, [runId]);

  const selectedCand = runData?.phases?.[2]?.candidates?.find(
    (c) => c.id === (runData.selected_candidate_id || selectedCandidateId),
  );
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({});
  const toggleNode = (key: string) => setOpenNodes((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div>
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        {selectedCand ? (
          <div>
            <h4 className="text-[13px] text-[#555] mb-2">
              선택된 후보: <span className="text-ctp-mauve font-bold">후보 {selectedCand.candidate_label}</span>
              <span className="text-warm-muted font-normal ml-2">({selectedCand.node_count}-Step · {selectedCand.mode})</span>
            </h4>
            {selectedCand.design_rationale && (
              <p className="text-xs text-[#555] leading-normal mb-3">{selectedCand.design_rationale}</p>
            )}
            {selectedCand.nodes && selectedCand.nodes.length > 0 && (
              <div className="flex flex-col gap-2">
                {selectedCand.nodes.map((node, idx) => {
                  const key = `${selectedCand.id}-${idx}`;
                  const isOpen = openNodes[key];
                  return (
                    <div key={key} className="border border-warm-border rounded-md overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2 bg-warm-hover text-left text-xs font-semibold text-warm-text hover:bg-[#2a2a2a]"
                        onClick={() => toggleNode(key)}
                      >
                        <span className="text-ctp-mauve">{isOpen ? '▾' : '▸'}</span>
                        <span>Step {idx + 1} 프롬프트 (노드 {node.label})</span>
                        {node.reasoning && (
                          <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-ctp-mauve/20 text-ctp-mauve rounded">추론</span>
                        )}
                        {node.output_var && (
                          <span className="ml-auto text-[10px] text-warm-muted font-normal">→ {node.output_var}</span>
                        )}
                      </button>
                      {isOpen && (
                        <div className="p-3 bg-[#1a1a1a] text-[11px] text-[#ccc] space-y-2">
                          {node.input_vars && node.input_vars.length > 0 && (
                            <div>
                              <div className="text-warm-muted mb-1">입력 변수:</div>
                              <div className="flex flex-wrap gap-1">
                                {node.input_vars.map((v) => (
                                  <span key={v} className="px-1.5 py-0.5 bg-warm-hover rounded text-[10px]">{v}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {node.system_prompt && (
                            <div>
                              <div className="text-warm-muted mb-1">System Prompt:</div>
                              <pre className="whitespace-pre-wrap font-mono leading-relaxed">{node.system_prompt?.replace(/\\n/g, '\n')}</pre>
                            </div>
                          )}
                          {node.user_prompt && (
                            <div>
                              <div className="text-warm-muted mb-1">User Prompt:</div>
                              <pre className="whitespace-pre-wrap font-mono leading-relaxed">{node.user_prompt?.replace(/\\n/g, '\n')}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="text-warm-muted text-sm">Phase 2에서 후보를 선택하세요.</div>
        )}
      </div>

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

      <ProgressBar label="전체 케이스 실행 진행" current={p3Progress.current} total={p3Progress.total} />
      <LogBox logs={p3Logs} />

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
