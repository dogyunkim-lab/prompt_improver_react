import React, { useCallback } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { cn } from '../../utils/cn';
import { PHASE_NAMES } from '../../utils/constants';

export const PhaseTabBar: React.FC = () => {
  const { currentPhase, phaseStatus, setCurrentPhase } = usePhaseStore();

  const isLocked = useCallback(
    (num: number): boolean => {
      if (num === 1) return false;
      const prevStatus = phaseStatus[num - 1];
      const thisStatus = phaseStatus[num];
      if (thisStatus === 'done' || thisStatus === 'completed' || thisStatus === 'running') return false;
      return !(prevStatus === 'done' || prevStatus === 'completed');
    },
    [phaseStatus],
  );

  const dotClass = useCallback(
    (num: number): string => {
      const status = phaseStatus[num];
      if (status === 'running') return 'bg-ctp-blue animate-pulse-dot';
      if (status === 'done' || status === 'completed') return 'bg-ctp-green';
      if (status === 'failed') return 'bg-ctp-red';
      return 'bg-[#ccc]';
    },
    [phaseStatus],
  );

  return (
    <div className="bg-warm-card border-b border-warm-border px-6 flex gap-0 shrink-0">
      {PHASE_NAMES.map((name, i) => {
        const num = i + 1;
        const locked = isLocked(num);
        const active = currentPhase === num;
        return (
          <div
            key={num}
            className={cn(
              'flex items-center gap-1.5 py-2.5 px-4 cursor-pointer text-[13px] font-medium border-b-2 border-transparent transition-colors select-none whitespace-nowrap',
              active && 'text-ctp-mauve border-b-ctp-mauve',
              !active && !locked && 'text-warm-muted hover:text-ctp-mauve',
              locked && 'text-[#bbb] cursor-not-allowed',
            )}
            onClick={() => !locked && setCurrentPhase(num)}
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass(num))} />
            {name}
          </div>
        );
      })}
    </div>
  );
};
