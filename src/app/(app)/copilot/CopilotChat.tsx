"use client";

import { SendHorizontal } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { EvidenceStrip, Tag } from "@/components/ui";
import type { Evidence } from "@/lib/domain/types";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  evidence: Evidence | null;
  ok: boolean;
  error?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
  model?: string;
  promptVersion?: string;
  grounded?: boolean;
  refused?: boolean;
  latencyMs?: number;
  correlationId?: string;
  error?: boolean;
}

const SUGGESTIONS = [
  "Where is UAG highest this week and what is driving it?",
  "Which CNG stations use the most energy per kg against benchmark?",
  "Which compressors need attention and how confident is the model?",
  "Summarise open billing exceptions and the amount at stake.",
  "What are the top five opportunities by value, and which are validated?",
  "Are any data feeds stale right now?",
];

const TOOL_LABEL: Record<string, string> = {
  list_sites: "Site register",
  get_overview: "Network overview",
  get_energy: "Energy intelligence",
  get_gas_balance: "Gas balance and UAG",
  get_metering: "Meter health",
  get_asset_health: "Asset reliability",
  get_billing_exceptions: "Billing reconciliation",
  get_vendor_performance: "Vendor and AMC",
  get_safety: "Safety and integrity",
  get_opportunities: "Opportunity register",
  get_alerts: "Alert queue",
  get_data_quality: "Data quality",
};

/** Minimal, safe markdown: paragraphs, nested "-"/"*" bullets, **bold**, _italic_, `code`. No HTML injection. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<!\w)_[^_]+_(?!\w))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={i++} className="rounded bg-surface-2 px-1 py-px text-[0.92em] text-ink">{tok.slice(1, -1)}</code>);
    else out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="prose-answer text-[14px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => {
                const depth = Math.min(3, Math.floor((l.match(/^\s*/)?.[0].length ?? 0) / 2));
                return (
                  <li key={j} style={depth ? { marginLeft: depth * 16, listStyleType: "circle" } : undefined}>
                    {inline(l.replace(/^\s*[-*•]\s+/, ""))}
                  </li>
                );
              })}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ""))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function CopilotChat({ userName, scopeLabel, filter, engine, promptVersion }: { userName: string; scopeLabel: string; filter: { zone?: string; site?: string }; engine: string; promptVersion: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, history, ...filter }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setMessages((m) => [...m, { role: "assistant", text: data.answer, toolCalls: data.toolCalls, model: data.model, promptVersion: data.promptVersion, grounded: data.grounded, refused: data.refused, latencyMs: data.latencyMs, correlationId: data.correlationId }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `The copilot could not answer: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex min-h-[560px] flex-col rounded-lg border border-line bg-surface" aria-label="Conversation">
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
          {messages.length === 0 && (
            <div className="max-w-2xl">
              <p className="font-display text-[22px] font-semibold text-ink">Good to see you, {userName}.</p>
              <p className="mt-1 text-[14px] text-ink-2">
                Questions run against <strong className="text-ink">{scopeLabel}</strong>, limited to the sites your role can see. Try one of these:
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-md border border-line bg-surface-2 px-3 py-2 text-left text-[13px] text-ink hover:border-flow hover:text-flow">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[80%] rounded-lg bg-ink px-3.5 py-2 text-[14px] text-surface">{m.text}</p>
              </div>
            ) : (
              <article key={i} className="max-w-3xl">
                {m.error ? (
                  <p role="alert" className="rounded-md bg-crit-soft px-3 py-2 text-[13.5px] text-crit">
                    {m.text}
                  </p>
                ) : (
                  <>
                    <Markdown text={m.text} />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
                      {m.refused ? <Tag tone="warn">Outside read-only scope</Tag> : m.grounded ? <Tag tone="ok">Grounded in platform data</Tag> : <Tag tone="crit">Not grounded</Tag>}
                      <span>{m.model}</span>
                      <span aria-hidden className="h-3 w-px bg-line" />
                      <span>{m.promptVersion}</span>
                      <span aria-hidden className="h-3 w-px bg-line" />
                      <span>{((m.latencyMs ?? 0) / 1000).toFixed(1)} s</span>
                      <span aria-hidden className="h-3 w-px bg-line" />
                      <span title="Correlation ID for audit and support">ref {m.correlationId?.slice(0, 8)}</span>
                    </div>
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <details className="mt-2 rounded-md border border-line-2 bg-surface-2/60 px-3 py-2">
                        <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-2">
                          Data used: {m.toolCalls.length} lookup{m.toolCalls.length > 1 ? "s" : ""}
                        </summary>
                        <ul className="mt-2 space-y-2.5">
                          {m.toolCalls.map((t, j) => (
                            <li key={j} className="text-[12.5px]">
                              <p className="font-semibold text-ink">
                                {TOOL_LABEL[t.name] ?? t.name}
                                {Object.keys(t.args).length > 0 && (
                                  <span className="ml-1.5 font-normal text-ink-3">
                                    {Object.entries(t.args)
                                      .map(([k, v]) => `${k} ${String(v)}`)
                                      .join(", ")}
                                  </span>
                                )}
                                {!t.ok && <span className="ml-1.5 text-crit">failed: {t.error}</span>}
                              </p>
                              {t.evidence && <EvidenceStrip evidence={t.evidence} className="mt-1" />}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </article>
            ),
          )}
          {busy && <p className="text-[13px] text-ink-3">Looking up the data…</p>}
          <div ref={endRef} />
        </div>
        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <label htmlFor="copilot-input" className="sr-only">
            Ask the copilot
          </label>
          <textarea
            id="copilot-input"
            className="field min-h-[44px] resize-y"
            rows={1}
            maxLength={2000}
            placeholder="Ask about energy, UAG, meters, assets, billing, vendors, safety or opportunities"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
          />
          <button type="submit" className="btn btn-primary h-[44px]" disabled={busy || input.trim().length < 2}>
            <SendHorizontal size={16} aria-hidden /> Ask
          </button>
        </form>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-line bg-surface p-4 text-[13px]">
          <h2 className="font-display text-[16px] font-semibold text-ink">How answers are produced</h2>
          <ul className="mt-2 space-y-1.5 text-ink-2">
            <li>Every figure comes from a lookup against the same read-only analytics the dashboards use.</li>
            <li>Each answer lists its time window, scope, sources, data quality and calculation version.</li>
            <li>Rupee values stay indicative until validated.</li>
            <li>Requests to operate equipment are refused: the platform never writes to SCADA or station controls.</li>
          </ul>
        </section>
        <section className="rounded-lg border border-line bg-surface p-4 text-[13px]">
          <h2 className="font-display text-[16px] font-semibold text-ink">Engine</h2>
          <p className="mt-1 text-ink-2">{engine}</p>
          <p className="text-ink-3">Prompt {promptVersion}</p>
          <p className="mt-2 text-ink-3">Questions and answers are logged with a reference number for audit.</p>
        </section>
      </aside>
    </div>
  );
}
