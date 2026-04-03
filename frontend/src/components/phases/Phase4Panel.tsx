import React, { useCallback, useMemo, useEffect } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useSSE } from '../../hooks/useSSE';
import { useTableSort } from '../../hooks/useTableSort';
import { useTableFilter } from '../../hooks/useTableFilter';
import { ScoreCards } from '../shared/ScoreCards';
import { LogBox } from '../shared/LogBox';
import { ProgressBar } from '../shared/ProgressBar';
import { DataTable, type Column } from '../shared/DataTable';
import { CaseDetail } from '../shared/CaseDetail';
import { runPhase, cancelPhase } from '../../api/phases';
import { downloadJSON, downloadXLSX } from '../../utils/download';
import { fmtPct } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { CaseResult } from '../../types';

const P4_COLUMNS: Column[] = [
  { key: 'id', label: 'ID', width: '60px', sortable: true },
  { key: 'evaluation', label: '판정', width: '60px', sortable: true,
    render: (v) => {
      const val = String(v || '');
      const color = val === '오답' ? 'text-score-bad' : val === '과답' ? 'text-score-warn' : val === '정답' ? 'text-score-good' : '';
      return <span className={cn('font-semibold', color)}>{val}</span>;
    },
  },
  { key: 'reason', label: '사유', width: '180px', sortable: true },
  { key: 'stt', label: 'STT', width: '220px' },
  { key: 'reference', label: 'Reference', width: '220px' },
  { key: 'generated', label: 'Generated', width: '220px' },
];

const DETAIL_FIELDS = [
  { key: 'id', label: 'ID' },
  { key: 'evaluation', label: '판정' },
  { key: 'reason', label: '사유' },
  { key: 'stt', label: 'STT' },
  { key: 'reference', label: 'Reference' },
  { key: 'generated', label: 'Generated' },
  { key: 'intermediate_outputs', label: '중간 출력' },
];

