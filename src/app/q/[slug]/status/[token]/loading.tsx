export default function TicketLoading() {
  return (
    <div className="min-h-[100dvh] bg-[#0A0E17] p-4 flex flex-col items-center gap-4 animate-pulse">
      <div className="w-full max-w-md h-16 bg-white/5 rounded-2xl" />
      <div className="w-full max-w-md h-80 bg-[#111827] rounded-[32px] border border-white/5" />
      <div className="w-full max-w-md h-24 bg-[#111827] rounded-2xl border border-white/5" />
    </div>
  );
}
