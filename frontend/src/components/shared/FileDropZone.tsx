import React from 'react';
import { cn } from '../../utils/cn';
import { useFileDrop } from '../../hooks/useFileDrop';

interface FileDropZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  fileName?: string | null;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ onFile, accept, label, fileName: externalFileName }) => {
  const { isDragging, fileName: internalFileName, inputRef, onDragOver, onDragLeave, onDrop, onChange, open } = useFileDrop(onFile, accept);
  const displayName = externalFileName ?? internalFileName;

  return (
    <div
      className={cn(
        'border-2 border-dashed border-warm-border rounded-lg p-5 text-center cursor-pointer transition-colors text-warm-muted text-[13px]',
        isDragging && 'border-ctp-mauve bg-ctp-mauve/5',
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={open}
    >
      <div>{label || '파일을 드래그하거나 클릭하여 업로드'}</div>
      {displayName && (
        <div className="mt-1.5 text-xs text-ctp-mauve font-semibold">{displayName}</div>
      )}
      <input ref={inputRef} type="file" accept={accept} onChange={onChange} className="hidden" />
    </div>
  );
};
