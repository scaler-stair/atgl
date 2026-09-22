"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export interface ScopeOption {
  id: string;
  name: string;
  zoneId?: string;
}

const WINDOWS = [
  { key: "24h", label: "24 h" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export function ScopeBar({ zones, sites, scopedPaths }: { zones: ScopeOption[]; sites: ScopeOption[]; scopedPaths: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const applies = scopedPaths.some((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p)));
  if (!applies) return null;

  const zone = sp.get("zone") ?? "";
  const site = sp.get("site") ?? "";
  const win = sp.get("window") ?? "7d";

  function set(patch: Record<string, string>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.push(`${pathname}?${next.toString()}`));
  }

  const siteOptions = sites.filter((s) => !zone || s.zoneId === zone);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label className="sr-only" htmlFor="scope-zone">
        Zone
      </label>
      <select id="scope-zone" className="field w-auto py-1.5 text-[13px]" value={zone} onChange={(e) => set({ zone: e.target.value, site: "" })}>
        <option value="">All zones</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="scope-site">
        Site
      </label>
      <select id="scope-site" className="field w-auto max-w-56 py-1.5 text-[13px]" value={site} onChange={(e) => set({ site: e.target.value })}>
        <option value="">All sites</option>
        {siteOptions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <div role="radiogroup" aria-label="Time window" className="flex overflow-hidden rounded-md border border-line bg-surface">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            role="radio"
            aria-checked={win === w.key}
            onClick={() => set({ window: w.key === "7d" ? "" : w.key })}
            className={`px-3 py-1.5 text-[13px] font-semibold ${win === w.key ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {w.label}
          </button>
        ))}
      </div>
      {pending && <span className="text-[12px] text-ink-3">Updating…</span>}
    </div>
  );
}
