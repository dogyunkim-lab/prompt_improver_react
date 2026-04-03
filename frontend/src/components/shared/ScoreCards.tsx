import React from 'react';
import { cn } from '../../utils/cn';

interface ScoreCardItem {
  label: string;
  value: string;
  sub: string;
  variant?: 'good' | 'warn' | 'bad' | 'default';
}

interface ScoreCardsProps {
  items: ScoreCardItem[];
}

const variantColor = {
  good: 'text-score-good',
  warn: 'text-score-warn',
  bad: 'text-score-bad',
  default: 'text-ctp-base',
};

export const ScoreCards: React.FC<ScoreCardsProps> = React.memo(({ items }) => (
  <div className="flex gap-3 flex-wrap mb-5">
    {items.map((item) => (
      <div
        key={item.label}
        className="bg-warm-card rounded-[10px] py-4 px-5 min-w-[140px] flex-1 shadow-[0_1px_4px_rgba(0,0,0,0.07)]"
      >
        <div className="text-[11px] text-warm-muted mb-1.5">{item.label}</div>
        <div className={cn('text-[28px] font-bold', variantColor[item.variant || 'default'])}>
          {item.value}
        </div>
        <div className="text-[11px] text-warm-muted/70 mt-0.5">{item.sub}</div>
      </div>
    ))}
  </div>
));

ScoreCards.displayName = 'ScoreCards';
