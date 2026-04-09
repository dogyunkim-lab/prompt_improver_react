import React from 'react';

interface ReasoningSelectProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  modelName?: string;
}

export const ReasoningSelect: React.FC<ReasoningSelectProps> = ({
  value,
  onChange,
  disabled,
  modelName,
}) => {
  const isQwen = (modelName || '').toLowerCase().includes('qwen');

  return (
    <select
      value={isQwen ? (value === 'low' ? 'low' : 'high') : value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="py-2 px-2.5 border border-warm-border rounded-md text-[13px] bg-warm-card text-warm-text focus:border-ctp-mauve focus:outline-none disabled:opacity-50"
      title={
        isQwen
          ? 'Qwen Thinking 모드. On=추론 활성화, Off=추론 비활성화'
          : 'GPT 추론 수준. High=정밀하지만 느림, Low=빠르지만 얕은 분석'
      }
    >
      {isQwen ? (
        <>
          <option value="high">Thinking On</option>
          <option value="low">Thinking Off</option>
        </>
      ) : (
        <>
          <option value="high">High (정밀)</option>
          <option value="medium">Medium (균형)</option>
          <option value="low">Low (빠름)</option>
        </>
      )}
    </select>
  );
};
