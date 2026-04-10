import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import type { MiniValidationSummary, MiniValidationDetail } from '../../types';

interface Props {
  data: MiniValidationSummary;
}

export const MiniValidationPanel: React.FC<Props> = ({ data }) => {
  const [collapsed, setCollapsed] = useState(false);

  // Skip 케이스: enabled=false 이면서 skip_reason 이 있으면 사유 배너 표시
  if (!data.enabled) {
    if (data.skip_reason) {
      return (
        <div className="bg-warm-card rounded-[10px] mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] overflow-hidden border border-red-200">
          <div className="px-4 py-3 text-[13px] font-semibold text-red-700 bg-red-50">
            Mini-Validation 스킵
          </div>
          <div className="px-4 py-3 text-[12px] text-red-700 whitespace-pre-wrap">
            {data.skip_reason}
          </div>
        </div>
      );
    }
    return null;
  }

  if (data.candidate_results.length === 0) return null;

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

      {result.judge_error && (
        <div className="px-3 py-2 bg-red-50 border-t border-red-200 text-[11px] text-red-700">
          <strong>Judge API 오류:</strong> {result.judge_error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[700px]">
          <thead>
            <tr className="bg-warm-table-bg text-warm-muted">
              <th className="text-left py-1.5 px-3 font-medium w-[80px]">케이스</th>
              <th className="text-left py-1.5 px-3 font-medium w-[60px]">판정</th>
              <th className="text-left py-1.5 px-3 font-medium w-[180px]">사유</th>
              <th className="text-left py-1.5 px-3 font-medium w-[180px]">STT</th>
              <th className="text-left py-1.5 px-3 font-medium w-[180px]">Reference</th>
              <th className="text-left py-1.5 px-3 font-medium w-[180px]">Generated</th>
            </tr>
          </thead>
          <tbody>
            {result.details.map((d, i) => (
              <DetailRow key={`${d.case_id || i}`} detail={d} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---- Detail Row ---- */
const DetailRow: React.FC<{ detail: MiniValidationDetail }> = ({ detail }) => {
  const [expanded, setExpanded] = useState(false);

  const evalColor = detail.evaluation === '정답' ? 'text-score-good'
    : detail.evaluation === '과답' ? 'text-score-warn'
    : 'text-score-bad';

  const truncate = (text: string | undefined, len: number) => {
    if (!text) return '—';
    if (!expanded && text.length > len) return text.slice(0, len) + '...';
    return text;
  };

  return (
    <tr
      className={cn(
        'border-t border-warm-table-border hover:bg-warm-hover cursor-pointer transition-colors',
        detail.evaluation === '오답' ? 'bg-ctp-red/10' : detail.evaluation === '과답' ? 'bg-ctp-yellow/20' : '',
      )}
      onClick={() => setExpanded((v) => !v)}
    >
      <td className="py-1.5 px-3 font-mono text-[11px] align-top">{detail.case_id}</td>
      <td className="py-1.5 px-3 align-top">
        <span className={cn('font-semibold', evalColor)}>
          {detail.evaluation || '평가실패'}
        </span>
      </td>
      <td className="py-1.5 px-3 text-[11px] text-[#555] leading-normal align-top">
        <div className={expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}>{truncate(detail.reason, 80)}</div>
      </td>
      <td className="py-1.5 px-3 text-[11px] text-[#555] leading-normal align-top">
        <div className={expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}>{truncate(detail.stt, 80)}</div>
      </td>
      <td className="py-1.5 px-3 text-[11px] text-[#555] leading-normal align-top">
        <div className={expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}>{truncate(detail.reference, 80)}</div>
      </td>
      <td className="py-1.5 px-3 text-[11px] text-[#555] leading-normal align-top">
        <div className={expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}>
          {truncate(detail.generated_preview || detail.error, 80)}
        </div>
      </td>
    </tr>
  );
};
