import React, { useEffect, useMemo } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useTableSort } from '../../hooks/useTableSort';
import { useTableFilter } from '../../hooks/useTableFilter';
import { ScoreCards } from '../shared/ScoreCards';
import { DataTable, type Column } from '../shared/DataTable';
import { CaseDetail } from '../shared/CaseDetail';
import { TrendLineChart } from '../charts/TrendLineChart';
import { fetchPhase5 } from '../../api/phases';
import { downloadJSON, downloadXLSX } from '../../utils/download';
import { fmtPct } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { CaseResult } from '../../types';

const P5_COLUMNS: Column[] = [
  { key: 'id', label: 'ID', width: '60px', sortable: true },
  { key: 'evaluation', label: '판정', width: '60px', sortable: true,
    render: (v) => {
      const val = String(v || '');
      const color = val === '오답' ? 'text-score-bad' : val === '과답' ? 'text-score-warn' : val === '정답' ? 'text-score-good' : '';
      return <span className={cn('font-semibold', color)}>{val}</span>;
    },
  },
  { key: 'delta_type', label: '변화', width: '110px', sortable: true,
    render: (v) => {
      const val = String(v || '');
      const map: Record<string, { bg: string; text: string; label: string }> = {
        improved: { bg: 'bg-[#d5f5d0]', text: 'text-[#1a7f0e]', label: '개선' },
        regressed: { bg: 'bg-[#fdd]', text: 'text-[#c01]', label: '회귀' },
        unchanged: { bg: 'bg-[#eee]', text: 'text-warm-muted', label: '변화없음' },
        new: { bg: 'bg-[#e8f0ff]', text: 'text-[#4466aa]', label: '신규' },
      };
      const m = map[val];
      if (!m) return val;
      return <span className={cn('inline-block py-px px-1.5 rounded text-[10px] font-bold', m.bg, m.text)}>{m.label}</span>;
    },
  },
  { key: 'reason', label: '사유', width: '180px', sortable: true },
  { key: 'stt', label: 'STT', width: '200px' },
  { key: 'reference', label: 'Reference', width: '200px' },
  { key: 'generated', label: 'Generated', width: '200px' },
];

const DETAIL_FIELDS = [
  { key: 'id', label: 'ID' },
  { key: 'evaluation', label: '판정' },
  { key: 'delta_type', label: '변화' },
  { key: 'prev_judge', label: '이전 판정' },
  { key: 'reason', label: '사유' },
  { key: 'stt', label: 'STT' },
  { key: 'reference', label: 'Reference' },
  { key: 'generated', label: 'Generated' },
  { key: 'intermediate_outputs', label: '중간 출력' },
];

