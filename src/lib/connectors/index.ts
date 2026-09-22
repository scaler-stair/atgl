import { sites } from "../domain/master";
import type { SourceSystem } from "../domain/types";
import * as feed from "./synthetic";

/**
 * Read-only connector framework (Section 6, SOP-02).
 *
 * Every connector exposes ONLY read methods. `defineConnector` rejects any
 * method whose name looks like a write/command verb and freezes the object,
 * so no code path in the application can reach an OT write endpoint. The
 * negative-control test (`npm run test:readonly`) asserts this at build time.
 */

export const FORBIDDEN_VERBS = /^(write|set|put|post|patch|delete|remove|update|insert|command|control|exec|execute|start|stop|trip|open|close|reset|ack|send|push)/i;

export type ConnectorState = "healthy" | "degraded" | "failed";

export interface ConnectorDescriptor {
  id: string;
  system: SourceSystem;
  name: string;
  owner: string;
  protocol: string;
  networkPath: string;
  serviceAccount: string;
  expectedFreshnessMin: number;
  pollInterval: string;
}

export interface ConnectorStatus extends ConnectorDescriptor {
  mode: "read-only";
  state: ConnectorState;
  lastGoodSample: number;
  lagMinutes: number;
  message?: string;
  recordsLastRun: number;
  credentialRotatedAt: string;
}

type ReadFn = (...args: never[]) => unknown;

export interface Connector<R extends Record<string, ReadFn>> {
  descriptor: ConnectorDescriptor;
  status(now?: number): ConnectorStatus;
  read: Readonly<R>;
}

export function defineConnector<R extends Record<string, ReadFn>>(
  descriptor: ConnectorDescriptor,
  statusFn: (now: number) => Omit<ConnectorStatus, keyof ConnectorDescriptor | "mode">,
  read: R,
): Connector<R> {
  for (const name of Object.keys(read)) {
    if (!/^(get|list|query|read|fetch|describe)/.test(name) || FORBIDDEN_VERBS.test(name)) {
      throw new Error(`Connector ${descriptor.id}: method "${name}" is not a read method. OT/IT connectors are read-only by design.`);
    }
  }
  return Object.freeze({
    descriptor: Object.freeze(descriptor),
    status: (now = Date.now()) => ({ ...descriptor, mode: "read-only" as const, ...statusFn(now) }),
    read: Object.freeze({ ...read }),
  });
}

function st(state: ConnectorState, lagMinutes: number, now: number, records: number, rotated: string, message?: string) {
  return { state, lagMinutes, lastGoodSample: now - lagMinutes * 60_000, recordsLastRun: records, credentialRotatedAt: rotated, message };
}

export const historian = defineConnector(
  {
    id: "scada-historian",
    system: "HISTORIAN",
    name: "SCADA historian",
    owner: "ATGL SCADA team",
    protocol: "Historian REST (read-only), TLS 1.3",
    networkPath: "OT DMZ via data diode, historian replica",
    serviceAccount: "svc-atgl-hist-ro",
    expectedFreshnessMin: 15,
    pollInterval: "5 min",
  },
  (now) => st("healthy", 4, now, 18_420, "2026-08-30"),
  {
    getCompressorSeries: (assetId: string, fromTs: number, toTs: number, anchor: number) => feed.compressorSeries(assetId, fromTs, toTs, anchor),
    getCompressorSample: (assetId: string, ts: number, anchor: number) => feed.compressorSample(assetId, ts, anchor),
    getSiteAuxKwh: (siteId: string, ts: number) => feed.siteAuxKwh(siteId, ts),
    getCascadeInventory: (siteId: string, ts: number) => feed.cascadeInventoryKg(siteId, ts),
  },
);

