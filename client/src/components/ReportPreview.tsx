/**
 * ReportPreview — a CSS mock of the paid report cover, used as a purchase
 * motivator. It is deliberately an ILLUSTRATION: generic blurred skeleton
 * lines, no real scores, no fabricated data. Never render actual report
 * values through this component.
 */
export default function ReportPreview({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(11,27,51,0.25)] ${className}`}
    >
      {/* navy cover band */}
      <div className="relative bg-[#0B1B33] px-5 pb-8 pt-6 text-white">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300">MehyarSoft</p>
        <p className="mt-1 text-lg font-bold leading-tight">AI Website Evaluation</p>
        <p className="mt-1 text-[10px] text-slate-300">yourbusiness.com</p>
        {/* mini gauge (decorative — no real score) */}
        <div className="absolute -bottom-7 right-5 h-16 w-16 rounded-full bg-white p-1 shadow-lg">
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" stroke="#E2E8F0" strokeWidth="8" />
            <circle
              cx="32" cy="32" r="26" fill="none" stroke="#F59E0B" strokeWidth="8"
              strokeLinecap="round" strokeDasharray={`${26 * 2 * Math.PI * 0.72} ${26 * 2 * Math.PI}`}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="h-5 w-8 rounded bg-slate-200 blur-[2px]" />
          </div>
        </div>
        {/* PREVIEW ribbon */}
        <div className="absolute left-0 top-4 -translate-x-1 rounded-r-md bg-[#F59E0B] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#0B1B33] shadow">
          Preview
        </div>
      </div>

      {/* blurred document body */}
      <div className="space-y-3 px-5 pb-6 pt-10">
        <div className="h-3 w-2/3 rounded bg-slate-200 blur-[1.5px]" />
        <div className="h-2 w-full rounded bg-slate-100 blur-[1.5px]" />
        <div className="h-2 w-full rounded bg-slate-100 blur-[1.5px]" />
        <div className="h-2 w-5/6 rounded bg-slate-100 blur-[1.5px]" />
        <div className="mt-4 flex gap-2">
          <div className="h-14 flex-1 rounded-lg border border-red-200 bg-red-50 blur-[1px]" />
          <div className="h-14 flex-1 rounded-lg border border-emerald-200 bg-emerald-50 blur-[1px]" />
        </div>
        <div className="h-2 w-full rounded bg-slate-100 blur-[1.5px]" />
        <div className="h-2 w-4/6 rounded bg-slate-100 blur-[1.5px]" />
        <div className="mt-4 rounded-lg bg-[#0B1B33]/5 p-3 blur-[1px]">
          <div className="h-2 w-1/2 rounded bg-slate-200" />
          <div className="mt-2 h-2 w-3/4 rounded bg-slate-200" />
        </div>
      </div>

      {/* gold price badge */}
      <div className="absolute bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F59E0B] text-lg font-extrabold text-[#0B1B33] shadow-lg ring-4 ring-white">
        $5
      </div>

      <p className="border-t border-slate-100 px-5 py-2.5 text-center text-[10px] uppercase tracking-widest text-slate-400">
        Sample illustration — your report is built for your site
      </p>
    </div>
  );
}
