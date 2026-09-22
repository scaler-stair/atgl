import type { Metadata } from "next";
import { Notice, Panel, PageHeader, TableWrap, Tag, type Tone } from "@/components/ui";
import { connectorStatuses, readOnlyAudit, type ConnectorState } from "@/lib/connectors";
import { ago, date, num, titleCase } from "@/lib/format";
import { credentialAgeDays } from "@/lib/server/admin";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Integrations" };

const stateTone: Record<ConnectorState, Tone> = { healthy: "ok", degraded: "warn", failed: "crit" };
const ROTATION_DAYS = 90;

function lag(min: number): string {
  if (min < 60) return `${num(min)} min`;
  if (min < 48 * 60) return `${num(min / 60, 1)} h`;
  return `${num(min / 1440, 1)} days`;
}

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  await pageContext("admin-integrations", searchParams);
  const connectors = connectorStatuses();
  const control = readOnlyAudit();
  const byId = new Map(connectors.map((c) => [c.id, c]));
  const passed = control.every((c) => c.frozen && c.violations.length === 0);
  const overdue = connectors.filter((c) => credentialAgeDays(c.credentialRotatedAt) > ROTATION_DAYS);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Every source connector is read-only, runs under its own service account (separate from human credentials) and reaches OT data only through the approved network path."
      />

      <div className="mb-4">
        <Notice tone="info" title="Indicative connector profile">
          Exact interfaces, tags and polling rates are confirmed during site discovery and recorded under SOP-02 before a connector goes live.
        </Notice>
      </div>

      <Panel
        title="Connectors"
        description={`${connectors.length} sources; ${overdue.length ? `${overdue.length} credential${overdue.length === 1 ? "" : "s"} older than ${ROTATION_DAYS} days` : `all credentials rotated within ${ROTATION_DAYS} days`}`}
        bodyClass="p-4"
      >
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Connector</th>
                <th scope="col">Owner</th>
                <th scope="col">Protocol and network path</th>
                <th scope="col">Service account and mode</th>
                <th scope="col">State</th>
                <th scope="col" className="num">Lag and polling</th>
                <th scope="col" className="num">Records last run</th>
                <th scope="col">Credential rotated</th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((c) => {
                const ageDays = credentialAgeDays(c.credentialRotatedAt);
                const late = c.lagMinutes > c.expectedFreshnessMin;
                return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">
                      <span className="font-semibold text-ink">{c.name}</span>
                      <span className="block text-[12px] text-ink-3">{c.system}, {c.id}</span>
                    </td>
                    <td className="text-[13px]">{c.owner}</td>
                    <td className="min-w-56 text-[13px]">
                      {c.protocol}
                      <span className="block text-[12px] text-ink-3">{c.networkPath}</span>
                    </td>
                    <td className="whitespace-nowrap">
                      <code className="text-[12.5px]">{c.serviceAccount}</code>
                      <span className="mt-1 block">
                        <Tag tone="flow" title="Service account, separate from human credentials">Read-only</Tag>
                      </span>
                    </td>
                    <td>
                      <Tag tone={stateTone[c.state]}>{titleCase(c.state)}</Tag>
                      {c.message && <span className="mt-1 block max-w-56 text-[12px] text-ink-2">{c.message}</span>}
                    </td>
                    <td className="num">
                      <span className={late ? "font-semibold text-crit" : ""}>{lag(c.lagMinutes)}</span>
                      <span className="block text-[12px] text-ink-3">expected {lag(c.expectedFreshnessMin)}</span>
                      <span className="block text-[12px] text-ink-3">polls {c.pollInterval}</span>
                    </td>
                    <td className="num">{num(c.recordsLastRun)}</td>
                    <td className="whitespace-nowrap text-[13px]">
                      {date(c.credentialRotatedAt)}
                      <span className="block">
                        {ageDays > ROTATION_DAYS ? <Tag tone="warn">{ageDays} days, rotate now</Tag> : <span className="text-[12px] text-ink-3">{ago(c.credentialRotatedAt)}</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel
        className="mt-4"
        title="Read-only negative control"
        description="Enumerates every method each connector exposes and proves none is a write, command or control verb, and that the connector object is frozen."
        actions={<Tag tone={passed ? "ok" : "crit"}>{passed ? "Pass: no write path" : "Fail: review violations"}</Tag>}
        bodyClass="p-4"
      >
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Connector</th>
                <th scope="col">Exposed methods</th>
                <th scope="col">Frozen</th>
                <th scope="col">Violations</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {control.map((c) => {
                const ok = c.frozen && c.violations.length === 0;
                return (
                  <tr key={c.connector}>
                    <td className="whitespace-nowrap font-semibold text-ink">{byId.get(c.connector)?.name ?? c.connector}</td>
                    <td className="text-[12.5px]">
                      <div className="flex flex-wrap gap-1">
                        {c.methods.map((m) => (
                          <code key={m} className="rounded bg-surface-2 px-1.5 py-0.5">{m}</code>
                        ))}
                      </div>
                    </td>
                    <td>{c.frozen ? "Yes" : <span className="font-semibold text-crit">No</span>}</td>
                    <td className="text-[13px]">{c.violations.length ? <span className="text-crit">{c.violations.join(", ")}</span> : <span className="text-ink-3">None</span>}</td>
                    <td>
                      <Tag tone={ok ? "ok" : "crit"}>{ok ? "Pass" : "Fail"}</Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <p className="mt-4 text-[12.5px] text-ink-3">
          The same check runs in CI with <code>npm run test:readonly</code>. Connector registration also rejects any method that is not a read verb, so a write method cannot be added without the application failing to start.
        </p>
      </Panel>
    </>
  );
}
