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

export type IncidentEvaluation = {
  symptomCoverage: number;
  debuggingCoverage: number;
  rootCauseMentioned: boolean;
  solutionMentioned: boolean;
  solved: boolean;
};
