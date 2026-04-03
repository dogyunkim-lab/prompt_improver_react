import React, { useCallback, useMemo, useState } from 'react';
import { usePhaseStore } from '../../stores/phaseStore';
import { useRunStore } from '../../stores/runStore';
import { useSSE } from '../../hooks/useSSE';
import { useTableSort } from '../../hooks/useTableSort';
import { useTableFilter } from '../../hooks/useTableFilter';
import { ScoreCards } from '../shared/ScoreCards';
import { LogBox } from '../shared/LogBox';
import { ProgressBar } from '../shared/ProgressBar';
import { FileDropZone } from '../shared/FileDropZone';
import { DataTable, type Column } from '../shared/DataTable';
import { CaseDetail } from '../shared/CaseDetail';
import { EvalBarChart } from '../charts/EvalBarChart';
import { BucketBarChart } from '../charts/BucketBarChart';
import { uploadJudge, uploadPrompt } from '../../api/uploads';
import { runPhase, cancelPhase } from '../../api/phases';
import { downloadJSON, downloadXLSX } from '../../utils/download';
import { fmtPct } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { CaseResult } from '../../types';

const P1_COLUMNS: Column[] = [
  { key: 'id', label: 'ID', width: '60px', sortable: true },
  { key: 'evaluation', label: 'Judge판정', width: '70px', sortable: true,
    render: (v) => {
      const val = String(v || '');
      const color = val === '오답' ? 'text-score-bad' : val === '과답' ? 'text-score-warn' : val === '정답' ? 'text-score-good' : '';
      return <span className={cn('font-semibold', color)}>{val}</span>;
    },
  },
  { key: 'bucket', label: '버킷', width: '100px', sortable: true },
  { key: 'analysis_summary', label: '분석사유', width: '180px' },
  { key: 'stt_uncertain', label: 'STT불확실표현', width: '100px' },
  { key: 'stt', label: 'STT', width: '180px' },
  { key: 'reference', label: 'Reference', width: '180px' },
  { key: 'generated', label: 'Generated', width: '180px' },
  { key: 'judge_disagreement', label: 'Judge이견', width: '150px' },
];

const DETAIL_FIELDS = [
  { key: 'id', label: 'ID' },
  { key: 'evaluation', label: 'Judge판정' },
  { key: 'bucket', label: '버킷' },
  { key: 'analysis_summary', label: '분석사유' },
  { key: 'stt', label: 'STT' },
  { key: 'reference', label: 'Reference' },
  { key: 'generated', label: 'Generated' },
  { key: 'missing_instruction', label: '누락 지시사항' },
  { key: 'violated_instruction', label: '위반 지시사항' },
  { key: 'error_pattern', label: '오류 패턴' },
  { key: 'improvement_suggestion', label: '개선 제안' },
];

