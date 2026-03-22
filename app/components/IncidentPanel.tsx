type IncidentPanelProps = {
  serviceName: string;
  errorRate: string;
  region: string;
  time: string;
  label?: string;
  className?: string;
};

export default function IncidentPanel({
  serviceName,
  errorRate,
  region,
  time,
  label = "ALERT",
  className = "",
}: IncidentPanelProps) {
  return (
    <aside
      className={`rounded-lg border border-rose-500/45 bg-zinc-950/85 p-5 font-mono shadow-[0_0_24px_rgba(244,63,94,0.2)] lg:p-6 ${className}`.trim()}
    >
      <div className="mb-5 flex items-center justify-between border-b border-rose-500/25 pb-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.9)]"
          />
          <h1 className="text-sm font-semibold uppercase tracking-[0.22em] text-rose-200">
            [{label}]
          </h1>
        </div>
        <span className="rounded border border-orange-500/45 bg-orange-500/15 px-2 py-1 text-[11px] text-orange-100">
          Critical
        </span>
      </div>

      <div className="space-y-3 text-sm">
        <p className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-rose-50">
          <span className="text-rose-200/70">Service:</span> {serviceName}
        </p>
        <p className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-rose-50">
          <span className="text-rose-200/70">Error Rate:</span> {errorRate}
        </p>
        <p className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-rose-50">
          <span className="text-rose-200/70">Region:</span> {region}
        </p>
        <p className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-rose-50">
          <span className="text-rose-200/70">Time:</span> {time}
        </p>
      </div>
    </aside>
  );
}
