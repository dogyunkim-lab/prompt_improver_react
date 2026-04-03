import { useMemo, useCallback } from 'react';
import type { FilterState } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useTableFilter<T extends Record<string, any>>(
  data: T[],
  filter: FilterState,
  setFilter: (f: FilterState) => void,
) {
  const filtered = useMemo(() => {
    const entries = Object.entries(filter).filter(([, v]) => v.trim() !== '');
    if (entries.length === 0) return data;
    return data.filter((row) =>
      entries.every(([col, val]) => {
        const cell = String(row[col] ?? '').toLowerCase();
        return cell.includes(val.toLowerCase());
      }),
    );
  }, [data, filter]);

  const setCol = useCallback(
    (col: string, val: string) => {
      setFilter({ ...filter, [col]: val });
    },
    [filter, setFilter],
  );

  return { filtered, setCol };
}
