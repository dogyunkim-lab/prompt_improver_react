export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return String(v);
}

export function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

export function truncate(s: string, max = 80): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
