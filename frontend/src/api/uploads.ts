import { apiFetch } from './client';

export function uploadJudge(runId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<{ ok: boolean; file_path: string; original_name: string }>(
    `/api/runs/${runId}/upload-judge`,
    { method: 'POST', body: form },
  );
}

/**
 * Classification 전용: XLSX/CSV 파일을 위치 기반으로 파싱하여 JSON으로 변환 후 업로드.
 * 컬럼 순서: A=id, B=stt, C=reference, D=generated
 * evaluation은 reference와 generated 비교로 자동 산정 (정답/오답).
 * 첫 행이 헤더면 자동 스킵.
 */
export async function uploadJudgeXLSX(runId: number, file: File) {
  const XLSX = await import('xlsx');
  const isCSV = /\.csv$/i.test(file.name);
  let wb;
  if (isCSV) {
    // CSV: 텍스트로 읽어 BOM 제거 후 파싱 (한글 인코딩 안정성)
    const text = await file.text();
    const cleaned = text.replace(/^\ufeff/, '');
    wb = XLSX.read(cleaned, { type: 'string' });
  } else {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: 'array' });
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('파일에 시트가 없습니다');
  const ws = wb.Sheets[sheetName];

  // 위치 기반 파싱: header:1로 행을 배열로 받는다
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (!rows.length) throw new Error('파일에 데이터가 없습니다');

  // 첫 행이 헤더로 보이면 스킵 (A열 값이 비어있거나 'id'/'ID' 등 텍스트면 헤더로 간주)
  const firstRow = rows[0];
  const firstCellRaw = firstRow[0];
  const firstCell = (firstCellRaw == null ? '' : String(firstCellRaw)).trim().toLowerCase();
  const looksLikeHeader =
    firstCell === '' || firstCell === 'id' ||
    ['stt', 'reference', 'generated'].includes(String(firstRow[1] ?? '').trim().toLowerCase()) ||
    ['stt', 'reference', 'generated'].includes(String(firstRow[2] ?? '').trim().toLowerCase());
  const dataRows = looksLikeHeader ? rows.slice(1) : rows;

  const cases = dataRows
    .filter((r) => r && (r[0] != null && String(r[0]).trim() !== ''))
    .map((r, i) => {
      const id = String(r[0] ?? '').trim() || String(i + 1);
      const stt = String(r[1] ?? '').trim();
      const reference = String(r[2] ?? '').trim();
      const generated = String(r[3] ?? '').trim();
      const evaluation = reference === generated && reference !== '' ? '정답' : '오답';
      return {
        id,
        generation_task: '',
        stt,
        reference,
        keywords: '',
        generated,
        reasoning_effort: '',
        reasoning_effort_result: '',
        answer_evaluation: evaluation,
        answer_evaluation_reason: evaluation === '정답'
          ? 'reference와 generated가 일치합니다'
          : `reference="${reference}" vs generated="${generated}" 불일치`,
      };
    });

  if (!cases.length) throw new Error('파일에서 유효한 행을 찾을 수 없습니다');

  // JSON Blob으로 변환하여 기존 upload-judge 엔드포인트로 전송
  const jsonBlob = new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' });
  const jsonFile = new File([jsonBlob], file.name.replace(/\.(xlsx?|csv)$/i, '.json'), {
    type: 'application/json',
  });

  const form = new FormData();
  form.append('file', jsonFile);
  return apiFetch<{ ok: boolean; file_path: string; original_name: string }>(
    `/api/runs/${runId}/upload-judge`,
    { method: 'POST', body: form },
  );
}

export function uploadPrompt(runId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<{ ok: boolean; file_path: string; original_name: string }>(
    `/api/runs/${runId}/upload-prompt`,
    { method: 'POST', body: form },
  );
}

export function saveUserGuide(runId: number, userGuide: string) {
  return apiFetch<{ ok: boolean }>(`/api/runs/${runId}/user-guide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_guide: userGuide }),
  });
}
