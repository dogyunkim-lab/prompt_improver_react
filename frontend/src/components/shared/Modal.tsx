import React, { useEffect, useRef } from 'react';
import { cn } from '../../utils/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, footer }) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/45 z-[1000] flex items-center justify-center"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={cn(
        'bg-warm-card rounded-[14px] p-7 w-[460px] max-w-[95vw]',
        'shadow-[0_8px_40px_rgba(0,0,0,0.18)] relative max-h-[90vh] overflow-y-auto',
      )}>
        <h3 className="text-base font-semibold text-ctp-base mb-[18px]">{title}</h3>
        {children}
        {footer && <div className="flex justify-end gap-2 mt-5">{footer}</div>}
      </div>
    </div>
  );
};
