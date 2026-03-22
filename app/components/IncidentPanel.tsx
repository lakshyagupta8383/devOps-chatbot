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
      className={`rounded-lg border border-red-500/35 bg-zinc-950/85 p-5 font-mono shadow-[0_0_24px_rgba(239,68,68,0.14)] lg:p-6 ${className}`.trim()}
    >
      <div className="mb-5 flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.85)]"
          />
          <h1 className="text-sm font-semibold uppercase tracking-[0.22em] text-red-300">
            [{label}]
          </h1>
        </div>
        <span className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          Critical
        </span>
      </div>

      <div className="space-y-3 text-sm">
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-zinc-200">
          <span className="text-zinc-400">Service:</span> {serviceName}
        </p>
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-zinc-200">
          <span className="text-zinc-400">Error Rate:</span> {errorRate}
        </p>
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-zinc-200">
          <span className="text-zinc-400">Region:</span> {region}
        </p>
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-zinc-200">
          <span className="text-zinc-400">Time:</span> {time}
        </p>
      </div>
    </aside>
  );
}
