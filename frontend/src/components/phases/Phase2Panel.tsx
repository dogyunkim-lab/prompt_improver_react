import React, { useCallback, useState, useEffect } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useSSEBuffered } from '../../hooks/useSSEBuffered';
import { LogBox } from '../shared/LogBox';
import { runPhase, cancelPhase, selectCandidate, saveCustomCandidate } from '../../api/phases';
import { saveUserGuide } from '../../api/uploads';
import { cn } from '../../utils/cn';
import type { Candidate, CandidateNode } from '../../types';

interface CustomNode {
  label: string;
  system_prompt: string;
  user_prompt: string;
  input_vars: string[];
  output_var: string;
  reasoning: boolean;
}

export const Phase2Panel: React.FC = () => {
  const selectedRunId = useRunStore((s) => s.selectedRunId);
  const runData = useRunStore((s) => s.runData);
  const loadRunData = useRunStore((s) => s.loadRunData);
  const setRunningPhase = useRunStore((s) => s.setRunningPhase);

  const phaseStatus = usePhaseStore((s) => s.phaseStatus);
  const p2Candidates = usePhaseStore((s) => s.p2Candidates);
  const p2DesignSummary = usePhaseStore((s) => s.p2DesignSummary);
  const p2Logs = usePhaseStore((s) => s.p2Logs);
  const p2Feedback = usePhaseStore((s) => s.p2Feedback);
  const selectedCandidateId = usePhaseStore((s) => s.selectedCandidateId);

  const setP2Candidates = usePhaseStore((s) => s.setP2Candidates);
  const setP2DesignSummary = usePhaseStore((s) => s.setP2DesignSummary);
  const setP2Logs = usePhaseStore((s) => s.setP2Logs);
  const addP2Log = usePhaseStore((s) => s.addP2Log);
  const clearP2Logs = usePhaseStore((s) => s.clearP2Logs);
  const setP2LearningRate = usePhaseStore((s) => s.setP2LearningRate);
  const setP2Feedback = usePhaseStore((s) => s.setP2Feedback);
  const setSelectedCandidateId = usePhaseStore((s) => s.setSelectedCandidateId);
  const setPhaseStatus = usePhaseStore((s) => s.setPhaseStatus);
  const updatePhaseTabsFromRunData = usePhaseStore((s) => s.updatePhaseTabsFromRunData);

  const runId = selectedRunId;
  const [userGuide, setUserGuide] = useState('');
  const [reasoning, setReasoning] = useState('high');
  const isRunning = phaseStatus[2] === 'running';

  // 커스텀 에디터 state
  const [customOpen, setCustomOpen] = useState(false);
  const [customNodeCount, setCustomNodeCount] = useState(1);
  const [customNodes, setCustomNodes] = useState<CustomNode[]>([
    { label: 'A', system_prompt: '', user_prompt: '', input_vars: ['stt'], output_var: 'generated', reasoning: false },
    { label: 'B', system_prompt: '', user_prompt: '', input_vars: [], output_var: 'generated', reasoning: false },
    { label: 'C', system_prompt: '', user_prompt: '', input_vars: [], output_var: 'generated', reasoning: false },
  ]);
  const [customSaving, setCustomSaving] = useState(false);

  // Load existing data
  useEffect(() => {
    if (!runData) return;
    if (runData.user_guide) setUserGuide(runData.user_guide);
    if (runData.selected_candidate_id) setSelectedCandidateId(runData.selected_candidate_id);

    const p2 = runData.phases?.[2];
    if (p2?.candidates?.length) setP2Candidates(p2.candidates);
    const od = p2?.output_data as any | undefined;
    if (od?.design_summary) setP2DesignSummary(od.design_summary as string);
    if (od?.learning_rate) setP2LearningRate(od.learning_rate as string);

    // log_text 복원
    if (p2?.log_text && p2Logs.length === 0) {
      const restored = (p2.log_text as string).split('\n').filter(Boolean).map((line: string) => ({
        level: 'info' as const,
        message: line,
        ts: '',
      }));
      setP2Logs(restored);
    }

    // Phase 6 feedback
    const p6 = runData.phases?.[6];
    if (p6?.output_data) {
      const p6d = p6.output_data as any;
      if (p6d.next_direction) setP2Feedback(String(p6d.next_direction));
    }
  }, [runData]);

  // SSE
  useSSEBuffered(runId, 2, isRunning, {
    onLog: (level, message, ts) => addP2Log({ level: level as 'info', message, ts }),
    onResult: (data) => {
      const d = data as any;
      if (d.candidates) setP2Candidates(d.candidates as Candidate[]);
      if (d.design_summary) setP2DesignSummary(d.design_summary as string);
      if (d.learning_rate) setP2LearningRate(d.learning_rate as string);
    },
    onDone: async (status) => {
      setPhaseStatus(2, status === 'completed' ? 'completed' : 'failed');
      setRunningPhase(runId!, null);
      if (runId) {
        try {
          const data = await loadRunData(runId);
          updatePhaseTabsFromRunData(data.phases || {});
        } catch { /* ignore */ }
      }
    },
  });

  const onRun = useCallback(async () => {
    if (!runId) return;
    if (userGuide.trim()) {
      try { await saveUserGuide(runId, userGuide.trim()); } catch { /* ignore */ }
    }
    clearP2Logs();
    setP2Candidates([]);
    setP2DesignSummary('');
    setPhaseStatus(2, 'running');
    setRunningPhase(runId, 2);
    try {
      await runPhase(runId, 2, reasoning);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      setPhaseStatus(2, 'failed');
      setRunningPhase(runId, null);
    }
  }, [runId, userGuide, reasoning, clearP2Logs, setP2Candidates, setP2DesignSummary, setPhaseStatus, setRunningPhase]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try { await cancelPhase(runId, 2); } catch { /* ignore */ }
  }, [runId]);

  // 커스텀 에디터: AI 후보 복사
  const handleCopyToEditor = useCallback((candidate: Candidate) => {
    setCustomOpen(true);
    const nodes = candidate.nodes?.length ? candidate.nodes : buildNodesFromCandidate(candidate);
    setCustomNodeCount(nodes.length);
    setCustomNodes((prev) => {
      const next = [...prev];
      nodes.forEach((n, i) => {
        next[i] = {
          label: n.label || ['A', 'B', 'C'][i],
          system_prompt: n.system_prompt || '',
          user_prompt: n.user_prompt || '',
          input_vars: n.input_vars?.length ? [...n.input_vars] : ['stt'],
          output_var: n.output_var || 'generated',
          reasoning: !!n.reasoning,
        };
      });
      return next;
    });
  }, []);

  // 커스텀 에디터: 노드 수 변경
  const handleCustomNodeCountChange = useCallback((count: number) => {
    setCustomNodeCount(count);
    setCustomNodes((prev) => {
      const next = [...prev];
      // 마지막 노드의 output_var를 'generated'로 강제
      for (let i = 0; i < 3; i++) {
        if (i === count - 1) {
          next[i] = { ...next[i], output_var: 'generated' };
        } else if (i === 0 && count >= 2 && next[i].output_var === 'generated') {
          next[i] = { ...next[i], output_var: 'analysis' };
        }
      }
      return next;
    });
  }, []);

  // 커스텀 에디터: 노드 필드 업데이트
  const updateCustomNode = useCallback((idx: number, field: keyof CustomNode, value: unknown) => {
    setCustomNodes((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }, []);

  // 커스텀 에디터: 저장
  const handleSaveCustom = useCallback(async () => {
    if (!runId) return;
    // 첫 노드 input_vars에 stt 필수
    const firstNode = customNodes[0];
    if (!firstNode.input_vars.includes('stt')) {
      alert('첫 번째 노드의 입력 변수에 "stt"가 필수입니다.');
      return;
    }
    setCustomSaving(true);
    try {
      const result = await saveCustomCandidate(runId, {
        node_count: customNodeCount,
        nodes: customNodes.slice(0, customNodeCount),
      });
      setSelectedCandidateId(result.candidate_id);
      const data = await loadRunData(runId);
      updatePhaseTabsFromRunData(data.phases || {});
    } catch (e) {
      alert('저장 오류: ' + (e as Error).message);
    } finally {
      setCustomSaving(false);
    }
  }, [runId, customNodeCount, customNodes, setSelectedCandidateId, loadRunData, updatePhaseTabsFromRunData]);

  const onSelectCandidate = useCallback(async (candidateId: number) => {
    if (!runId) return;
    try {
      await selectCandidate(runId, candidateId);
      setSelectedCandidateId(candidateId);
      const data = await loadRunData(runId);
      updatePhaseTabsFromRunData(data.phases || {});
    } catch (e) {
      alert('선택 오류: ' + (e as Error).message);
    }
  }, [runId, setSelectedCandidateId, loadRunData, updatePhaseTabsFromRunData]);

  return (
    <div>
      {p2Feedback && (
        <div className="mb-4 py-3.5 px-[18px] bg-[#f0f7ff] border border-[#b6d4fe] rounded-[10px]">
          <h4 className="text-xs text-[#1e40af] mb-2 font-semibold">이전 Run Phase 6 피드백 (자동 주입됨)</h4>
          <div className="text-[13px] text-warm-text leading-relaxed whitespace-pre-wrap">{p2Feedback}</div>
        </div>
      )}

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

      <div className="flex gap-3 flex-wrap mb-5">
        {p2Candidates.length === 0 ? (
          <div className="text-warm-muted text-sm">Phase 2 실행 후 결과가 표시됩니다.</div>
        ) : (
          p2Candidates.map((cand) => (
            <CandidateCard
              key={cand.id}
              candidate={cand}
              isSelected={selectedCandidateId === cand.id}
              onSelect={() => onSelectCandidate(cand.id)}
              onCopy={() => handleCopyToEditor(cand)}
            />
          ))
        )}
      </div>

      {/* 커스텀 후보 에디터 */}
      <div className="bg-warm-card rounded-[10px] mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] overflow-hidden">
        <button
          className="w-full flex items-center justify-between py-3 px-4 text-[13px] font-semibold text-warm-text hover:bg-warm-hover transition-colors"
          onClick={() => setCustomOpen((v) => !v)}
        >
          <span>커스텀 후보 작성</span>
          <span className={cn('transition-transform text-xs', customOpen && 'rotate-180')}>▼</span>
        </button>

        {customOpen && (
          <div className="px-4 pb-4 border-t border-warm-table-border">
            {/* 노드 수 선택 */}
            <div className="flex items-center gap-2 mt-3 mb-4">
              <span className="text-xs text-[#888]">노드 수:</span>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={cn(
                    'py-1 px-3 rounded text-xs font-semibold border',
                    customNodeCount === n
                      ? 'bg-ctp-mauve text-ctp-base border-ctp-mauve'
                      : 'bg-warm-table-bg text-[#666] border-warm-border hover:border-[#999]',
                  )}
                  onClick={() => handleCustomNodeCountChange(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* 각 노드 에디터 */}
            {customNodes.slice(0, customNodeCount).map((node, idx) => (
              <CustomNodeEditor
                key={node.label}
                node={node}
                isLast={idx === customNodeCount - 1}
                onChange={(field, value) => updateCustomNode(idx, field, value)}
              />
            ))}

            {/* 저장 버튼 */}
            <button
              className="mt-3 py-2 px-5 bg-ctp-green text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
              onClick={handleSaveCustom}
              disabled={customSaving}
            >
              {customSaving ? '저장 중...' : '저장 및 선택'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-2.5">디자인 요약</h4>
        <div className="text-[13px] text-[#444] leading-relaxed whitespace-pre-wrap">
          {p2DesignSummary || <span className="text-warm-muted">Phase 2 실행 후 표시됩니다.</span>}
        </div>
      </div>

      <LogBox logs={p2Logs} />

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          disabled={isRunning}
          className="py-2 px-2.5 border border-warm-border rounded-md text-[13px] bg-warm-card text-warm-text focus:border-ctp-mauve focus:outline-none disabled:opacity-50"
        >
          <option value="high">High (정밀)</option>
          <option value="medium">Medium (균형)</option>
          <option value="low">Low (빠름)</option>
        </select>
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
  onCopy?: () => void;
}> = React.memo(({ candidate, isSelected, onSelect, onCopy }) => {
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
            {(promptTab === 'system' ? currentNode.system_prompt : currentNode.user_prompt)?.replace(/\\n/g, '\n')}
          </div>
          <div className="text-[11px] text-warm-muted mt-1">
            <span className="font-semibold text-[#666]">입력: </span>
            <code className="bg-[#f0f0f0] py-0 px-1 rounded text-[11px]">{currentNode.input_vars?.join(', ') || '—'}</code>
            <span className="font-semibold text-[#666] ml-2">출력: </span>
            <code className="bg-[#f0f0f0] py-0 px-1 rounded text-[11px]">{currentNode.output_var || '—'}</code>
          </div>
        </>
      )}

      <div className="flex gap-2 mt-2.5">
        <button
          className={cn(
            'py-1.5 px-3.5 rounded-md font-semibold text-xs flex-1 hover:opacity-85',
            isSelected ? 'bg-ctp-green text-ctp-base' : 'bg-ctp-mauve text-ctp-base',
          )}
          onClick={onSelect}
        >{isSelected ? '✓ 선택됨' : '후보 선택'}</button>
        {onCopy && (
          <button
            className="py-1.5 px-3 rounded-md font-semibold text-xs bg-warm-table-bg text-[#666] border border-warm-border hover:border-[#999] hover:text-[#333]"
            onClick={onCopy}
            title="커스텀 에디터에 복사"
          >복사</button>
        )}
      </div>
    </div>
  );
});

CandidateCard.displayName = 'CandidateCard';

/* ── Custom Node Editor ── */
const CustomNodeEditor: React.FC<{
  node: CustomNode;
  isLast: boolean;
  onChange: (field: keyof CustomNode, value: unknown) => void;
}> = React.memo(({ node, isLast, onChange }) => {
  const [newVar, setNewVar] = useState('');

  const addInputVar = () => {
    const v = newVar.trim();
    if (v && !node.input_vars.includes(v)) {
      onChange('input_vars', [...node.input_vars, v]);
    }
    setNewVar('');
  };

  const removeInputVar = (v: string) => {
    onChange('input_vars', node.input_vars.filter((x) => x !== v));
  };

  return (
    <div className="mb-4 pb-4 border-b border-[#333] last:border-b-0 last:pb-0 last:mb-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-ctp-mauve">Node {node.label}</span>
        <label className="flex items-center gap-1 ml-auto text-[11px] text-[#888] cursor-pointer">
          <input
            type="checkbox"
            checked={node.reasoning}
            onChange={(e) => onChange('reasoning', e.target.checked)}
            className="w-3.5 h-3.5 accent-ctp-teal"
          />
          Reasoning
        </label>
      </div>

      <div className="mb-2">
        <label className="text-[11px] text-[#888] block mb-0.5">System Prompt</label>
        <textarea
          className="w-full bg-[#1a1a1a] text-[#ccc] border border-[#444] rounded-lg py-2 px-2.5 text-xs font-mono resize-y leading-relaxed focus:border-ctp-mauve focus:outline-none"
          rows={4}
          value={node.system_prompt}
          onChange={(e) => onChange('system_prompt', e.target.value)}
          placeholder="시스템 프롬프트를 입력하세요..."
        />
      </div>

      <div className="mb-2">
        <label className="text-[11px] text-[#888] block mb-0.5">User Prompt</label>
        <textarea
          className="w-full bg-[#1a1a1a] text-[#ccc] border border-[#444] rounded-lg py-2 px-2.5 text-xs font-mono resize-y leading-relaxed focus:border-ctp-mauve focus:outline-none"
          rows={3}
          value={node.user_prompt}
          onChange={(e) => onChange('user_prompt', e.target.value)}
          placeholder="유저 프롬프트를 입력하세요... (변수: {stt}, {reference} 등)"
        />
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <label className="text-[11px] text-[#888] block mb-0.5">Input Variables</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {node.input_vars.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-0.5 bg-[#2a2a2a] text-[#aaa] py-0.5 px-2 rounded text-[11px]"
              >
                {v}
                <button
                  className="text-[#666] hover:text-ctp-red ml-0.5 text-[10px]"
                  onClick={() => removeInputVar(v)}
                >&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              className="flex-1 bg-[#1a1a1a] text-[#ccc] border border-[#444] rounded py-1 px-2 text-[11px] focus:border-ctp-mauve focus:outline-none"
              value={newVar}
              onChange={(e) => setNewVar(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addInputVar()}
              placeholder="변수명"
            />
            <button
              className="py-1 px-2 bg-[#333] text-[#aaa] rounded text-[11px] hover:bg-[#444]"
              onClick={addInputVar}
            >+ 추가</button>
          </div>
        </div>

        <div className="min-w-[120px]">
          <label className="text-[11px] text-[#888] block mb-0.5">Output Variable</label>
          <input
            type="text"
            className="w-full bg-[#1a1a1a] text-[#ccc] border border-[#444] rounded py-1 px-2 text-xs focus:border-ctp-mauve focus:outline-none disabled:opacity-50"
            value={node.output_var}
            onChange={(e) => onChange('output_var', e.target.value)}
            disabled={isLast}
            title={isLast ? '마지막 노드의 출력 변수는 항상 "generated"입니다.' : undefined}
          />
          {isLast && <span className="text-[10px] text-[#666]">마지막 노드: generated 고정</span>}
        </div>
      </div>
    </div>
  );
});

CustomNodeEditor.displayName = 'CustomNodeEditor';

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
