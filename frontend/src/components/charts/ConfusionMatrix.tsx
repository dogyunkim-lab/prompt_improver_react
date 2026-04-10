import React from 'react';
import type { ConfusionMatrix as ConfusionMatrixData } from '../../types';

interface ConfusionMatrixProps {
  data: ConfusionMatrixData | null | undefined;
}

/**
 * 분류 confusion matrix를 히트맵 표로 표시.
 * 행=Reference(정답), 열=Predicted(모델 출력).
 * 대각선(정답)은 초록, 비대각(오답)은 빨강 농도로 표시.
 */
export const ConfusionMatrix: React.FC<ConfusionMatrixProps> = React.memo(({ data }) => {
  if (!data || !data.labels || !data.matrix || data.labels.length === 0) {
    return (
      <div className="text-xs text-warm-muted py-4 text-center">
        confusion matrix 데이터 없음 (Phase 1 실행 후 표시)
      </div>
    );
  }

  const labels = data.labels;
  const matrix = data.matrix;

  // 최대값 계산 (셀 색 농도)
  let maxDiag = 0;
  let maxOff = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < (matrix[i] || []).length; j++) {
      const v = matrix[i]?.[j] || 0;
      if (i === j) {
        if (v > maxDiag) maxDiag = v;
      } else {
        if (v > maxOff) maxOff = v;
      }
    }
  }

  const cellBg = (i: number, j: number, v: number): string => {
    if (v === 0) return 'transparent';
    if (i === j) {
      const ratio = maxDiag > 0 ? v / maxDiag : 0;
      const alpha = 0.15 + ratio * 0.55;
      return `rgba(166, 227, 161, ${alpha})`; // ctp-green
    }
    const ratio = maxOff > 0 ? v / maxOff : 0;
    const alpha = 0.15 + ratio * 0.65;
    return `rgba(243, 139, 168, ${alpha})`; // ctp-red
  };

  // 행/열 합계 (라벨별 정답률 표시용)
  const rowSums = matrix.map((row) => (row || []).reduce((a, b) => a + (b || 0), 0));

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 bg-warm-card px-2 py-1 text-left font-semibold text-warm-muted border-r border-warm-border">
              Ref \ Pred
            </th>
            {labels.map((l) => (
              <th
                key={`h-${l}`}
                className="px-2 py-1 font-semibold text-warm-text border-b border-warm-border whitespace-nowrap"
                title={`예측 라벨: ${l}`}
              >
                {l}
              </th>
            ))}
            <th className="px-2 py-1 font-semibold text-warm-muted whitespace-nowrap" title="해당 정답 라벨의 총 케이스 수">
              합계
            </th>
            <th className="px-2 py-1 font-semibold text-warm-muted whitespace-nowrap" title="해당 정답 라벨의 정답률 (대각선 / 합계)">
              정답률
            </th>
          </tr>
        </thead>
        <tbody>
          {labels.map((rowLabel, i) => {
            const row = matrix[i] || [];
            const sum = rowSums[i] || 0;
            const correct = row[i] || 0;
            const acc = sum > 0 ? (correct / sum) * 100 : 0;
            return (
              <tr key={`r-${rowLabel}`}>
                <th
                  className="sticky left-0 z-10 bg-warm-card px-2 py-1 text-left font-semibold text-warm-text border-r border-warm-border whitespace-nowrap"
                  title={`정답 라벨: ${rowLabel}`}
                >
                  {rowLabel}
                </th>
                {labels.map((colLabel, j) => {
                  const v = row[j] || 0;
                  const isDiag = i === j;
                  return (
                    <td
                      key={`c-${rowLabel}-${colLabel}`}
                      className="px-2 py-1 text-center border border-warm-border/40"
                      style={{ background: cellBg(i, j, v) }}
                      title={`${rowLabel} → ${colLabel}: ${v}건`}
                    >
                      <span className={isDiag ? 'font-semibold' : ''}>{v || ''}</span>
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-center text-warm-muted border-l border-warm-border">
                  {sum}
                </td>
                <td
                  className={
                    'px-2 py-1 text-center font-semibold ' +
                    (acc >= 95
                      ? 'text-score-good'
                      : acc >= 80
                      ? 'text-score-warn'
                      : 'text-score-bad')
                  }
                >
                  {sum > 0 ? `${acc.toFixed(1)}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-warm-muted mt-1">
        행=정답(Reference), 열=모델 예측(Generated). 대각선이 정답, 비대각이 오답.
      </p>
    </div>
  );
});

ConfusionMatrix.displayName = 'ConfusionMatrix';
