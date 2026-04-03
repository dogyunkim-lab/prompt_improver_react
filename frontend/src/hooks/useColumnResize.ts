import { useCallback, useRef } from 'react';

export function useColumnResize() {
  const startX = useRef(0);
  const startW = useRef(0);
  const activeCol = useRef<HTMLTableColElement | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent, colRef: HTMLTableColElement) => {
    e.preventDefault();
    startX.current = e.clientX;
    startW.current = colRef.offsetWidth || parseInt(colRef.style.width) || 100;
    activeCol.current = colRef;

    const onMove = (ev: MouseEvent) => {
      if (!activeCol.current) return;
      const diff = ev.clientX - startX.current;
      const newW = Math.max(40, startW.current + diff);
      activeCol.current.style.width = `${newW}px`;
    };

    const onUp = () => {
      activeCol.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return { onMouseDown };
}
