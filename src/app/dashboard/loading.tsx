export default function DashboardLoading() {
  return (
    <div className="flex w-full flex-col gap-5 bg-[#0A0E17] px-4 py-4 sm:gap-6 sm:px-6 sm:py-6" aria-label="Loading dashboard" role="status">
      <div className="space-y-2">
        <div className="h-3 w-28 animate-pulse rounded-full bg-white/10" />
        <div className="h-8 w-56 animate-pulse rounded-xl bg-white/10" />
        <div className="h-6 w-48 animate-pulse rounded-full bg-white/5" />
      </div>
      <div className="animate-pulse rounded-3xl border border-white/5 bg-[#111827] p-5 sm:p-6">
        <div className="h-4 w-40 rounded-full bg-white/10" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-black/30" />
          ))}
        </div>
        <div className="mt-4 h-2 rounded-full bg-white/10" />
      </div>
      <div className="h-48 animate-pulse rounded-3xl border border-white/5 bg-[#111827]" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="h-44 animate-pulse rounded-3xl border border-white/5 bg-[#111827]" />
        <div className="h-44 animate-pulse rounded-3xl border border-white/5 bg-[#111827]" />
      </div>
      <span className="sr-only">Loading live operations…</span>
    </div>
  );
}
