"use client";

import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  Cog,
  FileText,
  Flame,
  Gauge,
  GaugeCircle,
  Handshake,
  Menu,
  Plug,
  Receipt,
  ScrollText,
  Server,
  Shield,
  Sparkles,
  Target,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { NavItem } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  zap: Zap,
  flame: Flame,
  "gauge-circle": GaugeCircle,
  cog: Cog,
  receipt: Receipt,
  handshake: Handshake,
  shield: Shield,
  target: Target,
  bell: Bell,
  sparkles: Sparkles,
  "file-text": FileText,
  activity: Activity,
  bot: Bot,
  users: Users,
  plug: Plug,
  scroll: ScrollText,
  server: Server,
  book: BookOpen,
};

export function Sidebar({ groups, openAlerts, tenantName }: { groups: { group: string; items: NavItem[] }[]; openAlerts: number; tenantName: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const carry = new URLSearchParams();
  for (const k of ["zone", "site", "window"]) {
    const v = sp.get(k);
    if (v) carry.set(k, v);
  }
  const qs = carry.toString();

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 pb-6">
      {groups.map((g) => (
        <div key={g.group}>
          <p className="px-2 pb-1 text-[12px] font-semibold text-ink-3">{g.group}</p>
          <ul className="space-y-px">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Gauge;
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.scoped && qs ? `${item.href}?${qs}` : item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] ${active ? "bg-brand-soft font-semibold text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                  >
                    <Icon size={16} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {item.module === "alerts" && openAlerts > 0 && (
                      <span className="tabular rounded bg-crit px-1.5 text-[11px] font-bold leading-[18px] text-white">{openAlerts}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand font-display text-[15px] font-bold text-brand-ink" aria-hidden>
        A
      </div>
      <div className="leading-tight">
        <p className="font-display text-[15px] font-semibold text-ink">{tenantName}</p>
        <p className="text-[12px] text-ink-3">Energy and gas intelligence</p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface lg:flex">
        {brand}
        {nav}
      </aside>
      <div className="no-print flex items-center gap-2 border-b border-line bg-surface px-2 py-1.5 lg:hidden">
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(true)} aria-label="Open navigation">
          <Menu size={18} />
        </button>
        <span className="font-display text-[15px] font-semibold text-ink">{tenantName}</span>
        {open && (
          <div className="fixed inset-0 z-50 flex">
            <div className="flex h-full w-72 flex-col overflow-y-auto bg-surface shadow-xl">
              <div className="flex items-center justify-between pr-3">
                {brand}
                <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} aria-label="Close navigation">
                  <X size={18} />
                </button>
              </div>
              {nav}
            </div>
            <button type="button" aria-label="Close navigation" className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
          </div>
        )}
      </div>
    </>
  );
}