export const Phase5Panel: React.FC = () => {
  const runStore = useRunStore();
  const ps = usePhaseStore();
  const runId = runStore.selectedRunId;
  const data = ps.p5Data;

  // Auto-fetch Phase 5 data
  useEffect(() => {
    if (!runId) return;
    const p4Status = ps.phaseStatus[4];
    if (p4Status !== 'completed' && p4Status !== 'done') return;
    fetchPhase5(runId).then((d) => ps.setP5Data(d)).catch(() => {});
  }, [runId, ps.phaseStatus[4]]);

  const { sorted, toggleSort } = useTableSort((data?.cases || []) as any[], ps.p5Sort, ps.setP5Sort);
  const { filtered, setCol } = useTableFilter(sorted, ps.p5Filter, ps.setP5Filter);

  const scoreCards = useMemo(() => {
    if (!data?.scores) return [
      { label: '정답+과답%', value: '—', sub: '이번 Run', variant: 'good' as const },
      { label: '정답%', value: '—', sub: '이번 Run', variant: 'default' as const },
      { label: '과답%', value: '—', sub: '이번 Run', variant: 'warn' as const },
      { label: '오답%', value: '—', sub: '이번 Run', variant: 'bad' as const },
    ];
    return [
      { label: '정답+과답%', value: fmtPct(data.scores.correct_plus_over), sub: '이번 Run', variant: 'good' as const },
      { label: '정답%', value: fmtPct(data.scores.correct), sub: '이번 Run', variant: 'default' as const },
      { label: '과답%', value: fmtPct(data.scores.over), sub: '이번 Run', variant: 'warn' as const },
      { label: '오답%', value: fmtPct(data.scores.wrong), sub: '이번 Run', variant: 'bad' as const },
    ];
  }, [data?.scores]);

  return (
    <div>
      <ScoreCards items={scoreCards} />

      {/* Goal banner */}
      {data && (
        <div className={cn(
          'py-3.5 px-5 rounded-[10px] text-[15px] font-bold mb-5 text-center border',
          data.goal_achieved
            ? 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]'
            : 'bg-[#fef9c3] text-[#854d0e] border-[#fde68a]',
        )}>
          {data.goal_achieved ? '🎉 목표 달성!' : `목표까지 ${data.gap_to_goal?.toFixed(1) ?? '—'}%p 부족`}
        </div>
      )}

      {/* Trend chart */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">Run별 성능 추이 (정답+과답%)</h4>
        <TrendLineChart labels={data?.trend?.labels || []} values={data?.trend?.values || []} />
      </div>

      {/* Delta cards */}
      <div className="flex gap-3 flex-wrap mb-5">
        {[
          { label: '개선', value: data?.delta?.improve, cls: 'text-score-good' },
          { label: '회귀', value: data?.delta?.regress, cls: 'text-score-bad' },
          { label: '변화없음', value: data?.delta?.same, cls: 'text-warm-muted' },
        ].map((d) => (
          <div key={d.label} className="bg-warm-card rounded-[10px] py-3.5 px-[18px] flex-1 shadow-[0_1px_4px_rgba(0,0,0,0.07)] text-center">
            <div className={cn('text-[26px] font-bold', d.cls)}>{d.value ?? '—'}</div>
            <div className="text-[11px] text-warm-muted mt-1">{d.label}</div>
          </div>
        ))}
      </div>

      {/* Regressed cases table */}
      {data?.regressed_cases && data.regressed_cases.length > 0 && (
        <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
          <h4 className="text-[13px] text-[#555] mb-3">회귀 케이스</h4>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th className="bg-warm-table-bg text-left py-[7px] px-2.5 border-b border-warm-table-border text-[#666] font-semibold">ID</th>
                  <th className="bg-warm-table-bg text-left py-[7px] px-2.5 border-b border-warm-table-border text-[#666] font-semibold">이전판정 → 현재판정</th>
                  <th className="bg-warm-table-bg text-left py-[7px] px-2.5 border-b border-warm-table-border text-[#666] font-semibold">Judge사유</th>
                </tr>
              </thead>
              <tbody>
                {data.regressed_cases.map((rc) => (
                  <tr key={rc.id}>
                    <td className="py-[7px] px-2.5 border-b border-warm-table-bg text-[#444]">{rc.id}</td>
                    <td className="py-[7px] px-2.5 border-b border-warm-table-bg text-[#444]">
                      <span className="text-score-good">{rc.prev_judge}</span> → <span className="text-score-bad">{rc.curr_judge}</span>
                    </td>
                    <td className="py-[7px] px-2.5 border-b border-warm-table-bg text-[#444]">{rc.reason || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cases table */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">전체 케이스 판정 결과</h4>
        <div className="flex gap-1.5 mb-2">
          <button className="py-1 px-2.5 text-xs border border-[#555] bg-[#2a2a2a] text-[#ccc] rounded cursor-pointer hover:bg-[#3a3a3a]"
            onClick={() => downloadJSON(data?.cases || [], `phase5_cases_run${runStore.runData?.run_number || ''}.json`)}>JSON ⬇</button>
          <button className="py-1 px-2.5 text-xs border border-[#555] bg-[#2a2a2a] text-[#ccc] rounded cursor-pointer hover:bg-[#3a3a3a]"
            onClick={() => downloadXLSX(data?.cases || [], `phase5_cases_run${runStore.runData?.run_number || ''}.xlsx`)}>XLSX ⬇</button>
        </div>
        <DataTable
          columns={P5_COLUMNS}
          data={filtered as CaseResult[]}
          sort={ps.p5Sort}
          filter={ps.p5Filter}
          onSort={toggleSort}
          onFilter={setCol}
          renderDetail={(row) => <CaseDetail row={row} fields={DETAIL_FIELDS} />}
        />
      </div>

      {/* Go to Phase 6 */}
      {data && (
        <div className="mt-4 text-center">
          <button
            className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85"
            onClick={() => ps.setCurrentPhase(6)}
          >Phase 6 전략 분석으로 이동 →</button>
        </div>
      )}
    </div>
  );
};
