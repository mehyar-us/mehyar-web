import { ArrowRight, FileSearch } from "lucide-react";
import offer from "@shared/mayor-automatic-audit.json";

// Activation is a reviewed source change after report acceptance and route verification.
// The preview prop is used only by the local review script; it never enables a link.
export default function MayorAutomaticAudit({ compact = false, preview = false }: { compact?: boolean; preview?: boolean }) {
  if (offer.publication !== "published" && !preview) return null;
  const canOpen = offer.publication === "published" && !preview;
  return <section className="mt-8 rounded-[24px] border border-border bg-background p-5 md:p-7" aria-labelledby="mayor-automatic-audit-heading" id="mayor-automatic-audit">
    {preview && <p className="mb-5 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-medium">Local draft preview · unavailable for purchase</p>}
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-2xl">
        <p className="site-eyebrow flex items-center gap-2"><FileSearch size={16} aria-hidden="true"/>{offer.name}</p>
        <h3 id="mayor-automatic-audit-heading" className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">{offer.headline}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">{offer.summary}</p>
      </div>
      <p className="shrink-0 rounded-2xl bg-secondary px-5 py-4 sm:text-right"><strong className="block text-3xl font-semibold tracking-tight">${offer.priceUsd}</strong><span className="mt-1 block text-xs text-muted-foreground">USD · one-time report</span></p>
    </div>
    {!compact && <ul className="mt-5 flex flex-wrap gap-2" aria-label="Report topics">{offer.scope.map(item => <li key={item.name} className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium">{item.name}</li>)}</ul>}
    {!compact && <ol className="mt-6 grid gap-3 border-t border-border pt-5 md:grid-cols-3" aria-label="Your proposed roadmap">
      {offer.roadmap.map(item => <li key={item.period} className="rounded-xl bg-secondary/50 p-4"><strong className="text-sm font-semibold">{item.period}</strong><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.detail}</p></li>)}
    </ol>}
    <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{offer.delivery}</p>
    <div className="mt-5 flex flex-col items-start gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{offer.separateOffers}</p>
      {canOpen ? <a className="mayor-primary !mt-0 w-full shrink-0 sm:w-auto" href={offer.href} target="_blank" rel="noopener noreferrer">{offer.cta}<ArrowRight size={17} aria-hidden="true"/></a> : <button className="min-h-[44px] w-full shrink-0 rounded-full bg-secondary px-5 py-3 text-sm font-medium text-muted-foreground sm:w-auto" type="button" disabled>Unavailable · draft preview</button>}
    </div>
    <details className="mt-4 text-xs leading-relaxed text-muted-foreground"><summary className="min-h-[44px] cursor-pointer py-3 font-medium text-foreground">Research scope and limits</summary>
      <dl className="mb-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{offer.scope.map(item => <div key={item.name}><dt className="text-sm font-semibold text-foreground">{item.name}</dt><dd className="mt-1 text-sm leading-relaxed">{item.detail}</dd></div>)}</dl>
      <p className="pb-2">{offer.boundaries}</p>
    </details>
  </section>;
}

export function MayorAutomaticAuditTerms({ preview = false }: { preview?: boolean }) {
  if (offer.publication !== "published" && !preview) return null;
  return <p className="mt-3"><strong>{offer.name}</strong> is a separate one-time ${offer.priceUsd} USD report based on public static website research and owner-supplied goals. It provides cited offer, journey, trust, conversion, operations and measurement findings, with a proposed 30/60/90-day roadmap. {offer.delivery} {offer.boundaries} {offer.separateOffers}</p>;
}
