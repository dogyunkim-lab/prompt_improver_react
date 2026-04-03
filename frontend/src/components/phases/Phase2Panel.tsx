import React, { useCallback, useState, useEffect } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useSSE } from '../../hooks/useSSE';
import { LogBox } from '../shared/LogBox';
import { runPhase, cancelPhase, selectCandidate } from '../../api/phases';
import { saveUserGuide } from '../../api/uploads';
import { cn } from '../../utils/cn';
import type { Candidate, CandidateNode } from '../../types';

export const Phase2Panel: React.FC = () => {
  const runStore = useRunStore();
  const ps = usePhaseStore();
  const runId = runStore.selectedRunId;
  const runData = runStore.runData;

  const [userGuide, setUserGuide] = useState('');
  const isRunning = ps.phaseStatus[2] === 'running';

  // Load existing data
  useEffect(() => {
    if (!runData) return;
    if (runData.user_guide) setUserGuide(runData.user_guide);
    if (runData.selected_candidate_id) ps.setSelectedCandidateId(runData.selected_candidate_id);

    const p2 = runData.phases?.[2];
    if (p2?.candidates?.length) ps.setP2Candidates(p2.candidates);
    const od = p2?.output_data as any | undefined;
    if (od?.design_summary) ps.setP2DesignSummary(od.design_summary as string);
    if (od?.learning_rate) ps.setP2LearningRate(od.learning_rate as string);

    // Phase 6 feedback
    const p6 = runData.phases?.[6];
    if (p6?.output_data) {
      const p6d = p6.output_data as any;
      if (p6d.next_direction) ps.setP2Feedback(String(p6d.next_direction));
    }
  }, [runData]);

  // SSE
  useSSE(runId, 2, isRunning, {
    onLog: (level, message, ts) => ps.addP2Log({ level: level as 'info', message, ts }),
    onResult: (data) => {
      const d = data as any;
      if (d.candidates) ps.setP2Candidates(d.candidates as Candidate[]);
      if (d.design_summary) ps.setP2DesignSummary(d.design_summary as string);
      if (d.learning_rate) ps.setP2LearningRate(d.learning_rate as string);
    },
    onDone: async (status) => {
      ps.setPhaseStatus(2, status === 'completed' ? 'completed' : 'failed');
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
    // Save user guide first
    if (userGuide.trim()) {
      try { await saveUserGuide(runId, userGuide.trim()); } catch { /* ignore */ }
    }
    ps.clearP2Logs();
    ps.setP2Candidates([]);
    ps.setP2DesignSummary('');
    ps.setPhaseStatus(2, 'running');
    runStore.setRunningPhase(runId, 2);
    try {
      await runPhase(runId, 2);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      ps.setPhaseStatus(2, 'failed');
      runStore.setRunningPhase(runId, null);
    }
  }, [runId, userGuide, ps, runStore]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try { await cancelPhase(runId, 2); } catch { /* ignore */ }
  }, [runId]);

  const onSelectCandidate = useCallback(async (candidateId: number) => {
    if (!runId) return;
    try {
      await selectCandidate(runId, candidateId);
      ps.setSelectedCandidateId(candidateId);
      // Refresh run data
      const data = await runStore.loadRunData(runId);
      ps.updatePhaseTabsFromRunData(data.phases || {});
    } catch (e) {
      alert('선택 오류: ' + (e as Error).message);
    }
  }, [runId, ps, runStore]);

  return (
    <div>
      {/* Phase 6 feedback */}
      {ps.p2Feedback && (
        <div className="mb-4 py-3.5 px-[18px] bg-[#f0f7ff] border border-[#b6d4fe] rounded-[10px]">
          <h4 className="text-xs text-[#1e40af] mb-2 font-semibold">이전 Run Phase 6 피드백 (자동 주입됨)</h4>
          <div className="text-[13px] text-warm-text leading-relaxed whitespace-pre-wrap">{ps.p2Feedback}</div>
        </div>
      )}

      {/* User guide */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-1 flex items-center gap-1.5">
          전략 가이드 <span className="text-[11px] text-warm-muted font-normal">(선택사항)</span>
        </h4>
        <p className="text-xs text-warm-muted mb-2 leading-normal">
          프롬프트 설계 시 반영할 가이드를 입력하세요. 예: "Chain of thought 사용 금지", "워크플로우 출력에 요약 내용만 포함" 등
        </p>
        <textarea
          className="w-full border border-warm-table-border rounded-lg py-2.5 px-3 text-[13px] font-sans resize-y leading-relaxed bg-warm-hover focus:border-ctp-mauve focus:outline-none"
          rows={3}
          placeholder="전략/프롬프트 설계 시 반영할 사항을 자유롭게 입력하세요..."
          value={userGuide}
          onChange={(e) => setUserGuide(e.target.value)}
        />
      </div>

      {/* Candidate cards */}
      <div className="flex gap-3 flex-wrap mb-5">
        {ps.p2Candidates.length === 0 ? (
          <div className="text-warm-muted text-sm">Phase 2 실행 후 결과가 표시됩니다.</div>
        ) : (
          ps.p2Candidates.map((cand) => (
            <CandidateCard
              key={cand.id}
              candidate={cand}
              isSelected={ps.selectedCandidateId === cand.id}
              onSelect={() => onSelectCandidate(cand.id)}
            />
          ))
        )}
      </div>

      {/* Design summary */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-2.5">디자인 요약</h4>
        <div className="text-[13px] text-[#444] leading-relaxed whitespace-pre-wrap">
          {ps.p2DesignSummary || <span className="text-warm-muted">Phase 2 실행 후 표시됩니다.</span>}
        </div>
      </div>

      <LogBox logs={ps.p2Logs} />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
          onClick={onRun}
          disabled={isRunning}
        >Phase 2 실행</button>
        {isRunning && (
          <button className="py-2 px-3.5 bg-ctp-red text-ctp-base rounded-md font-semibold text-xs hover:opacity-85" onClick={onCancel}>
            ■ 중단
          </button>
        )}
      </div>
    </div>
  );
};

/* ── Candidate Card ── */
const CandidateCard: React.FC<{
  candidate: Candidate;
  isSelected: boolean;
  onSelect: () => void;
}> = React.memo(({ candidate, isSelected, onSelect }) => {
  const [activeNode, setActiveNode] = useState(0);
  const [promptTab, setPromptTab] = useState<'system' | 'user'>('system');

  const nodes: CandidateNode[] = candidate.nodes?.length
    ? candidate.nodes
    : buildNodesFromCandidate(candidate);

  const currentNode = nodes[activeNode] || nodes[0];

  return (
    <div className={cn(
      'bg-warm-card rounded-[10px] p-4 flex-1 min-w-[200px] shadow-[0_1px_4px_rgba(0,0,0,0.07)] border-2',
      isSelected ? 'border-ctp-mauve bg-[#f5f0ff]' : 'border-transparent',
    )}>
      <div className="text-xs font-bold text-ctp-mauve mb-2">후보 {candidate.candidate_label}</div>
      <div className="text-[11px] text-warm-muted mb-2">{candidate.node_count}노드 · {candidate.mode}</div>
      <div className="text-xs text-[#555] mb-3 leading-normal">{candidate.design_rationale}</div>

      {/* Node tabs */}
      {nodes.length > 1 && (
        <div className="flex gap-1 flex-wrap mb-2">
          {nodes.map((n, i) => (
            <button
              key={i}
              className={cn(
                'py-0.5 px-2 rounded text-[11px] cursor-pointer border',
                activeNode === i ? 'bg-ctp-mauve text-ctp-base border-ctp-mauve' : 'bg-warm-table-bg text-[#666] border-warm-border',
              )}
              onClick={() => { setActiveNode(i); setPromptTab('system'); }}
            >
              Node {n.label}
              {n.reasoning && <span className="ml-1 text-[10px] py-0 px-1 rounded-[10px] bg-ctp-teal text-ctp-base font-semibold">R</span>}
            </button>
          ))}
        </div>
      )}

      {/* System / User tabs */}
      {currentNode && (
        <>
          <div className="flex gap-1 mb-1.5">
            <button
              className={cn('py-0.5 px-2.5 text-[11px] border rounded cursor-pointer', promptTab === 'system' ? 'bg-[#4a6cf7] text-white border-[#4a6cf7]' : 'bg-[#f5f5f5] border-[#ddd]')}
              onClick={() => setPromptTab('system')}
            >System</button>
            <button
              className={cn('py-0.5 px-2.5 text-[11px] border rounded cursor-pointer', promptTab === 'user' ? 'bg-[#4a6cf7] text-white border-[#4a6cf7]' : 'bg-[#f5f5f5] border-[#ddd]')}
              onClick={() => setPromptTab('user')}
            >User</button>
          </div>
          <div className="text-xs text-[#555] leading-relaxed whitespace-pre-wrap bg-[#fafafa] p-2 rounded max-h-[300px] overflow-y-auto">
            {promptTab === 'system' ? currentNode.system_prompt : currentNode.user_prompt}
          </div>
          <div className="text-[11px] text-warm-muted mt-1">
            <span className="font-semibold text-[#666]">입력: </span>
            <code className="bg-[#f0f0f0] py-0 px-1 rounded text-[11px]">{currentNode.input_vars?.join(', ') || '—'}</code>
            <span className="font-semibold text-[#666] ml-2">출력: </span>
            <code className="bg-[#f0f0f0] py-0 px-1 rounded text-[11px]">{currentNode.output_var || '—'}</code>
          </div>
        </>
      )}

      <button
        className={cn(
          'mt-2.5 py-1.5 px-3.5 rounded-md font-semibold text-xs w-full hover:opacity-85',
          isSelected ? 'bg-ctp-green text-ctp-base' : 'bg-ctp-mauve text-ctp-base',
        )}
        onClick={onSelect}
      >{isSelected ? '✓ 선택됨' : '후보 선택'}</button>
    </div>
  );
});

CandidateCard.displayName = 'CandidateCard';

function buildNodesFromCandidate(c: Candidate): CandidateNode[] {
  const nodes: CandidateNode[] = [];
  const labels = ['A', 'B', 'C'];
  for (let i = 0; i < (c.node_count || 1); i++) {
    const l = labels[i];
    const key = l.toLowerCase() as 'a' | 'b' | 'c';
    nodes.push({
      label: l,
      system_prompt: (c as any)[`node_${key}_system_prompt`] as string || '',
      user_prompt: (c as any)[`node_${key}_user_prompt`] as string || '',
      input_vars: ((c as any)[`node_${key}_input_vars`] as string[]) || [],
      output_var: (c as any)[`node_${key}_output_var`] as string || '',
      reasoning: !!((c as any)[`node_${key}_reasoning`]),
    });
  }
  return nodes;
}
