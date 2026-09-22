"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface Series {
  key: string;
  label: string;
  color: string;
  type?: "line" | "area" | "bar";
  axis?: "left" | "right";
  unit?: string;
  digits?: number;
}

const IST = "Asia/Kolkata";

function fmtX(v: number | string, mode: "hour" | "day" | "raw") {
  if (mode === "raw") return String(v);
  const d = new Date(v);
  if (mode === "day") return d.toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short" });
  return d.toLocaleString("en-IN", { timeZone: IST, day: "2-digit", hour: "2-digit", hour12: false });
}

function fmtNum(v: unknown, digits = 0) {
  return typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: digits }) : String(v ?? "");
}

export function TrendChart({
  data,
  x = "ts",
  series,
  height = 240,
  xMode = "hour",
  reference,
  leftDomain,
}: {
  data: Record<string, unknown>[];
  x?: string;
  series: Series[];
  height?: number;
  xMode?: "hour" | "day" | "raw";
  reference?: { y: number; label: string; axis?: "left" | "right" };
  leftDomain?: [number | "auto", number | "auto"];
}) {
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 4 : 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line-2)" vertical={false} />
          <XAxis dataKey={x} tickFormatter={(v) => fmtX(v, xMode)} tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={28} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => fmtNum(v, 3)} domain={leftDomain ?? ["auto", "auto"]} />
          {hasRight && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => fmtNum(v, 3)} />}
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
            labelFormatter={(v) => fmtX(v as number, xMode === "hour" ? "hour" : xMode)}
            formatter={(value, name) => {
              const s = series.find((q) => q.label === name);
              return [`${fmtNum(value, s?.digits ?? 2)}${s?.unit ? ` ${s.unit}` : ""}`, name];
            }}
          />
          {reference && <ReferenceLine yAxisId={reference.axis ?? "left"} y={reference.y} stroke="var(--ink-3)" strokeDasharray="4 4" label={{ value: reference.label, position: "insideTopRight", fontSize: 11, fill: "var(--ink-2)" }} />}
          {series.map((s) => {
            const common = { dataKey: s.key, name: s.label, yAxisId: s.axis ?? "left", isAnimationActive: false } as const;
            if (s.type === "bar") return <Bar key={s.key} {...common} fill={s.color} radius={[2, 2, 0, 0]} maxBarSize={18} />;
            if (s.type === "area") return <Area key={s.key} {...common} type="monotone" stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={1.5} dot={false} connectNulls={false} />;
            return <Line key={s.key} {...common} type="monotone" stroke={s.color} strokeWidth={1.75} dot={false} connectNulls={false} />;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, color = "var(--flow)", height = 28, width = 110, threshold }: { values: (number | null)[]; color?: string; height?: number; width?: number; threshold?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div style={{ height, width }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          {threshold !== undefined && <ReferenceLine y={threshold} stroke="var(--crit)" strokeDasharray="2 2" />}
          <Line dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
