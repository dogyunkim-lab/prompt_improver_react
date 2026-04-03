import React, { useEffect, useRef } from 'react';
import type { LogEntry } from '../../types';
import { cn } from '../../utils/cn';

interface LogBoxProps {
  logs: LogEntry[];
  title?: string;
}

const levelColor: Record<string, string> = {
  info: 'text-[#1e88e5]',
  ok: 'text-score-good',
  warn: 'text-[#e07b00]',
  error: 'text-score-bad',
};

export const LogBox: React.FC<LogBoxProps> = React.memo(({ logs, title = '실행 로그' }) => {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="mb-5">
      <h4 className="text-[13px] text-[#555] mb-2">{title}</h4>
      <div
        ref={boxRef}
        className="bg-warm-table-bg border border-warm-table-border rounded-lg font-mono text-xs max-h-[300px] overflow-y-auto py-2.5 px-3.5"
      >
        {logs.length === 0 ? (
          <div className="text-warm-muted py-2">로그가 없습니다.</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="py-px leading-relaxed">
              <span className="text-warm-muted/70 mr-1.5">{log.ts}</span>
              <span className={cn(levelColor[log.level] || 'text-warm-text')}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

LogBox.displayName = 'LogBox';
