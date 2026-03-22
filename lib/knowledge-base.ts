export type KnowledgeSnippet = {
  id: string;
  title: string;
  scope: string;
  tags: string[];
  content: string;
};

export const INCIDENT_KNOWLEDGE_BASE: KnowledgeSnippet[] = [
  {
    id: "triage-golden-signals",
    title: "Golden Signal Triage",
    scope: "Incident triage",
    tags: ["latency", "errors", "traffic", "saturation", "sli", "slo"],
    content:
      "Start with impact and blast radius. Check latency, error rate, traffic shifts, and saturation. Correlate metric spike time with deploys, config changes, and dependency alerts before deep-diving.",
  },
  {
    id: "redis-pool-pressure",
    title: "Redis Pool Exhaustion Pattern",
    scope: "Dependency saturation",
    tags: ["redis", "timeouts", "pool", "retries", "queue", "connection"],
    content:
      "Symptoms: timeout spikes, retry amplification, queue lag growth. Validate client pool limits, active/idle connections, and wait times. Mitigate by controlling retries, improving connection reuse, and raising pool capacity safely.",
  },
  {
    id: "tls-cert-failures",
    title: "TLS/Certificate Failure Pattern",
    scope: "Platform/network",
    tags: ["tls", "x509", "certificate", "handshake", "auth", "idp"],
    content:
      "Symptoms: sudden auth failures, handshake errors, upstream 502/401 patterns. Validate cert expiry, trust chain, and clock drift. Rotate certs, reload trust stores, and add expiry alerts before recurrence.",
  },
  {
    id: "db-lock-contention",
    title: "Database Lock Contention Pattern",
    scope: "Data plane",
    tags: ["database", "postgres", "lock", "query", "index", "migration"],
    content:
      "Symptoms: write timeouts, lock waits, retry storms, CPU from repeated attempts. Inspect recent schema/migration changes and query plans. Restore missing indexes or rollback risky migration quickly.",
  },
  {
    id: "k8s-runtime-debugging",
    title: "Kubernetes Runtime Debugging",
    scope: "Compute platform",
    tags: ["kubernetes", "pods", "restarts", "oom", "hpa", "resources"],
    content:
      "Check pod restarts, OOM kills, throttling, and readiness failures. Compare requested vs actual resources. Validate HPA behavior and upstream dependency limits before scaling aggressively.",
  },
  {
    id: "incident-command",
    title: "Incident Command Rhythm",
    scope: "Operational process",
    tags: ["communication", "ic", "timeline", "updates", "stakeholders"],
    content:
      "Assign clear roles: incident commander, comms, investigator. Publish concise updates with impact, hypothesis, action, and next checkpoint. Keep a timeline for postmortem accuracy.",
  },
  {
    id: "hypothesis-loop",
    title: "Hypothesis-Driven Debugging",
    scope: "Debugging workflow",
    tags: ["hypothesis", "validation", "metrics", "logs", "rollback", "verify"],
    content:
      "State one hypothesis at a time, choose a confirming metric/log, run a low-risk test, and decide quickly. Avoid parallel random changes. Prefer reversible mitigations first, permanent fixes second.",
  },
  {
    id: "post-incident-hardening",
    title: "Post-Incident Hardening",
    scope: "Prevention",
    tags: ["postmortem", "action-items", "alerting", "runbook", "tests"],
    content:
      "Convert incident learning into concrete controls: alert tuning, runbook updates, regression tests, and ownership deadlines. Prevent recurrence by addressing systemic causes, not only symptom fixes.",
  },
];

export function getKnowledgeScopeLabels(limit = 5): string[] {
  return INCIDENT_KNOWLEDGE_BASE.slice(0, limit).map((item) => item.title);
}

export function retrieveKnowledgeSnippets(
  query: string,
  limit = 3,
): KnowledgeSnippet[] {
  const queryTokens = tokenize(query);
  if (!queryTokens.size) {
    return INCIDENT_KNOWLEDGE_BASE.slice(0, limit);
  }

  const scored = INCIDENT_KNOWLEDGE_BASE.map((snippet) => {
    const textTokens = tokenize(
      `${snippet.title} ${snippet.scope} ${snippet.tags.join(" ")} ${snippet.content}`,
    );
    let overlap = 0;
    for (const token of queryTokens) {
      if (textTokens.has(token)) {
        overlap += 1;
      }
    }
    return { snippet, score: overlap };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.snippet);
}

function tokenize(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return new Set<string>();
  }

  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "was",
    "were",
    "with",
  ]);

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !stopWords.has(token));
  return new Set(tokens);
}
