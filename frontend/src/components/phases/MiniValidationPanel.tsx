import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import type { MiniValidationSummary } from '../../types';

interface Props {
  data: MiniValidationSummary;
}

export const MiniValidationPanel: React.FC<Props> = ({ data }) => {
  const [collapsed, setCollapsed] = useState(false);

  if (!data.enabled || data.candidate_results.length === 0) return null;

  return (
    <div className="bg-warm-card rounded-[10px] mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] overflow-hidden">
      <button
        className="w-full flex items-center justify-between py-3 px-4 text-[13px] font-semibold text-warm-text hover:bg-warm-hover transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span>Mini-Validation 결과 ({data.validation_case_count}건 케이스)</span>
        <span className={cn('transition-transform text-xs', !collapsed && 'rotate-180')}>&#9660;</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 border-t border-warm-table-border space-y-3 pt-3">
          {data.candidate_results.map((cr) => (
            <CandidateGroup key={cr.label} result={cr} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ---- Candidate Group ---- */
const CandidateGroup: React.FC<{ result: MiniValidationSummary['candidate_results'][number] }> = ({ result }) => {
  const pct = Math.round(result.pass_rate * 100);
  const headerBg = pct >= 67 ? 'bg-green-50 border-green-200' : pct >= 34 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';

  return (
    <div className={cn('rounded-lg border overflow-hidden', headerBg)}>
      <div className="px-3 py-2 text-[13px] font-semibold flex items-center gap-2">
        <span>후보 {result.label}</span>
        <span className="ml-auto text-xs font-normal">
          pass_rate: <strong>{pct}%</strong> ({result.passed}/{result.total})
        </span>
      </div>

      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-warm-table-bg text-warm-muted">
            <th className="text-left py-1.5 px-3 font-medium w-[100px]">케이스</th>
            <th className="text-left py-1.5 px-3 font-medium w-[70px]">판정</th>
            <th className="text-left py-1.5 px-3 font-medium">생성 결과</th>
          </tr>
        </thead>
        <tbody>
          {result.details.map((d) => (
            <DetailRow key={d.case_id} detail={d} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ---- Detail Row ---- */
const DetailRow: React.FC<{ detail: MiniValidationSummary['candidate_results'][number]['details'][number] }> = ({ detail }) => {
  const [expanded, setExpanded] = useState(false);

  const evalLower = (detail.evaluation || '').toLowerCase();
  const evalColor = evalLower.includes('정답') ? 'text-green-600 bg-green-50'
    : evalLower.includes('과답') ? 'text-yellow-600 bg-yellow-50'
    : 'text-red-600 bg-red-50';

  const preview = detail.generated_preview || detail.error || '';
  const short = preview.length > 60 ? preview.slice(0, 60) + '...' : preview;
  const full = preview.length > 200 ? preview.slice(0, 200) + '...' : preview;

  return (
    <tr
      className="border-t border-warm-table-border hover:bg-warm-hover cursor-pointer transition-colors"
      onClick={() => setExpanded((v) => !v)}
    >
      <td className="py-1.5 px-3 font-mono text-[11px]">{detail.case_id}</td>
      <td className="py-1.5 px-3">
        <span className={cn('inline-block py-0.5 px-2 rounded text-[11px] font-semibold', evalColor)}>
          {detail.evaluation || '평가실패'}
        </span>
      </td>
      <td className="py-1.5 px-3 text-[11px] text-[#555] leading-normal">
        {expanded ? (
          <div className="whitespace-pre-wrap">&quot;{full}&quot;</div>
        ) : (
          <span>&quot;{short}&quot;</span>
        )}
      </td>
    </tr>
  );
};
