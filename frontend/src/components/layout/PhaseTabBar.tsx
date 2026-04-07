import React, { useCallback } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { cn } from '../../utils/cn';
import { PHASE_NAMES } from '../../utils/constants';

const PHASE_TOOLTIPS: Record<number, string> = {
  1: '오류 분석: Judge JSON을 업로드하고 GPT가 오답/과답 원인을 분석합니다',
  2: '프롬프트 설계: GPT가 개선된 프롬프트 후보를 자동 설계합니다',
  3: 'Dify 실행: 선택한 프롬프트를 Dify 워크플로우에서 전체 케이스 실행합니다',
  4: 'Judge 재판정: 새로 생성된 요약을 GPT Judge가 판정합니다',
  5: '성능 비교: 이전 Run과 점수를 비교하고 개선/회귀를 분석합니다',
  6: '전략 피드백: 다음 Run에서 무엇을 바꿔야 하는지 GPT가 분석합니다',
};

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
            title={PHASE_TOOLTIPS[num]}
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass(num))} />
            {name}
          </div>
        );
      })}
    </div>
  );
};