export const Phase1Panel: React.FC = () => {
  const runStore = useRunStore();
  const ps = usePhaseStore();
  const runId = runStore.selectedRunId;
  const runData = runStore.runData;

  const [judgeFile, setJudgeFile] = useState<File | null>(null);
  const [promptFile, setPromptFile] = useState<File | null>(null);
  const [judgeFileName, setJudgeFileName] = useState<string | null>(null);
  const [promptFileName, setPromptFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const isRunning = ps.phaseStatus[1] === 'running';

  // SSE connection
  useSSE(runId, 1, isRunning, {
    onLog: (level, message, ts) => ps.addP1Log({ level: level as 'info', message, ts }),
    onProgress: (current, total) => ps.setP1Progress({ current, total }),
    onCase: (data) => ps.addP1Case(data as unknown as CaseResult),
    onResult: (data) => {
      const d = data as Record<string, unknown>;
      if (d.scores) ps.setP1Scores(d.scores as typeof ps.p1Scores);
      if (d.eval_chart) ps.setP1Charts(d.eval_chart as { labels: string[]; values: number[] }, d.bucket_chart as { labels: string[]; values: number[] } | null);
      if (d.cases && Array.isArray(d.cases)) ps.setP1Cases(d.cases as CaseResult[]);
    },
    onDone: async (status) => {
      ps.setPhaseStatus(1, status === 'completed' ? 'completed' : 'failed');
      runStore.setRunningPhase(runId!, null);
      if (runId) {
        try {
          const data = await runStore.loadRunData(runId);
          ps.updatePhaseTabsFromRunData(data.phases || {});
        } catch { /* ignore */ }
      }
    },
  });

  // Load existing data from runData
  React.useEffect(() => {
    if (!runData?.phases?.[1]) return;
    const p1 = runData.phases[1];
    if (p1.cases?.length) ps.setP1Cases(p1.cases);
    if (p1.eval_chart) ps.setP1Charts(p1.eval_chart, p1.bucket_chart || null);
    const od = p1.output_data as Record<string, unknown> | undefined;
    if (od?.scores) ps.setP1Scores(od.scores as typeof ps.p1Scores);
    // continue mode banner
    if (runData.start_mode === 'continue' && runData.judge_original_name) {
      setJudgeFileName(runData.judge_original_name);
    }
    if (runData.prompt_original_name) {
      setPromptFileName(runData.prompt_original_name);
    }
  }, [runData]);

  // Table sort/filter
  const { sorted, toggleSort } = useTableSort(ps.p1Cases as any[], ps.p1Sort, ps.setP1Sort);
  const { filtered, setCol } = useTableFilter(sorted, ps.p1Filter, ps.setP1Filter);

  const scoreCards = useMemo(() => {
    const s = ps.p1Scores;
    if (!s) return [
      { label: '정답+과답%', value: '—', sub: '정답 + 과답', variant: 'good' as const },
      { label: '정답%', value: '—', sub: '정확한 답변', variant: 'default' as const },
      { label: '과답%', value: '—', sub: '과도한 답변', variant: 'warn' as const },
      { label: '오답%', value: '—', sub: '틀린 답변', variant: 'bad' as const },
    ];
    return [
      { label: '정답+과답%', value: fmtPct(s.correct_plus_over), sub: '정답 + 과답', variant: 'good' as const },
      { label: '정답%', value: fmtPct(s.correct), sub: '정확한 답변', variant: 'default' as const },
      { label: '과답%', value: fmtPct(s.over), sub: '과도한 답변', variant: 'warn' as const },
      { label: '오답%', value: fmtPct(s.wrong), sub: '틀린 답변', variant: 'bad' as const },
    ];
  }, [ps.p1Scores]);

  const onUploadJudge = useCallback(async () => {
    if (!runId || !judgeFile) return;
    setUploading(true);
    try {
      const res = await uploadJudge(runId, judgeFile);
      setJudgeFileName(res.original_name);
    } catch (e) {
      alert('업로드 오류: ' + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }, [runId, judgeFile]);

  const onUploadPrompt = useCallback(async () => {
    if (!runId || !promptFile) return;
    setUploading(true);
    try {
      const res = await uploadPrompt(runId, promptFile);
      setPromptFileName(res.original_name);
    } catch (e) {
      alert('업로드 오류: ' + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }, [runId, promptFile]);

  const onRun = useCallback(async () => {
    if (!runId) return;
    ps.clearP1Logs();
    ps.setP1Cases([]);
    ps.setP1Progress({ current: 0, total: 0 });
    ps.setP1Scores(null);
    ps.setP1Charts(null, null);
    ps.setPhaseStatus(1, 'running');
    runStore.setRunningPhase(runId, 1);
    try {
      await runPhase(runId, 1);
    } catch (e) {
      alert('실행 오류: ' + (e as Error).message);
      ps.setPhaseStatus(1, 'failed');
      runStore.setRunningPhase(runId, null);
    }
  }, [runId, ps, runStore]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try {
      await cancelPhase(runId, 1);
    } catch { /* ignore */ }
  }, [runId]);

  const isContinue = runData?.start_mode === 'continue';

  return (
    <div>
      {/* Continue mode banner */}
      {isContinue && runData?.judge_original_name && (
        <div className="py-3 px-4 bg-[#e8f4fd] border border-[#b6d4fe] rounded-lg mb-4 text-[13px] text-[#1e40af] font-medium">
          Continue 모드: 이전 Run 데이터가 자동으로 로드되었습니다. (Judge: {runData.judge_original_name})
        </div>
      )}

      {/* Upload sections */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">Judge JSON 업로드</h4>
        <FileDropZone
          onFile={(f) => setJudgeFile(f)}
          accept=".json"
          fileName={judgeFileName}
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
            onClick={onUploadJudge}
            disabled={!judgeFile || uploading}
          >업로드</button>
          {judgeFileName && <span className="text-xs text-warm-muted">✓ {judgeFileName}</span>}
        </div>
      </div>

      <div className="bg-warm-card rounded-[10px] p-4 mb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-1">현재 요약 프롬프트 업로드 (선택)</h4>
        <p className="text-[11px] text-warm-muted mb-2">현재 사용 중인 요약 프롬프트 TXT 파일을 제공하면, Phase 1 분석 시 프롬프트 누락/위반 여부를 정확히 판단할 수 있습니다.</p>
        <FileDropZone
          onFile={(f) => setPromptFile(f)}
          accept=".txt,.md"
          label="프롬프트 TXT 파일 드래그 또는 클릭"
          fileName={promptFileName}
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            className="py-2 px-4 bg-transparent text-ctp-mauve rounded-md font-semibold text-[13px] border border-ctp-mauve hover:bg-ctp-mauve/10 disabled:opacity-50"
            onClick={onUploadPrompt}
            disabled={!promptFile || uploading}
          >프롬프트 업로드</button>
          {promptFileName && <span className="text-xs text-warm-muted">✓ {promptFileName}</span>}
        </div>
      </div>

      <ScoreCards items={scoreCards} />

      {/* Charts */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">판정 분포</h4>
        <div className="flex gap-5 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <EvalBarChart data={ps.p1EvalChart} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <h4 className="text-xs text-warm-muted mb-2">오류 원인 분류 (오답/과답 케이스)</h4>
            <BucketBarChart data={ps.p1BucketChart} />
          </div>
        </div>
      </div>

      {/* Bucket legend */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">버킷 설명</h4>
        <div className="grid grid-cols-2 gap-2.5 text-xs leading-relaxed">
          {[
            { color: '#f38ba8', name: 'STT 오류', desc: '음성인식(STT) 자체의 오류로 인한 잘못된 입력. 프롬프트 개선으로 해결 불가능한 영역.' },
            { color: '#f9e2af', name: '프롬프트 누락', desc: '프롬프트에 필요한 지시사항이 빠져있거나 불명확하여 발생한 오류.' },
            { color: '#89b4fa', name: '모델 동작', desc: '프롬프트는 적절하나 모델이 지시를 따르지 못한 경우.' },
            { color: '#cba6f7', name: 'Judge 이견', desc: '모델 응답은 적절하나 Judge 판정이 잘못된 것으로 의심되는 케이스.' },
          ].map((b) => (
            <div key={b.name}>
              <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ background: b.color }} />
              <strong>{b.name}</strong><br />
              <span className="text-[#666] ml-4">{b.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-warm-card rounded-[10px] p-4 mb-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        <h4 className="text-[13px] text-[#555] mb-3">케이스 목록</h4>
        <div className="flex gap-1.5 mb-2">
          <button className="py-1 px-2.5 text-xs border border-[#555] bg-[#2a2a2a] text-[#ccc] rounded cursor-pointer hover:bg-[#3a3a3a]"
            onClick={() => downloadJSON(ps.p1Cases, `phase1_cases_run${runData?.run_number || ''}.json`)}>JSON ⬇</button>
          <button className="py-1 px-2.5 text-xs border border-[#555] bg-[#2a2a2a] text-[#ccc] rounded cursor-pointer hover:bg-[#3a3a3a]"
            onClick={() => downloadXLSX(ps.p1Cases, `phase1_cases_run${runData?.run_number || ''}.xlsx`)}>XLSX ⬇</button>
        </div>
        <DataTable
          columns={P1_COLUMNS}
          data={filtered as CaseResult[]}
          sort={ps.p1Sort}
          filter={ps.p1Filter}
          onSort={toggleSort}
          onFilter={setCol}
          renderDetail={(row) => <CaseDetail row={row} fields={DETAIL_FIELDS} />}
          rowClassName={(row) =>
            row.evaluation === '오답' ? 'bg-ctp-red/10' : row.evaluation === '과답' ? 'bg-ctp-yellow/20' : ''
          }
        />
      </div>

      <ProgressBar label="오답/과답 케이스 분석" current={ps.p1Progress.current} total={ps.p1Progress.total} hidden={ps.p1Progress.total === 0} />
      <LogBox logs={ps.p1Logs} />

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="py-2 px-4 bg-ctp-mauve text-ctp-base rounded-md font-semibold text-[13px] hover:opacity-85 disabled:opacity-50"
          onClick={onRun}
          disabled={isRunning}
        >Phase 1 실행</button>
        {isRunning && (
          <button
            className="py-2 px-3.5 bg-ctp-red text-ctp-base rounded-md font-semibold text-xs hover:opacity-85"
            onClick={onCancel}
          >■ 중단</button>
        )}
      </div>
    </div>
  );
};
