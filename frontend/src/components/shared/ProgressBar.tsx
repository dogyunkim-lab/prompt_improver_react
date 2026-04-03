import React from 'react';

interface ProgressBarProps {
  label: string;
  current: number;
  total: number;
  hidden?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = React.memo(({ label, current, total, hidden }) => {
  if (hidden) return null;
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className="mb-4">
      <div className="text-xs text-[#666] mb-1 flex justify-between">
        <span>{label}</span>
        <span>{current} / {total}</span>
      </div>
      <div className="bg-warm-table-border rounded-[20px] h-2 overflow-hidden">
        <div
          className="h-full bg-ctp-mauve rounded-[20px] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';
