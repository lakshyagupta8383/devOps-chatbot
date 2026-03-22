import { generateRandomIncident } from "@/lib/generateRandomIncident";
import type { DevOpsIncident } from "@/lib/incident-types";

export const dynamic = "force-dynamic";

const FALLBACK_INCIDENTS: DevOpsIncident[] = [
  {
    serviceName: "payment-api",
    region: "ap-south-1",
    errorRate: "76%",
    issue: "Redis connection pool exhaustion after a traffic burst caused checkout timeout retries.",
    logs: [
      "2026-03-22T02:13:41Z payment-api ERROR redis pool exhausted (active=200, idle=0)",
      "2026-03-22T02:13:42Z payment-api WARN checkout request timed out after 3000ms",
      "2026-03-22T02:13:42Z ingress WARN upstream connection reset by peer",
      "2026-03-22T02:13:45Z payment-worker ERROR failed to enqueue retry job: redis timeout",
    ],
    symptoms: [
      "Checkout API latency spiked above 3s.",
      "5xx responses increased on /v1/payments/authorize.",
      "Retry queue lag grew rapidly.",
    ],
    correctDebuggingSteps: [
      "Check Redis client pool metrics and timeout counters.",
      "Compare traffic surge with pool max_connections settings.",
      "Inspect retry worker backlog and queue processing rates.",
      "Verify recent deployment changed connection reuse behavior.",
    ],
    finalSolution:
      "Increase Redis pool size, restore connection reuse, and add request-level circuit breaking to cap retries.",
  },
  {
    serviceName: "auth-gateway",
    region: "us-east-1",
    errorRate: "42%",
    issue:
      "Expired TLS certificate in the internal identity provider broke token introspection requests.",
    logs: [
      "2026-03-22T05:02:11Z auth-gateway ERROR x509: certificate has expired",
      "2026-03-22T05:02:11Z auth-gateway WARN token introspection failed (status=502)",
      "2026-03-22T05:02:12Z edge WARN login request failed with upstream handshake error",
    ],
    symptoms: [
      "Users were logged out and unable to sign in.",
      "401 and 502 responses increased on login endpoints.",
      "Session refresh calls failed across all tenants.",
    ],
    correctDebuggingSteps: [
      "Validate certificate expiry for IdP upstream endpoints.",
      "Check handshake errors and trust chain in gateway logs.",
      "Confirm DNS and network path are healthy to rule out connectivity issues.",
      "Rotate certificate and reload gateway trust store.",
    ],
    finalSolution:
      "Renew IdP TLS certificate, update trust chain in gateway pods, and add expiry alerts 14 days before rotation.",
  },
  {
    serviceName: "orders-db-writer",
    region: "eu-west-1",
    errorRate: "31%",
    issue:
      "A migration removed a composite index, causing lock contention and write query timeouts.",
    logs: [
      "2026-03-22T08:47:02Z writer ERROR insert timed out waiting for lock (tx=9f2a)",
      "2026-03-22T08:47:03Z postgres LOG statement exceeded lock_timeout: 2s",
      "2026-03-22T08:47:05Z writer WARN transaction retry attempt=3",
      "2026-03-22T08:47:07Z autoscaler WARN pod CPU high due to retry amplification",
    ],
    symptoms: [
      "Order creation intermittently failed.",
      "Database lock wait time increased sharply.",
      "Write throughput dropped while CPU usage rose.",
    ],
    correctDebuggingSteps: [
      "Inspect migration history for dropped indexes.",
      "Run EXPLAIN ANALYZE on the write path queries.",
      "Correlate lock wait events with retry spikes in application logs.",
      "Rollback migration or recreate missing index concurrently.",
    ],
    finalSolution:
      "Recreate the missing composite index, reduce lock_timeout retries, and gate migrations with query plan checks.",
  },
];

export async function GET() {
  try {
    const incident = await generateRandomIncident();
    return Response.json(
      { incident },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Incident generation failed, falling back to static scenario.", error);
    return Response.json(
      {
        incident: pickRandomIncident(),
        source: "fallback",
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}

function pickRandomIncident(): DevOpsIncident {
  const index = Math.floor(Math.random() * FALLBACK_INCIDENTS.length);
  return FALLBACK_INCIDENTS[index];
}
