export type DevOpsIncident = {
  serviceName: string;
  region: string;
  errorRate: string;
  issue: string;
  logs: string[];
  symptoms: string[];
  correctDebuggingSteps: string[];
  finalSolution: string;
};

export type ChatRole = "user" | "assistant";

export type ChatTurn = {
  role: ChatRole;
  content: string;
};

export type ChatReferenceSource =
  | "incident-log"
  | "incident-symptom"
  | "incident-debug-step"
  | "incident-metric"
  | "knowledge-base"
  | "fallback";

export type ChatReference = {
  id: string;
  source: ChatReferenceSource;
  label: string;
  evidence: string;
};

export type EvaluationVerdict = "correct" | "partially correct" | "incorrect";

export type SolutionEvaluation = {
  verdict: EvaluationVerdict;
  explanation: string;
  whatMissed: string[];
  score: number;
};
