export const PHASE_NAMES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6'] as const;

export const BUCKET_COLORS: Record<string, string> = {
  stt_error: '#f38ba8',
  prompt_missing: '#f9e2af',
  model_behavior: '#89b4fa',
  judge_dispute: '#cba6f7',
};

export const BUCKET_LABELS: Record<string, string> = {
  stt_error: 'STT 오류',
  prompt_missing: '프롬프트 누락',
  model_behavior: '모델 동작',
  judge_dispute: 'Judge 이견',
};

export const EVAL_COLORS = {
  정답: '#a6e3a1',
  과답: '#f9e2af',
  오답: '#f38ba8',
};
