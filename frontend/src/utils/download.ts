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
