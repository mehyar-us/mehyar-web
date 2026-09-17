import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BrandStatus, HealthLevel } from "../lib/types";

/** Format a dollar amount, e.g. 1234.5 -> "$1,234.50". */
export function fmt$(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function fmtNum(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString("en-US");
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center py-16", className)}>
      <Loader2 className="h-8 w-8 animate-spin text-zinc-500" aria-label="Loading" />
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </Card>
  );
}

const HEALTH_META: Record<HealthLevel, { label: string; className: string }> = {
  ok: { label: "Healthy", className: "border-emerald-800 bg-emerald-950 text-emerald-300" },
  warn: { label: "Watch", className: "border-amber-800 bg-amber-950 text-amber-300" },
  paused: { label: "Paused", className: "border-red-800 bg-red-950 text-red-300" },
  unknown: { label: "No data", className: "border-zinc-700 bg-zinc-900 text-zinc-400" },
};

export function HealthBadge({ health }: { health: HealthLevel }) {
  const meta = HEALTH_META[health];
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}

const STATUS_DOT: Record<BrandStatus, string> = {
  live: "bg-emerald-500",
  building: "bg-amber-500",
  parked: "bg-zinc-500",
};

const STATUS_LABEL: Record<BrandStatus, string> = {
  live: "Live",
  building: "Building",
  parked: "Parked",
};

export function StatusDot({ status, showLabel = false }: { status: BrandStatus; showLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} aria-hidden="true" />
      {showLabel && <span className="text-xs text-zinc-400">{STATUS_LABEL[status]}</span>}
    </span>
  );
}

export function EmptyState({ title, desc }: { title: string; desc?: string }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900 p-8 text-center">
      <div className="text-sm font-medium text-zinc-300">{title}</div>
      {desc && <div className="mx-auto mt-2 max-w-md text-xs text-zinc-500">{desc}</div>}
    </Card>
  );
}

/** Graceful failure card used when an endpoint is not wired yet or errors. */
export function WiringError({ error }: { error: string }) {
  return <EmptyState title="Not wired yet" desc={error} />;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{children}</h2>
  );
}

export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-zinc-800", className)}>
      <div
        className="h-full rounded-full bg-emerald-500 transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Small monospace-ish table wrapper for dense admin tables. */
export function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-2 font-medium", className)}>{children}</th>;
}

export function Td({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td title={title} className={cn("border-t border-zinc-800/60 px-3 py-2 text-zinc-300", className)}>
      {children}
    </td>
  );
}
