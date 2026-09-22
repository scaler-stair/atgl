import type { ReactNode } from "react";

/** Ranked horizontal bars (server-rendered, no chart library needed). */
export function RankBars({
  rows,
  max,
  format,
  reference,
}: {
  rows: { key: string; label: ReactNode; value: number; tone?: "flow" | "warn" | "crit" | "neutral"; note?: ReactNode }[];
  max?: number;
  format: (v: number) => string;
  reference?: { value: number; label: string };
}) {
  const top = max ?? Math.max(...rows.map((r) => r.value), reference?.value ?? 0) * 1.05;
  const color = { flow: "var(--flow)", warn: "var(--warn)", crit: "var(--crit)", neutral: "var(--ink-3)" };
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 text-[13px]">
          <span className="truncate text-ink">{r.label}</span>
          <span className="tabular font-semibold text-ink">{format(r.value)}</span>
          <div className="relative col-span-2 mt-1 h-2 rounded-sm bg-line-2">
            <div className="h-full rounded-sm" style={{ width: `${Math.max(1, (r.value / top) * 100)}%`, background: color[r.tone ?? "flow"] }} />
            {reference && <div className="absolute -top-1 -bottom-1 w-px bg-ink" style={{ left: `${(reference.value / top) * 100}%` }} title={reference.label} />}
          </div>
          {r.note && <span className="col-span-2 mt-0.5 text-[12px] text-ink-3">{r.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar showing composition (e.g. UAG attribution). */
export function StackBar({ parts, format }: { parts: { key: string; label: string; value: number; color: string }[]; format: (v: number) => string }) {
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-sm" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
        {parts.map((p) => (
          <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${format(p.value)}`} />
        ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="tabular text-ink">
              {format(p.value)} <span className="text-ink-3">({Math.round((p.value / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
