import React, { useState, useCallback, useRef } from 'react';
import { cn } from '../../utils/cn';
import type { SortState, FilterState, CaseResult } from '../../types';

export interface Column {
  key: string;
  label: string;
  width?: string;
  sortable?: boolean;
  filterable?: boolean;
  render?: (value: unknown, row: CaseResult) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: CaseResult[];
  sort: SortState;
  filter: FilterState;
  onSort: (col: string) => void;
  onFilter: (col: string, val: string) => void;
  renderDetail?: (row: CaseResult) => React.ReactNode;
  rowClassName?: (row: CaseResult) => string;
  emptyText?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
  columns, data, sort, filter, onSort, onFilter, renderDetail, rowClassName, emptyText = '데이터 없음',
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const colRefs = useRef<Record<string, HTMLTableColElement | null>>({});

  const toggleRow = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const col = colRefs.current[colKey];
    if (!col) return;
    const startX = e.clientX;
    const startW = parseInt(col.style.width) || 100;

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(40, startW + (ev.clientX - startX));
      col.style.width = `${newW}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map((col) => (
            <col
              key={col.key}
              ref={(el) => { colRefs.current[col.key] = el; }}
              style={{ width: col.width || 'auto' }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'bg-warm-table-bg text-left py-[7px] px-2.5 border-b border-warm-table-border text-[#666] font-semibold relative overflow-hidden text-ellipsis whitespace-nowrap',
                  col.sortable && 'cursor-pointer select-none hover:text-ctp-blue',
                )}
                onClick={() => col.sortable && onSort(col.key)}
              >
                {col.label}
                {col.sortable && (
                  <span className="text-[10px] text-ctp-overlay0 ml-0.5">
                    {sort.col === col.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}
                  </span>
                )}
                <div
                  className="absolute right-0 top-0 w-[5px] h-full cursor-col-resize z-[2] hover:bg-ctp-mauve"
                  onMouseDown={(e) => onResizeStart(e, col.key)}
                />
              </th>
            ))}
          </tr>
          <tr>
            {columns.map((col) => (
              <td key={col.key} className="py-[3px] px-1 bg-warm-hover">
                {col.filterable !== false && (
                  <input
                    className="w-full py-[3px] px-1.5 border border-[#ddd] rounded text-[11px] bg-warm-card text-warm-text focus:border-ctp-mauve focus:outline-none"
                    placeholder="필터..."
                    value={filter[col.key] || ''}
                    onChange={(e) => onFilter(col.key, e.target.value)}
                  />
                )}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center text-warm-muted/70 py-5">
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row) => {
              const id = row.id || row.case_id || '';
              const isExpanded = expandedId === id;
              return (
                <React.Fragment key={id}>
                  <tr
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-ctp-mauve/[0.08]',
                      isExpanded && 'bg-ctp-mauve/[0.12]',
                      rowClassName?.(row),
                    )}
                    onClick={() => toggleRow(id)}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'py-[7px] px-2.5 border-b border-warm-table-bg text-[#444] overflow-hidden text-ellipsis',
                          isExpanded && 'border-b-0',
                        )}
                      >
                        <div className="max-w-[180px] whitespace-nowrap overflow-hidden text-ellipsis text-xs leading-normal">
                          {col.render
                            ? col.render(row[col.key as keyof CaseResult], row)
                            : String(row[col.key as keyof CaseResult] ?? '')}
                        </div>
                      </td>
                    ))}
                  </tr>
                  {isExpanded && renderDetail && (
                    <tr>
                      <td colSpan={columns.length} className="!p-0 border-b border-warm-table-border">
                        {renderDetail(row)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
