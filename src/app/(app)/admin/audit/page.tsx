import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Panel, PageHeader, Tag, type Tone } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { listAudit } from "@/lib/server/audit";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Audit log" };

const outcomeTone: Record<string, Tone> = { success: "ok", denied: "crit", failure: "warn" };
const outcomeText: Record<string, string> = { success: "Success", denied: "Denied", failure: "Failure" };

function pretty(json: string | null): string | null {
  if (!json) return null;
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { params } = await pageContext("admin-audit", searchParams);
  const action = params.action?.trim().slice(0, 64) || undefined;
  const actor = params.actor?.trim().slice(0, 64) || undefined;
  const limit = 300;
  const rows = await listAudit({ limit, action, actor });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, denial and privileged action with actor, target, before and after values and a correlation ID. Append-only; this page cannot change it."
      />

      <Panel
        title="Entries"
        description={`${rows.length === limit ? `Latest ${limit}` : rows.length} entr${rows.length === 1 ? "y" : "ies"}${action || actor ? " matching the filter" : ""}, newest first`}
        bodyClass="p-0"
      >
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line-2 px-4 py-3" role="search">
          <div className="w-full sm:w-56">
            <label htmlFor="f-action" className="mb-1 block text-[13px] font-semibold text-ink">Action starts with</label>
            <input id="f-action" name="action" className="field" defaultValue={action ?? ""} placeholder="e.g. user. or auth.login" />
          </div>
          <div className="w-full sm:w-56">
            <label htmlFor="f-actor" className="mb-1 block text-[13px] font-semibold text-ink">Actor</label>
            <input id="f-actor" name="actor" className="field" defaultValue={actor ?? ""} placeholder="Name or user ID" />
          </div>
          <button type="submit" className="btn btn-primary">Filter log</button>
          {(action || actor) && (
            <Link href="/admin/audit" className="btn btn-quiet">Clear filter</Link>
          )}
        </form>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No matching entries">Try a shorter action prefix or clear the filter.</EmptyState>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Time (IST)</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Correlation ID</th>
                  <th scope="col">IP</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const before = pretty(r.before_json);
                  const after = pretty(r.after_json);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{dateTime(r.ts)}</td>
                      <td className="whitespace-nowrap text-[13px]">{r.actor_name ?? r.actor_id ?? <span className="text-ink-3">Anonymous</span>}</td>
                      <td>
                        <code className="text-[12.5px]">{r.action}</code>
                      </td>
                      <td className="text-[13px]">
                        {r.target_type ?? ""}
                        {r.target_id && <span className="block max-w-48 truncate text-[12px] text-ink-3" title={r.target_id}>{r.target_id}</span>}
                      </td>
                      <td>
                        <Tag tone={outcomeTone[r.outcome] ?? "neutral"}>{outcomeText[r.outcome] ?? r.outcome}</Tag>
                      </td>
                      <td>
                        <code className="text-[12px] text-ink-3" title={r.correlation_id}>{r.correlation_id.slice(0, 8)}</code>
                      </td>
                      <td className="whitespace-nowrap text-[12.5px] text-ink-2">{r.ip ?? ""}</td>
                      <td className="min-w-40">
                        {before || after ? (
                          <details>
                            <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-brand">Before and after</summary>
                            <div className="mt-1.5 grid gap-2 md:grid-cols-2">
                              <div>
                                <p className="text-[11.5px] font-semibold text-ink-3">Before</p>
                                <pre className="max-h-64 max-w-md overflow-auto rounded bg-surface-2 p-2 text-[11.5px] leading-4">{before ?? "none"}</pre>
                              </div>
                              <div>
                                <p className="text-[11.5px] font-semibold text-ink-3">After</p>
                                <pre className="max-h-64 max-w-md overflow-auto rounded bg-surface-2 p-2 text-[11.5px] leading-4">{after ?? "none"}</pre>
                              </div>
                            </div>
                          </details>
                        ) : (
                          <span className="text-[12px] text-ink-3">No change recorded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
