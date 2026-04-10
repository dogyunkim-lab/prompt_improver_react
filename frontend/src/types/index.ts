/* ── Task ── */
export type TaskType = 'summarization' | 'classification';

export interface Task {
  id: number;
  name: string;
  description?: string;
  generation_task?: string;
  task_type?: TaskType;
  gpt_api_base?: string;
  gpt_api_key?: string;
  gpt_model?: string;
  sim_api_base?: string;
  sim_api_key?: string;
  sim_model?: string;
  anchor_guide_file?: string;
  label_list?: string[];
  label_definitions?: Record<string, string>;
  created_at?: string;
  runs: Run[];
}

/* ── Run ── */
export interface Run {
  id: number;
  task_id: number;
  run_number: number;
  start_mode: 'zero' | 'continue';
  base_run_id?: number | null;
  status: string;
  current_phase?: number;
  judge_file_path?: string;
  judge_original_name?: string;
  prompt_file_path?: string;
  prompt_original_name?: string;
  user_guide?: string;
  total_cases?: number;
  score_correct?: number;
  score_over?: number;
  score_total?: number;
  created_at?: string;
  completed_at?: string;
  selected_candidate_id?: number | null;
}

/* ── Run detail (from GET /api/runs/:id) ── */
export interface RunDetail extends Run {
  phases: Record<number, PhaseData>;
  dify_connections?: DifyConnection[];
}

/* ── Phase data ── */
export interface PhaseData {
  status: PhaseStatus;
  output_data?: Record<string, unknown>;
  log_text?: string;
  cases?: CaseResult[];
  eval_chart?: ChartData;
  bucket_chart?: ChartData;
  candidates?: Candidate[];
  scores?: Record<string, number>;
  // Classification 전용 (Phase 1)
  task_type?: 'summarization' | 'classification';
  label_list?: string[];
  label_definitions?: Record<string, string>;
  confusion_matrix?: ConfusionMatrix;
  top_confusions?: Array<{ pair: string; count: number }>;
  error_cause_counts?: Record<string, number>;
  schema_violation_count?: number;
  missed_signals?: Array<{ text: string; count: number }>;
  overweighted_signals?: Array<{ text: string; count: number }>;
  label_definition_gaps?: string;
  recommended_focus?: string;
  top_issues?: string[];
}

export type PhaseStatus = 'idle' | 'pending' | 'running' | 'completed' | 'done' | 'failed' | 'cancelled';

/* ── Case result ── */
export interface CaseResult {
  id: string;
  case_id?: string;
  generation_task?: string;
  stt?: string;
  reference?: string;
  keywords?: string;
  generated?: string;
  evaluation?: string;
  reason?: string;
  bucket?: string;
  analysis_summary?: string;
  stt_uncertain?: string;
  intermediate_outputs?: Record<string, { node: string; content: string }>;
  hallucination_detected?: boolean;
  judge_agreement?: string;
  judge_disagreement?: string;
  missing_instruction?: string;
  violated_instruction?: string;
  error_pattern?: string;
  improvement_suggestion?: string;
  reference_criteria?: string;
  content_gap?: string;
  // Phase 5 delta
  prev_judge?: string;
  delta_type?: 'improved' | 'regressed' | 'unchanged' | 'new';
  // Classification 전용
  ref_label?: string;
  pred_label?: string;
  label_in_schema?: boolean;
  closest_label?: string;
  confusion_pair?: string;
  key_signals_in_stt?: string[];
  missed_signals?: string[];
  overweighted_signals?: string[];
  boundary_analysis?: string;
  error_cause?: string;
  secondary_cause?: string;
}

/* ── Confusion Matrix ── */
export interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
}

/* ── Candidate ── */
export interface Candidate {
  id: number;
  run_id: number;
  candidate_label: string;
  mode: 'explore' | 'converge';
  node_count: number;
  design_rationale?: string;
  nodes: CandidateNode[];
  // Flattened from DB
  node_a_system_prompt?: string;
  node_a_user_prompt?: string;
  node_a_input_vars?: string[];
  node_a_output_var?: string;
  node_a_reasoning?: boolean;
  node_b_system_prompt?: string;
  node_b_user_prompt?: string;
  node_b_input_vars?: string[];
  node_b_output_var?: string;
  node_b_reasoning?: boolean;
  node_c_system_prompt?: string;
  node_c_user_prompt?: string;
  node_c_input_vars?: string[];
  node_c_output_var?: string;
  node_c_reasoning?: boolean;
}

export interface CandidateNode {
  label: string;
  system_prompt: string;
  user_prompt: string;
  input_vars: string[];
  output_var: string;
  reasoning: boolean;
}

/* ── Mini-Validation ── */
export interface MiniValidationDetail {
  case_id: string;
  evaluation: string;
  reason?: string;
  stt?: string;
  reference?: string;
  generated_preview?: string;
  error?: string;
}

export interface MiniValidationCandidateResult {
  label: string;
  pass_rate: number;
  passed: number;
  total: number;
  details: MiniValidationDetail[];
}

export interface MiniValidationSummary {
  enabled: boolean;
  validation_case_count: number;
  candidate_results: MiniValidationCandidateResult[];
}

/* ── Dify ── */
export interface DifyConnection {
  id: number;
  run_id: number;
  candidate_id: number;
  object_id: string;
  label?: string;
  status: 'pending' | 'verified' | 'failed';
  verified_at?: string;
}

/* ── Charts ── */
export interface ChartData {
  labels: string[];
  values: number[];
}

/* ── Phase 5 ── */
export interface Phase5Data {
  scores: {
    correct_plus_over: number;
    correct: number;
    over: number;
    wrong: number;
  };
  delta: { improve: number; regress: number; same: number };
  trend: { labels: string[]; values: number[] };
  regressed_cases: Array<{
    id: string;
    prev_judge: string;
    curr_judge: string;
    reason?: string;
  }>;
  goal_achieved: boolean;
  gap_to_goal: number;
  cases: CaseResult[];
}

/* ── Phase 6 ── */
export interface Phase6Data {
  backprop: string;
  next_direction: string;
  effective: string[];
  harmful: string[];
  constraints?: string;
  candidates_comparison?: string;
  experiment_summary?: string;
}

/* ── SSE Events ── */
export interface SSELogEvent {
  type: 'log';
  level: 'info' | 'ok' | 'warn' | 'error';
  message: string;
  ts: string;
}

export interface SSEProgressEvent {
  type: 'progress';
  current: number;
  total: number;
}

export interface SSECaseEvent {
  type: 'case';
  data: CaseResult;
}

export interface SSEResultEvent {
  type: 'result';
  data: Record<string, unknown>;
}

export interface SSEDoneEvent {
  type: 'done';
  status: string;
}

export type SSEEvent = SSELogEvent | SSEProgressEvent | SSECaseEvent | SSEResultEvent | SSEDoneEvent;

/* ── Log entry ── */
export interface LogEntry {
  level: 'info' | 'ok' | 'warn' | 'error';
  message: string;
  ts: string;
}

/* ── Sort/filter ── */
export interface SortState {
  col: string | null;
  dir: 1 | -1;
}

export type FilterState = Record<string, string>;
