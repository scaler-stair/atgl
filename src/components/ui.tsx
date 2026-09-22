import type { ReactNode } from "react";
import type { Evidence, QualityState } from "@/lib/domain/types";
import { ago, dateTime } from "@/lib/format";

export type Tone = "neutral" | "ok" | "warn" | "crit" | "info" | "flow" | "brand";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  crit: "bg-crit-soft text-crit border-transparent",
  info: "bg-info-soft text-info border-transparent",
  flow: "bg-flow-soft text-flow border-transparent",
  brand: "bg-brand-soft text-brand border-transparent",
};

export function Tag({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[12px] font-semibold leading-5 whitespace-nowrap ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export const severityTone: Record<string, Tone> = { critical: "crit", high: "crit", medium: "warn", low: "info" };

export function SeverityTag({ severity }: { severity: string }) {
  return <Tag tone={severityTone[severity] ?? "neutral"}>{severity === "critical" ? "Critical" : severity[0].toUpperCase() + severity.slice(1)}</Tag>;
}

const qualityTone: Record<QualityState, Tone> = { good: "ok", degraded: "warn", stale: "crit", missing: "crit" };
const qualityText: Record<QualityState, string> = { good: "Good data", degraded: "Degraded", stale: "Stale", missing: "No data" };

export function QualityPip({ quality }: { quality: QualityState }) {
  const color = { good: "var(--ok)", degraded: "var(--warn)", stale: "var(--crit)", missing: "var(--crit)" }[quality];
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color }}>
      <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
      {qualityText[quality]}
    </span>
  );
}

export function QualityTag({ quality }: { quality: QualityState }) {
  return <Tag tone={qualityTone[quality]}>{qualityText[quality]}</Tag>;
}

/**
 * The evidence strip: every figure's calibration label. Shows quality,
 * window, sources, freshness and calculation version (Section 8).
 */
export function EvidenceStrip({ evidence, className = "" }: { evidence: Evidence; className?: string }) {
  const sep = <span aria-hidden className="h-3 w-px bg-line" />;
  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] leading-4 text-ink-3 ${className}`}>
      <QualityPip quality={evidence.quality} />
      {sep}
      <span>{evidence.window.label}</span>
      {sep}
      <span>{evidence.scopeLabel}</span>
      {sep}
      <span title="Source systems">{evidence.sources.join(" + ")}</span>
      {sep}
      <span title={`As of ${dateTime(evidence.asOf)} IST`}>as of {dateTime(evidence.asOf)} ({ago(evidence.asOf)})</span>
      {sep}
      <span title="Calculation / model version">{evidence.version}</span>
      {evidence.notes && evidence.notes.length > 0 && (
        <details className="basis-full">
          <summary className="cursor-pointer select-none text-ink-2">{evidence.notes.length} data note{evidence.notes.length > 1 ? "s" : ""}</summary>
          <ul className="mt-1 list-disc pl-4 text-ink-2">
            {evidence.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  evidence,
  children,
  className = "",
  bodyClass = "p-4",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  evidence?: Evidence;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`flex min-w-0 flex-col rounded-lg border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-2 px-4 pt-3 pb-2.5">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[17px] font-semibold leading-6 text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${bodyClass}`}>{children}</div>
      {evidence && (
        <footer className="border-t border-line-2 bg-surface-2/60 px-4 py-2 rounded-b-lg">
          <EvidenceStrip evidence={evidence} />
        </footer>
      )}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
  indicative,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: Tone;
  indicative?: boolean;
}) {
  const color = tone ? { neutral: "var(--ink)", ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", info: "var(--info)", flow: "var(--flow)", brand: "var(--brand)" }[tone] : "var(--ink)";
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-display tabular text-[32px] font-semibold leading-9 tracking-tight" style={{ color }}>
          {value}
        </span>
        {unit && <span className="text-[13px] font-medium text-ink-3">{unit}</span>}
        {indicative && (
          <span className="ml-1 self-center">
            <Tag tone="warn" title="Indicative until validated in the ATGL study and approved business case">
              Indicative
            </Tag>
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-[12.5px] text-ink-2">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="font-display text-[28px] font-semibold leading-8 tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-[14px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-[13px] text-ink-2">{children}</div>}
    </div>
  );
}

export function TableWrap({ children, maxHeight }: { children: ReactNode; maxHeight?: number }) {
  return (
    <div className="-mx-4 -my-4 overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      {children}
    </div>
  );
}

/** Horizontal meter bar, e.g. health score or cascade fill. */
export function Meter({ value, max = 100, tone = "flow", label }: { value: number; max?: number; tone?: Tone; label?: string }) {
  const color = { neutral: "var(--ink-3)", ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", info: "var(--info)", flow: "var(--flow)", brand: "var(--brand)" }[tone];
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <div className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-line-2">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`rounded-md border px-3 py-2.5 text-[13px] ${toneClass[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-0.5 font-normal text-ink-2" : "font-normal"}>{children}</div>
    </div>
  );
}
