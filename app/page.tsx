"use client";

import { useMemo, useState } from "react";
import { getKnowledgeScopeLabels } from "@/lib/knowledge-base";
import ChatInterface from "./components/ChatInterface";
import IncidentPanel from "./components/IncidentPanel";

type IncidentPanelData = {
  serviceName: string;
  errorRate: string;
  region: string;
  time: string;
};

const INITIAL_INCIDENT_PANEL_DATA: IncidentPanelData = {
  serviceName: "loading scenario...",
  errorRate: "--",
  region: "--",
  time: "--",
};

const PRODUCT_PILLARS = [
  "Runbook-grounded coaching",
  "Hidden scenario simulation",
  "Senior-style final evaluation",
];

export default function Home() {
  const [incidentPanelData, setIncidentPanelData] = useState<IncidentPanelData>(
    INITIAL_INCIDENT_PANEL_DATA,
  );
  const knowledgeScope = useMemo(() => getKnowledgeScopeLabels(6), []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07031a] text-zinc-100">
      <div className="terminal-grid pointer-events-none absolute inset-0 opacity-25" />
      <div className="pointer-events-none absolute -left-28 top-[-90px] h-72 w-72 rounded-full bg-cyan-400/35 blur-3xl" />
      <div className="pointer-events-none absolute right-[20%] top-[-110px] h-72 w-72 rounded-full bg-fuchsia-500/25 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-120px] right-[-120px] h-80 w-80 rounded-full bg-orange-500/25 blur-3xl" />

      <section className="relative mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6 lg:gap-6 lg:p-8">
        <header className="rounded-xl border border-cyan-400/35 bg-zinc-950/75 p-5 shadow-[0_0_0_1px_rgba(34,211,238,0.12)] backdrop-blur lg:p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
            OnCall Mentor
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-100 md:text-3xl">
            Incident Response Training Chatbot
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-300 md:text-[15px]">
            Practice live production debugging with hidden scenarios, realistic
            telemetry, and direct feedback on your diagnosis quality.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PRODUCT_PILLARS.map((pillar) => (
              <span
                key={pillar}
                className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-100"
              >
                {pillar}
              </span>
            ))}
          </div>
        </header>

        <section className="grid min-h-[calc(100vh-17rem)] grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)] lg:gap-6">
          <aside className="flex flex-col gap-4">
            <IncidentPanel
              serviceName={incidentPanelData.serviceName}
              errorRate={incidentPanelData.errorRate}
              region={incidentPanelData.region}
              time={incidentPanelData.time}
            />

            <section className="rounded-lg border border-violet-500/35 bg-zinc-950/80 p-4 shadow-[0_0_0_1px_rgba(168,85,247,0.08)]">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">
                Knowledge Scope
              </h2>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Assistant replies are scoped to these incident-response runbook
                themes.
              </p>
              <ul className="mt-3 space-y-2">
                {knowledgeScope.map((scope) => (
                  <li
                    key={scope}
                    className="rounded border border-violet-500/30 bg-violet-500/10 px-2.5 py-2 text-xs text-violet-100"
                  >
                    {scope}
                  </li>
                ))}
              </ul>
            </section>
          </aside>

          <section className="flex min-h-[560px] flex-col rounded-xl border border-cyan-500/35 bg-zinc-950/80 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.1)] lg:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-cyan-500/20 pb-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                  Incident War Room
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Ask for logs and metrics, test hypotheses, then submit your
                  diagnosis.
                </p>
              </div>
              <span className="rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.15em] text-fuchsia-100">
                Live Simulation
              </span>
            </div>

            <ChatInterface onIncidentLoaded={setIncidentPanelData} />
          </section>
        </section>
      </section>
    </main>
  );
}
