import React, { useRef, useCallback } from 'react';
import type { CaseResult } from '../../types';

interface CaseDetailProps {
  row: CaseResult;
  fields: { key: string; label: string }[];
}

export const CaseDetail: React.FC<CaseDetailProps> = ({ row, fields }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const onResizeStart = useCallback((e: React.MouseEvent, fieldEl: HTMLDivElement) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = fieldEl.offsetWidth;

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(60, startW + (ev.clientX - startX));
      fieldEl.style.width = `${newW}px`;
      fieldEl.style.minWidth = `${newW}px`;
      fieldEl.style.flexGrow = '0';
      fieldEl.style.flexShrink = '0';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-[320px] overflow-hidden p-2.5 mx-2 mb-2 bg-warm-hover border border-warm-table-border rounded-lg flex flex-nowrap gap-0 text-xs"
    >
      {fields.map((field) => {
        let value: unknown = row[field.key as keyof CaseResult];
        if (field.key === 'intermediate_outputs' && value && typeof value === 'object') {
          value = Object.entries(value as Record<string, { node: string; content: string }>)
            .map(([k, v]) => `[${v.node}] ${k}:\n${v.content}`)
            .join('\n\n');
        } else if (Array.isArray(value)) {
          // 배열은 줄 단위로 표시 (key_signals_in_stt, missed_signals 등)
          value = value.map((v) => (typeof v === 'string' ? `• ${v}` : `• ${JSON.stringify(v)}`)).join('\n');
        } else if (value && typeof value === 'object') {
          // 객체는 JSON으로
          value = JSON.stringify(value, null, 2);
        }
        return (
          <div
            key={field.key}
            className="flex flex-col border-r border-warm-table-border min-w-[60px] overflow-hidden relative flex-1 last:border-r-0"
          >
            <div className="text-[10px] font-bold text-warm-muted py-1 px-2.5 shrink-0 border-b border-warm-table-border/50">
              {field.label}
            </div>
            <div className="text-warm-text leading-relaxed whitespace-pre-wrap break-words py-1.5 px-2.5 overflow-y-auto flex-1">
              {String(value ?? '')}
            </div>
            <div
              className="absolute top-0 -right-[3px] w-1.5 h-full cursor-col-resize z-[2] hover:bg-ctp-mauve/40"
              onMouseDown={(e) => {
                const fieldEl = e.currentTarget.parentElement;
                if (fieldEl) onResizeStart(e, fieldEl as HTMLDivElement);
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
