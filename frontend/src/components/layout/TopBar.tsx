import React from 'react';
import { useTaskStore } from '../../stores/taskStore';
import { useRunStore } from '../../stores/runStore';
import { useUIStore } from '../../stores/uiStore';

export const TopBar: React.FC = () => {
  const { tasks, selectedTaskId } = useTaskStore();
  const { runData } = useRunStore();
  const { openModal } = useUIStore();

  const task = tasks.find((t) => t.id === (runData?.task_id ?? selectedTaskId));
  const taskName = task?.name || '실험';
  const runNum = runData?.run_number || '?';
  const modeLabel = runData?.start_mode === 'zero' ? '제로' : runData?.start_mode ? '이어서' : '';
  const createdAt = runData?.created_at ? new Date(runData.created_at).toLocaleString('ko-KR') : '';

  const metaParts = [`Run ${runNum}`];
  if (modeLabel) metaParts.push(modeLabel);
  if (runData?.total_cases) metaParts.push(`${runData.total_cases}개 케이스`);
  if (createdAt) metaParts.push(createdAt);

  return (
    <div className="bg-warm-card border-b border-warm-border py-3 px-6 flex items-center justify-between shrink-0">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-ctp-base">{taskName}</h3>
          <button
            className="py-[5px] px-[9px] bg-transparent text-warm-muted rounded-md text-[13px] border border-warm-border hover:bg-black/5"
            onClick={() => task && openModal('editTask', task)}
            title="실험 설정 편집"
          >✎</button>
        </div>
        <p className="text-xs text-warm-muted mt-0.5">{metaParts.join(' · ')}</p>
      </div>
      <div className="flex gap-2">
        <button
          className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 transition-opacity"
          onClick={() => openModal('newRun')}
          title="새 Run을 생성합니다. Zero(처음부터) 또는 Continue(이전 Run 이어서) 모드를 선택할 수 있습니다."
        >
          + 새 Run
        </button>
      </div>
    </div>
  );
};
