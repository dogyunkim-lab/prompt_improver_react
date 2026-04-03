import { useMemo, useCallback } from 'react';
import type { SortState } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useTableSort<T extends Record<string, any>>(
  data: T[],
  sort: SortState,
  setSort: (s: SortState) => void,
) {
  const sorted = useMemo(() => {
    if (!sort.col) return data;
    const col = sort.col;
    const dir = sort.dir;
    return [...data].sort((a, b) => {
      const va = String(a[col] ?? '');
      const vb = String(b[col] ?? '');
      return va.localeCompare(vb, 'ko') * dir;
    });
  }, [data, sort]);

  const toggleSort = useCallback(
    (col: string) => {
      setSort({
        col,
        dir: sort.col === col ? (sort.dir === 1 ? -1 : 1) : 1,
      });
    },
    [sort, setSort],
  );

  return { sorted, toggleSort };
}
