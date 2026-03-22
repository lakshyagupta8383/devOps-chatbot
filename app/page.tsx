import IncidentPanel from "./components/IncidentPanel";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#060909] p-4 text-zinc-100 md:p-6">
      <section className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-7xl grid-cols-1 gap-4 rounded-xl border border-emerald-500/30 bg-black/50 p-4 shadow-[0_0_0_1px_rgba(16,185,129,0.1)] lg:min-h-[calc(100vh-3rem)] lg:grid-cols-2 lg:gap-6 lg:p-6">
        <IncidentPanel
          serviceName="payment-api"
          errorRate="78%"
          region="ap-south-1"
          time="02:14 AM"
        />

        <section className="flex min-h-[280px] flex-col rounded-lg border border-emerald-500/25 bg-zinc-950/80 p-5 font-mono lg:min-h-0 lg:p-6">
          <div className="mb-4 border-b border-zinc-800 pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">
              Chat Interface
            </h2>
          </div>

          <div className="flex-1 rounded-md border border-dashed border-zinc-700 bg-[#070b0a]" />
        </section>
      </section>
    </main>
  );
}