export const rtu = defineConnector(
  {
    id: "rtu-ot",
    system: "RTU",
    name: "Station RTUs",
    owner: "ATGL O&M instrumentation",
    protocol: "IEC 60870-5-104 → OT gateway (read-only mirror)",
    networkPath: "Dual firewall, OT → IT one-way replication",
    serviceAccount: "svc-atgl-rtu-ro",
    expectedFreshnessMin: 15,
    pollInterval: "1 min",
  },
  (now) => {
    const lags = sites.map((s) => ({ s, lag: feed.rtuLag(s.id, now) }));
    const failing = lags.filter((l) => l.lag.failing);
    const worst = Math.max(...lags.map((l) => l.lag.lagMinutes));
    return failing.length
      ? st("degraded", worst, now, 26_880, "2026-08-30", `${failing.length} site RTU(s) not reporting: ${failing.map((f) => f.s.id).join(", ")}`)
      : st("healthy", worst, now, 26_880, "2026-08-30");
  },
  {
    getSiteLag: (siteId: string, now?: number) => feed.rtuLag(siteId, now),
    getMeterHealth: (meterId: string, anchor: number) => feed.meterHealth(meterId, anchor),
  },
);

export const scadaGas = defineConnector(
  {
    id: "scada-gas-balance",
    system: "SCADA",
    name: "SCADA gas balance",
    owner: "ATGL gas control",
    protocol: "Daily balance export (read-only SFTP pull)",
    networkPath: "OT DMZ file drop, pulled from IT side",
    serviceAccount: "svc-atgl-gasbal-ro",
    expectedFreshnessMin: 26 * 60,
    pollInterval: "daily 06:00 IST",
  },
  (now) => st("healthy", Math.round(((now + 5.5 * feed.HOUR) % feed.DAY) / 60_000), now, 5 * 30, "2026-07-12"),
  {
    getZoneGasDay: (zoneId: string, dayStartTs: number) => feed.zoneGasDay(zoneId, dayStartTs),
  },
);

export const erpBilling = defineConnector(
  {
    id: "erp-billing",
    system: "BILLING",
    name: "ERP and Discom billing",
    owner: "ATGL Finance",
    protocol: "ERP OData (read-only) + Discom e-bill ingestion",
    networkPath: "IT network, authenticated service principal",
    serviceAccount: "svc-atgl-erp-ro",
    expectedFreshnessMin: 35 * 24 * 60,
    pollInterval: "daily reconciliation job",
  },
  (now) => st("healthy", 11 * 60, now, 84, "2026-06-01"),
  {
    getMonthlyBills: (anchor: number, months?: number) => feed.monthlyBills(anchor, months),
  },
);

export const maintenance = defineConnector(
  {
    id: "maintenance-amc",
    system: "MAINTENANCE",
    name: "Maintenance and AMC",
    owner: "ATGL Maintenance planning",
    protocol: "CMMS REST API (read-only role)",
    networkPath: "IT network",
    serviceAccount: "svc-atgl-cmms-ro",
    expectedFreshnessMin: 60,
    pollInterval: "15 min",
  },
  (now) => st("healthy", 12, now, 212, "2026-08-02"),
  {
    getWorkOrders: (anchor: number) => feed.workOrders(anchor),
    getVendorPayments: (anchor: number) => feed.vendorPayments(anchor),
  },
);

export const gis = defineConnector(
  {
    id: "gis-safety",
    system: "GIS",
    name: "GIS, CP and patrol",
    owner: "ATGL Pipeline integrity",
    protocol: "GIS feature service (read-only token)",
    networkPath: "IT network, controlled geospatial access",
    serviceAccount: "svc-atgl-gis-ro",
    expectedFreshnessMin: 24 * 60,
    pollInterval: "hourly",
  },
  (now) => st("healthy", 38, now, 640, "2026-05-18"),
  {
    getCpReadings: (anchor: number) => feed.cpReadings(anchor),
    getSafetyEvents: (anchor: number) => feed.safetyEvents(anchor),
  },
);

export const connectors = [historian, rtu, scadaGas, erpBilling, maintenance, gis] as const;

export function connectorStatuses(now = Date.now()): ConnectorStatus[] {
  return connectors.map((c) => c.status(now));
}

/** Negative control: enumerate every exposed method and prove none can write. */
export function readOnlyAudit(): { connector: string; methods: string[]; frozen: boolean; violations: string[] }[] {
  return connectors.map((c) => {
    const methods = Object.keys(c.read);
    return {
      connector: c.descriptor.id,
      methods,
      frozen: Object.isFrozen(c) && Object.isFrozen(c.read),
      violations: methods.filter((m) => FORBIDDEN_VERBS.test(m)),
    };
  });
}
