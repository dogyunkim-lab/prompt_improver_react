import React, { useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { PhaseTabBar } from './components/layout/PhaseTabBar';
import { Phase1Panel } from './components/phases/Phase1Panel';
import { Phase2Panel } from './components/phases/Phase2Panel';
import { Phase3Panel } from './components/phases/Phase3Panel';
import { Phase4Panel } from './components/phases/Phase4Panel';
import { Phase5Panel } from './components/phases/Phase5Panel';
import { Phase6Panel } from './components/phases/Phase6Panel';
import { NewTaskModal } from './components/modals/NewTaskModal';
import { EditTaskModal } from './components/modals/EditTaskModal';
import { NewRunModal } from './components/modals/NewRunModal';
import { useTaskStore } from './stores/taskStore';
import { useRunStore } from './stores/runStore';
import { usePhaseStore } from './stores/phaseStore';

const PhasePanel: React.FC = () => {
  const { currentPhase } = usePhaseStore();
  switch (currentPhase) {
    case 1: return <Phase1Panel />;
    case 2: return <Phase2Panel />;
    case 3: return <Phase3Panel />;
    case 4: return <Phase4Panel />;
    case 5: return <Phase5Panel />;
    case 6: return <Phase6Panel />;
    default: return null;
  }
};

const App: React.FC = () => {
  const { loadTasks, selectedTaskId, tasks } = useTaskStore();
  const { selectedRunId, loadRunData } = useRunStore();
  const { setCurrentPhase, updatePhaseTabsFromRunData, resetPhaseData } = usePhaseStore();

  // Initial load
  useEffect(() => {
    loadTasks().then(() => {
      const lastTaskId = localStorage.getItem('lastTaskId');
      const lastRunId = localStorage.getItem('lastRunId');
      const lastPhase = parseInt(localStorage.getItem('lastPhase') || '1', 10);

      if (lastTaskId) {
        useTaskStore.getState().setSelectedTaskId(Number(lastTaskId));
      }
      if (lastRunId) {
        resetPhaseData();
        useRunStore.getState().setSelectedRunId(Number(lastRunId));
        loadRunData(Number(lastRunId)).then((data) => {
          updatePhaseTabsFromRunData(data.phases || {});
          setCurrentPhase(lastPhase);
        }).catch(() => {});
      }
    });
  }, []);

  const hasRun = selectedRunId != null;
  const task = tasks.find((t) => t.id === selectedTaskId);
  const hasTask = selectedTaskId != null;
  const noRuns = hasTask && task && (!task.runs || task.runs.length === 0);

  return (
    <div className="flex h-screen overflow-hidden bg-warm-bg text-warm-text">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {!hasTask ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-warm-muted/70 gap-3">
            <div className="text-5xl opacity-40">🧪</div>
            <p className="text-sm">왼쪽에서 실험을 선택하거나 새 실험을 만들어보세요.</p>
          </div>
        ) : !hasRun ? (
          /* Task selected but no run */
          <>
            <TopBar />
            <PhaseTabBar />
            <div className="flex-1 flex flex-col items-center justify-center text-warm-muted gap-4">
              <div className="text-[40px] opacity-40">🚀</div>
              {noRuns ? (
                <>
                  <p className="text-sm">아직 Run이 없습니다.</p>
                  <p className="text-[13px] text-warm-muted/70">
                    상단의 <strong>+ 새 Run</strong> 버튼으로 첫 번째 실험을 시작하세요.
                  </p>
                </>
              ) : (
                <p className="text-sm">왼쪽에서 Run을 선택하세요.</p>
              )}
            </div>
          </>
        ) : (
          /* Full run view */
          <>
            <TopBar />
            <PhaseTabBar />
            <div className="flex-1 overflow-y-auto py-5 px-6">
              <PhasePanel />
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <NewTaskModal />
      <EditTaskModal />
      <NewRunModal />
    </div>
  );
};

export default App;
