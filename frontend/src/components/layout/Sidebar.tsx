import React, { useCallback } from 'react';
import { useTaskStore } from '../../stores/taskStore';
import { useRunStore } from '../../stores/runStore';
import { usePhaseStore } from '../../stores/phaseStore';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../utils/cn';
import { fmtDate } from '../../utils/format';
import type { Task, Run } from '../../types';

const MAX_RUNS = 5;

function getRunBadge(run: Run): { cls: string; text: string } {
  if (run.status?.includes('running')) return { cls: 'bg-ctp-yellow text-ctp-base', text: '진행중' };
  if (run.status === 'failed') return { cls: 'bg-ctp-red text-ctp-base', text: '실패' };
  if (run.score_total != null) return { cls: 'bg-ctp-green text-ctp-base', text: `${Math.round(run.score_total * 100)}%` };
  return { cls: 'bg-ctp-surface1 text-ctp-text', text: '대기' };
}

export const Sidebar: React.FC = () => {
  const { tasks, selectedTaskId, taskFilter, expandedRunTaskIds, setTaskFilter, toggleExpand, setSelectedTaskId, deleteTask: deleteTaskAction } = useTaskStore();
  const { selectedRunId, setSelectedRunId, loadRunData } = useRunStore();
  const { setCurrentPhase, resetPhaseData, updatePhaseTabsFromRunData, currentPhase } = usePhaseStore();
  const { openModal } = useUIStore();

  const filtered = taskFilter
    ? tasks.filter((t) => t.name.toLowerCase().includes(taskFilter.toLowerCase()))
    : tasks;

  const onTaskClick = useCallback(
    async (task: Task) => {
      setSelectedTaskId(task.id);
      const latestRun = task.runs?.length ? task.runs[task.runs.length - 1] : null;
      if (latestRun) {
        resetPhaseData();
        setSelectedRunId(latestRun.id);
        const data = await loadRunData(latestRun.id);
        updatePhaseTabsFromRunData(data.phases || {});
        setCurrentPhase(1);
      } else {
        setSelectedRunId(null);
      }
    },
    [setSelectedTaskId, setSelectedRunId, loadRunData, resetPhaseData, updatePhaseTabsFromRunData, setCurrentPhase],
  );

  const onRunClick = useCallback(
    async (taskId: number, runId: number) => {
      setSelectedTaskId(taskId);
      resetPhaseData();
      setSelectedRunId(runId);
      const data = await loadRunData(runId);
      updatePhaseTabsFromRunData(data.phases || {});
    },
    [setSelectedTaskId, setSelectedRunId, loadRunData, resetPhaseData, updatePhaseTabsFromRunData],
  );

  const onDeleteTask = useCallback(
    async (task: Task) => {
      const runCount = task.runs?.length || 0;
      const msg = runCount > 0
        ? `"${task.name}" 과 관련된 Run ${runCount}개, 모든 데이터가 삭제됩니다.\n정말 삭제하시겠습니까?`
        : `"${task.name}" 을 삭제하시겠습니까?`;
      if (!confirm(msg)) return;
      await deleteTaskAction(task.id);
    },
    [deleteTaskAction],
  );

  const onDeleteRun = useCallback(
    async (taskId: number, run: Run) => {
      if (!confirm(`Run ${run.run_number}을 삭제하시겠습니까?`)) return;
      const { deleteRun } = await import('../../api/runs');
      await deleteRun(run.id);
      const { refreshTasks } = useTaskStore.getState();
      await refreshTasks();
      if (selectedRunId === run.id) {
        setSelectedRunId(null);
      }
    },
    [selectedRunId, setSelectedRunId],
  );

  return (
    <div className="w-[220px] min-w-[220px] bg-ctp-base text-ctp-text flex flex-col overflow-hidden">
      {/* Header */}
      <div className="py-[18px] px-4 border-b border-ctp-surface0">
        <h2 className="text-[15px] font-semibold text-ctp-mauve tracking-wide">Prompt Improver</h2>
        <p className="text-[11px] text-ctp-overlay0 mt-0.5">LLMOps 실험 관리 도구</p>
      </div>

      {/* Search */}
      <input
        type="text"
        className="mx-3 mt-2 mb-1 py-1.5 px-2.5 bg-ctp-surface0 text-ctp-text border border-ctp-surface1 rounded-md text-xs placeholder:text-ctp-overlay0 focus:border-ctp-mauve focus:outline-none"
        placeholder="실험 검색..."
        title="실험 이름으로 검색합니다"
        value={taskFilter}
        onChange={(e) => setTaskFilter(e.target.value)}
      />

      {/* New task */}
      <button
        className="mx-3 mt-2 mb-2 py-2 px-3 bg-ctp-surface0 text-ctp-mauve rounded-md text-xs font-semibold border border-ctp-surface1 hover:bg-ctp-surface1 transition-colors"
        onClick={() => openModal('newTask')}
        title="새 Task(실험)를 생성합니다. 요약 유형, LLM 설정, 앵커 가이드 등을 지정할 수 있습니다."
      >
        + 새 실험 만들기
      </button>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto pb-3" style={{ scrollbarWidth: 'thin' }}>
        {filtered.length === 0 ? (
          <div className="py-4 px-3.5 text-ctp-overlay0 text-xs">실험이 없습니다.</div>
        ) : (
          filtered.map((task) => {
            const isActive = task.id === selectedTaskId;
            const allRuns = task.runs || [];
            const isExpanded = !!expandedRunTaskIds[task.id];
            const runsToShow = !isExpanded && allRuns.length > MAX_RUNS
              ? allRuns.slice(-MAX_RUNS) : allRuns;
            const hiddenCount = allRuns.length - runsToShow.length;

            return (
              <div key={task.id}>
                {/* Task row */}
                <div
                  className={cn(
                    'flex items-center gap-2 py-2 px-3.5 cursor-pointer transition-colors select-none group',
                    isActive ? 'bg-ctp-surface0' : 'hover:bg-ctp-surface2',
                  )}
                  onClick={() => onTaskClick(task)}
                >
                  <span className="w-2 h-2 rounded-full bg-ctp-mauve shrink-0" />
                  <span className="text-[13px] text-ctp-text flex-1 truncate" title={task.name}>
                    {task.name}
                  </span>
                  <span className={cn('text-[10px] text-ctp-overlay0 transition-transform', isActive && 'rotate-90')}>
                    ▶
                  </span>
                  <button
                    className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded bg-transparent text-ctp-overlay0 text-xs hover:bg-ctp-mauve/20 hover:text-ctp-mauve"
                    onClick={(e) => { e.stopPropagation(); openModal('editTask', task); }}
                    title="실험 설정 편집 (LLM, 앵커 가이드 등)"
                  >✎</button>
                  <button
                    className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded bg-transparent text-ctp-overlay0 text-[13px] hover:bg-ctp-red/20 hover:text-ctp-red"
                    onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }}
                    title="이 실험과 모든 Run을 삭제합니다"
                  >✕</button>
                </div>

                {/* Run list */}
                {isActive && allRuns.length > 0 && (
                  <div className="border-l-2 border-ctp-surface0 ml-[22px]">
                    {hiddenCount > 0 && (
                      <div
                        className="py-1 px-3 text-[11px] text-ctp-overlay0 cursor-pointer hover:text-ctp-text"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
                      >
                        ↑ {hiddenCount}개 더 보기
                      </div>
                    )}
                    {isExpanded && allRuns.length > MAX_RUNS && (
                      <div
                        className="py-1 px-3 text-[11px] text-ctp-overlay0 cursor-pointer hover:text-ctp-text"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
                      >
                        ↓ 접기
                      </div>
                    )}
                    {runsToShow.map((run) => {
                      const isRunActive = run.id === selectedRunId;
                      const badge = getRunBadge(run);
                      const isChain = !!run.base_run_id;
                      return (
                        <div
                          key={run.id}
                          className={cn(
                            'flex items-center justify-between py-[5px] px-2.5 pl-3 cursor-pointer transition-colors group/run',
                            isRunActive ? 'bg-ctp-surface0' : 'hover:bg-ctp-surface2',
                            isChain && 'border-l-2 border-ctp-blue ml-0',
                          )}
                          onClick={(e) => { e.stopPropagation(); onRunClick(task.id, run.id); }}
                        >
                          <div>
                            <span className="text-xs text-ctp-subtext0">
                              {isChain && <span className="text-ctp-blue mr-0.5">↳</span>}
                              Run {run.run_number}
                            </span>
                            {run.created_at && (
                              <div className="text-[10px] text-ctp-overlay0 mt-0.5">{fmtDate(run.created_at)}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={cn('text-[10px] font-bold py-0.5 px-1.5 rounded-[10px]', badge.cls)} title={badge.text === '진행중' ? '현재 실행 중입니다' : badge.text === '실패' ? '실행 중 오류가 발생했습니다' : badge.text === '대기' ? '아직 실행되지 않았습니다' : `최종 점수: ${badge.text}`}>
                              {badge.text}
                            </span>
                            <button
                              className="hidden group-hover/run:flex items-center justify-center w-3.5 h-3.5 rounded bg-transparent text-ctp-overlay0 text-[11px] hover:bg-ctp-red/20 hover:text-ctp-red ml-1"
                              onClick={(e) => { e.stopPropagation(); onDeleteRun(task.id, run); }}
                              title="이 Run을 삭제합니다"
                            >✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
