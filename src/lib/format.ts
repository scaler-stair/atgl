/** Display formatting (client-safe). Indian numbering and IST throughout. */

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
  return v.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** Compact large quantities: 12.4 lakh, 3.2 crore. */
export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e7) return `${num(v / 1e7, 2)} cr`;
  if (a >= 1e5) return `${num(v / 1e5, 2)} lakh`;
  return num(v);
}

export function inr(v: number | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${num(v / 1e7, 2)} cr`;
  if (a >= 1e5) return `₹${num(v / 1e5, 2)} lakh`;
  return `₹${num(v)}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "n/a";
  return `${num(v, digits)}%`;
}

export function signed(v: number | null | undefined, digits = 1, unit = "%"): string {
  if (v === null || v === undefined) return "n/a";
  return `${v > 0 ? "+" : ""}${num(v, digits)}${unit}`;
}

const IST = "Asia/Kolkata";

export function dateTime(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  return new Date(v).toLocaleString("en-IN", { timeZone: IST, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function date(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  return new Date(v).toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
}

export function hourLabel(ts: number): string {
  return new Date(ts).toLocaleString("en-IN", { timeZone: IST, day: "2-digit", month: "short", hour: "2-digit", hour12: false });
}

export function ago(v: number | string | null | undefined, now = Date.now()): string {
  if (v === null || v === undefined) return "never";
  const ms = now - new Date(v).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function titleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