export const Phase4Panel: React.FC = () => {
  const runStore = useRunStore();
  const ps = usePhaseStore();
  const runId = runStore.selectedRunId;
  const runData = runStore.runData;

  const isRunning = ps.phaseStatus[4] === 'running';

  // Load existing data
  useEffect(() => {
    if (!runData?.phases?.[4]) return;
    const p4 = runData.phases[4];
    if (p4.cases?.length) ps.setP4Cases(p4.cases);
    const od = p4.output_data as Record<string, unknown> | undefined;
    if (od?.scores) ps.setP4Scores(od.scores as typeof ps.p4Scores);
    // log_text 복원
    if (p4.log_text && ps.p4Logs.length === 0) {
      const restored = (p4.log_text as string).split('\n').filter(Boolean).map((line: string) => ({
        level: 'info' as const,
        message: line,
        ts: '',
      }));
      ps.setP4Logs(restored);
    }
  }, [runData]);

  // SSE - Phase 4 streams progress and done events, cases come from API reload
  useSSE(runId, 4, isRunning, {
    onLog: (level, message, ts) => ps.addP4Log({ level: level as 'info', message, ts }),
    onProgress: (current, total) => ps.setP4Progress({ current, total }),
    onDone: async (status) => {
      ps.setPhaseStatus(4, status === 'completed' ? 'completed' : 'failed');
      runStore.setRunningPhase(runId!, null);
      if (runId) {
        try {
          const data = await runStore.loadRunData(runId);
          ps.updatePhaseTabsFromRunData(data.phases || {});
          if (data.phases?.[4]?.cases) ps.setP4Cases(data.phases[4].cases);
          const od = data.phases?.[4]?.output_data as Record<string, unknown> | undefined;
          if (od?.scores) ps.setP4Scores(od.scores as typeof ps.p4Scores);
        } catch { /* ignore */ }
      }
    },
  });

  const { sorted, toggleSort } = useTableSort(ps.p4Cases as any[], ps.p4Sort, ps.setP4Sort);
  const { filtered, setCol } = useTableFilter(sorted, ps.p4Filter, ps.setP4Filter);

  const scoreCards = useMemo(() => {
    const s = ps.p4Scores;
    if (!s) {
      // Compute from cases if available
      if (ps.p4Cases.length > 0) {
        const total = ps.p4Cases.length;
        const correct = ps.p4Cases.filter((c) => c.evaluation === '정답').length;
        const over = ps.p4Cases.filter((c) => c.evaluation === '과답').length;
        const wrong = ps.p4Cases.filter((c) => c.evaluation === '오답').length;
        return [
          { label: '정답+과답%', value: fmtPct(((correct + over) / total) * 100), sub: '정답 + 과답', variant: 'good' as const },
          { label: '정답%', value: fmtPct((correct / total) * 100), sub: '정확한 답변', variant: 'default' as const },
          { label: '과답%', value: fmtPct((over / total) * 100), sub: '과도한 답변', variant: 'warn' as const },
          { label: '오답%', value: fmtPct((wrong / total) * 100), sub: '틀린 답변', variant: 'bad' as const },
        ];
      }
      return [
        { label: '정답+과답%', value: '—', sub: '정답 + 과답', variant: 'good' as const },
        { label: '정답%', value: '—', sub: '정확한 답변', variant: 'default' as const },
        { label: '과답%', value: '—', sub: '과도한 답변', variant: 'warn' as const },
        { label: '오답%', value: '—', sub: '틀린 답변', variant: 'bad' as const },
      ];
    }
    return [
      { label: '정답+과답%', value: fmtPct(s.correct_plus_over), sub: '정답 + 과답', variant: 'good' as const },
      { label: '정답%', value: fmtPct(s.correct), sub: '정확한 답변', variant: 'default' as const },
      { label: '과답%', value: fmtPct(s.over), sub: '과도한 답변', variant: 'warn' as const },
      { label: '오답%', value: fmtPct(s.wrong), sub: '틀린 답변', variant: 'bad' as const },
    ];
  }, [ps.p4Scores, ps.p4Cases]);

  const onRun = useCallback(async () => {
    if (!runId) return;
    ps.clearP4Logs();
    ps.setP4Cases([]);
    ps.setP4Progress({ current: 0, total: 0 });
    ps.setP4Scores(null);
    ps.setPhaseStatus(4, 'running');
    runStore.setRunningPhase(runId, 4);
    try {
      await runPhase(runId, 4);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      ps.setPhaseStatus(4, 'failed');
      runStore.setRunningPhase(runId, null);
    }
  }, [runId, ps, runStore]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try { await cancelPhase(runId, 4); } catch { /* ignore */ }
  }, [runId]);

  return (
    <div>
      <ProgressBar label="평가 진행" current={ps.p4Progress.current} total={ps.p4Progress.total} />
      <ScoreCards items={scoreCards} />

      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">케이스 목록</h4>
        <div className="flex gap-1.5 mb-2">
          <button className="py-1 px-2.5 text-xs border border-[#555] bg-[#2a2a2a] text-[#ccc] rounded cursor-pointer hover:bg-[#3a3a3a]"
            onClick={() => downloadJSON(ps.p4Cases, `phase4_cases_run${runData?.run_number || ''}.json`)}>JSON ⬇</button>
          <button className="py-1 px-2.5 text-xs border border-[#555] bg-[#2a2a2a] text-[#ccc] rounded cursor-pointer hover:bg-[#3a3a3a]"
            onClick={() => downloadXLSX(ps.p4Cases, `phase4_cases_run${runData?.run_number || ''}.xlsx`)}>XLSX ⬇</button>
        </div>
        <DataTable
          columns={P4_COLUMNS}
          data={filtered as CaseResult[]}
          sort={ps.p4Sort}
          filter={ps.p4Filter}
          onSort={toggleSort}
          onFilter={setCol}
          renderDetail={(row) => <CaseDetail row={row} fields={DETAIL_FIELDS} />}
          rowClassName={(row) =>
            row.evaluation === '오답' ? 'bg-ctp-red/10' : row.evaluation === '과답' ? 'bg-ctp-yellow/20' : ''
          }
        />
      </div>

      <LogBox logs={ps.p4Logs} />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
          onClick={onRun}
          disabled={isRunning}
        >Phase 4 실행</button>
        {isRunning && (
          <button className="py-2 px-3.5 bg-ctp-red text-ctp-base rounded-md font-semibold text-xs hover:opacity-85" onClick={onCancel}>
            ■ 중단
          </button>
        )}
      </div>
    </div>
  );
};
