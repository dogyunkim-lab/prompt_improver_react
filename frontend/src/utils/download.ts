import type { CaseResult } from '../types';

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Phase 4 Judge 결과를 외부 Judge 결과 JSON과 동일한 형식으로 다운로드.
 * { summary: {...}, cases: [...] } 구조.
 */
export function downloadJudgeResultJSON(
  cases: CaseResult[],
  filename: string,
  meta?: { runNumber?: number; generationTask?: string },
) {
  const failedIds = cases
    .filter((c) => c.evaluation === '평가실패')
    .map((c) => c.id || c.case_id || '');

  const output = {
    summary: {
      total_cases: cases.length,
      generation_task: meta?.generationTask || '',
      run_number: meta?.runNumber ?? null,
      finished_at: new Date().toISOString(),
      failed_evaluation_ids: failedIds,
    },
    cases: cases.map((c) => ({
      id: c.id || c.case_id || '',
      generation_task: c.generation_task || '',
      stt: c.stt || '',
      reference: c.reference || '',
      keywords: c.keywords || '',
      generated: c.generated || '',
      answer_evaluation: c.evaluation || '',
      answer_evaluation_reason: c.reason || '',
    })),
  };

  downloadJSON(output, filename);
}

export function downloadXLSX(cases: CaseResult[], filename: string) {
  import('xlsx').then((XLSX) => {
    const rows = cases.map((c) => ({
      ID: c.id || c.case_id,
      판정: c.evaluation || '',
      사유: c.reason || '',
      버킷: c.bucket || '',
      STT: c.stt || '',
      Reference: c.reference || '',
      Generated: c.generated || '',
      분석사유: c.analysis_summary || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cases');
    XLSX.writeFile(wb, filename);
  });
}
