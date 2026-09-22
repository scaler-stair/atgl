import { assets, meters, pipelineSegments, sites, vendorContracts, zones } from "../domain/master";

/**
 * Deterministic synthetic feeds that stand in for SCADA / historian / RTU /
 * ERP / billing / maintenance / GIS until the ATGL site study confirms real
 * interfaces. Values are stable for a given (entity, hour) so every screen,
 * agent and copilot answer reconciles with the others.
 *
 * Deliberate scenarios are injected so agents have something real to find;
 * they are listed in SCENARIOS and documented in docs/DATA_DICTIONARY.md.
 */

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const HISTORY_DAYS = 30;

export const SCENARIOS = {
  degradingCompressor: "AHD-MS-01-CMP-2",
  lowSuctionSite: "FBD-OS-01",
  highUagZone: "VAD",
  driftingMeter: "VAD-CGS-01-IM-2",
  staleRtuSite: "KHJ-DB-01",
  missingGapAsset: "UDR-OS-01-CMP-1",
  overbilledSite: "UDR-OS-01",
  demandPenaltySite: "AHD-MS-01",
  pfPenaltySite: "FBD-MS-01",
  weakCpSegment: "VAD-SEG-ST-02",
  excavationZone: "AHD",
  leakSegment: "VAD-SEG-PE-02",
  slaBreachContract: "AMC-CMP-BAUER",
  unitMismatchMeter: "FBD-CGS-01-DM-1",
} as const;

/* ---------------- deterministic randomness ---------------- */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform [0,1) stable for a key. */
export function rand(key: string): number {
  let t = hashString(key) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Approximately normal noise, mean 0, sd 1. */
function noise(key: string): number {
  return (rand(key + "a") + rand(key + "b") + rand(key + "c") - 1.5) * 2;
}

/* ---------------- time anchoring ---------------- */

/** The last completed hour. All series end here unless a source is stale. */
export function anchorHour(now = Date.now()): number {
  return Math.floor(now / HOUR) * HOUR;
}

export function hourIndex(ts: number): number {
  return Math.floor(ts / HOUR);
}

/** Diurnal CNG demand curve: morning and evening peaks. */
function demandShape(hourOfDay: number): number {
  const morning = Math.exp(-((hourOfDay - 9) ** 2) / 8);
  const evening = Math.exp(-((hourOfDay - 19) ** 2) / 10);
  return 0.35 + 0.55 * morning + 0.7 * evening;
}

function istHour(ts: number): number {
  return new Date(ts + 5.5 * HOUR).getUTCHours();
}

/* ---------------- source freshness model ---------------- */

export interface SourceLag {
  /** Minutes behind real time the last good sample is. */
  lagMinutes: number;
  failing?: boolean;
  message?: string;
}

/** Per-site RTU lag. One site is intentionally stale. */
export function rtuLag(siteId: string, now = Date.now()): SourceLag {
  if (siteId === SCENARIOS.staleRtuSite) {
    return { lagMinutes: 5 * 60 + 12, failing: true, message: "RTU poll timeout since last good sample; GPRS link down" };
  }
  const base = 2 + Math.floor(rand(siteId + ":lag:" + Math.floor(now / (10 * 60_000))) * 6);
  return { lagMinutes: base };
}

/* ---------------- compressor telemetry ---------------- */

export interface CompressorSample {
  ts: number;
  assetId: string;
  running: boolean;
  kwh: number;
  kgCompressed: number;
  suctionBar: number;
  dischargeBar: number;
  vibrationMmS: number;
  bearingTempC: number;
  /** Data-quality flag carried from source. */
  flag?: "gap" | "stale";
}

function compressorBaseKw(assetId: string): number {
  const a = assets.find((x) => x.id === assetId);
  return a ? a.ratedKw : 150;
}

export function compressorSample(assetId: string, ts: number, anchor: number): CompressorSample | null {
  const siteId = assetId.split("-CMP-")[0];
  const lag = rtuLag(siteId);
  if (ts > anchor - (lag.lagMinutes > 60 ? Math.floor(lag.lagMinutes / 60) * HOUR : 0)) {
    return null; // beyond last good sample
  }
  const hi = hourIndex(ts);
  // Injected 7-hour gap two days ago.
  if (assetId === SCENARIOS.missingGapAsset) {
    const hoursAgo = (anchor - ts) / HOUR;
    if (hoursAgo >= 46 && hoursAgo < 53) {
      return { ts, assetId, running: false, kwh: 0, kgCompressed: 0, suctionBar: 0, dischargeBar: 0, vibrationMmS: 0, bearingTempC: 0, flag: "gap" };
    }
  }
  const rated = compressorBaseKw(assetId);
  const shape = demandShape(istHour(ts));
  const cmpIdx = Number(assetId.split("-CMP-")[1] ?? 1);
  // Lead/lag staging: compressor 1 always leads; others only run at higher load.
  const loadFactor = Math.min(1, shape * (1.15 - 0.22 * (cmpIdx - 1)) + 0.08 * noise(`${assetId}:${hi}:load`));
  const running = loadFactor > 0.22;
  if (!running) {
    return { ts, assetId, running, kwh: 0.6 + rand(`${assetId}:${hi}:idle`), kgCompressed: 0, suctionBar: 0, dischargeBar: 0, vibrationMmS: 0.4, bearingTempC: 34 + 3 * rand(`${assetId}:${hi}:t`) };
  }
  let suction = 19 + 2.5 * noise(`${assetId}:${hi}:suc`) * 0.4;
  if (siteId === SCENARIOS.lowSuctionSite) suction -= 5.5; // network pressure starved
  // Specific energy consumption kWh/kg: baseline 0.21, worse at low suction.
  let sec = 0.205 + 0.004 * noise(`${assetId}:${hi}:sec`) + Math.max(0, 18 - suction) * 0.012;
  let vibration = 2.1 + 0.25 * noise(`${assetId}:${hi}:vib`);
  let temp = 68 + 4 * loadFactor + 1.2 * noise(`${assetId}:${hi}:tmp`);
  if (assetId === SCENARIOS.degradingCompressor) {
    const daysAgo = (anchor - ts) / DAY;
    const deg = Math.max(0, (12 - daysAgo) / 12); // ramps up over the last 12 days
    sec *= 1 + 0.2 * deg;
    vibration += 4.6 * deg ** 1.4;
    temp += 11 * deg;
  }
  const kwh = rated * loadFactor * (0.92 + 0.05 * rand(`${assetId}:${hi}:kw`));
  return {
    ts,
    assetId,
    running,
    kwh: +kwh.toFixed(2),
    kgCompressed: +(kwh / sec).toFixed(1),
    suctionBar: +suction.toFixed(2),
    dischargeBar: +(250 - 3 * rand(`${assetId}:${hi}:dis`)).toFixed(1),
    vibrationMmS: +vibration.toFixed(2),
    bearingTempC: +temp.toFixed(1),
  };
}

export function compressorSeries(assetId: string, fromTs: number, toTs: number, anchor: number): CompressorSample[] {
  const out: CompressorSample[] = [];
  for (let ts = fromTs; ts <= toTs; ts += HOUR) {
    const s = compressorSample(assetId, ts, anchor);
    if (s) out.push(s);
  }
  return out;
}

/* ---------------- site electrical (ancillary + compression) ---------------- */

export interface SiteElectricalSample {
  ts: number;
  siteId: string;
  kwh: number;
  maxDemandKva: number;
  powerFactor: number;
}

export function siteAuxKwh(siteId: string, ts: number): number {
  const site = sites.find((s) => s.id === siteId)!;
  const hi = hourIndex(ts);
  const h = istHour(ts);
  const base = { CGS: 18, CNG_MOTHER: 22, CNG_ONLINE: 16, CNG_DB: 9, OFFICE: 35 }[site.type];
  const officeShape = site.type === "OFFICE" ? (h >= 9 && h <= 19 ? 1.8 : 0.45) : 1;
  return +(base * officeShape * (1 + 0.08 * noise(`${siteId}:${hi}:aux`))).toFixed(2);
}

/* ---------------- zone gas balance (daily, SCM) ---------------- */

export interface ZoneGasDay {
  day: string; // YYYY-MM-DD (IST)
  zoneId: string;
  inputScm: number;
  cngScm: number;
  domesticScm: number;
  industrialScm: number;
  commercialScm: number;
  linepackOpenScm: number;
  linepackCloseScm: number;
  uagScm: number;
  /** Attribution of UAG (SCM) by driver, sums to uagScm. */
  attribution: { meteringError: number; leakage: number; billingLag: number; linepackEstimate: number; unexplained: number };
}

const zoneScale: Record<string, number> = { AHD: 1_450_000, VAD: 820_000, FBD: 690_000, KHJ: 210_000, UDR: 260_000 };

export function istDay(ts: number): string {
  return new Date(ts + 5.5 * HOUR).toISOString().slice(0, 10);
}

export function zoneGasDay(zoneId: string, dayStartTs: number): ZoneGasDay {
  const day = istDay(dayStartTs);
  const k = `${zoneId}:${day}`;
  const input = zoneScale[zoneId] * (1 + 0.05 * noise(k + ":in"));
  const linepackOpen = zoneScale[zoneId] * 0.11 * (1 + 0.02 * noise(k + ":lpo"));
  const linepackClose = zoneScale[zoneId] * 0.11 * (1 + 0.02 * noise(`${zoneId}:${istDay(dayStartTs + DAY)}:lpo`));
  let uagPct = 0.0075 + 0.0015 * noise(k + ":uag");
  const attr = { meteringError: 0.35, leakage: 0.2, billingLag: 0.25, linepackEstimate: 0.12, unexplained: 0.08 };
  if (zoneId === SCENARIOS.highUagZone) {
    uagPct += 0.016;
    attr.meteringError = 0.52;
    attr.leakage = 0.27;
    attr.billingLag = 0.1;
    attr.linepackEstimate = 0.05;
    attr.unexplained = 0.06;
  }
  const deltaLp = linepackClose - linepackOpen;
  const uag = input * uagPct;
  const delivered = input - deltaLp - uag;
  const cng = delivered * 0.46;
  const domestic = delivered * 0.14;
  const industrial = delivered * 0.33;
  const commercial = delivered - cng - domestic - industrial;
  const r = (v: number) => Math.round(v);
  return {
    day,
    zoneId,
    inputScm: r(input),
    cngScm: r(cng),
    domesticScm: r(domestic),
    industrialScm: r(industrial),
    commercialScm: r(commercial),
    linepackOpenScm: r(linepackOpen),
    linepackCloseScm: r(linepackClose),
    uagScm: r(uag),
    attribution: {
      meteringError: r(uag * attr.meteringError),
      leakage: r(uag * attr.leakage),
      billingLag: r(uag * attr.billingLag),
      linepackEstimate: r(uag * attr.linepackEstimate),
      unexplained: r(uag * attr.unexplained),
    },
  };
}

/** Cascade storage inventory (kg) at CNG stations at a point in time. */
export function cascadeInventoryKg(siteId: string, ts: number): { kg: number; capacityKg: number } {
  const site = sites.find((s) => s.id === siteId)!;
  const capacity = { CNG_MOTHER: 4500, CNG_ONLINE: 3000, CNG_DB: 1800 }[site.type as "CNG_MOTHER"] ?? 0;
  const shape = demandShape(istHour(ts));
  const fill = Math.max(0.12, Math.min(0.98, 0.92 - 0.45 * shape + 0.06 * noise(`${siteId}:${hourIndex(ts)}:cas`)));
  return { kg: Math.round(capacity * fill), capacityKg: capacity };
}

/* ---------------- metering ---------------- */

export interface MeterHealth {
  meterId: string;
  flowScmh: number;
  /** % deviation vs check meter / reconciled reference. */
  driftPct: number;
  diagnosticsOk: boolean;
  sampledAt: number;
  unitReported: string;
  unitExpected: string;
}

export function meterHealth(meterId: string, anchor: number): MeterHealth {
  const m = meters.find((x) => x.id === meterId)!;
  const k = `${meterId}:${istDay(anchor)}`;
  const baseFlow = { "fiscal-inlet": 38000, district: 21000, "cng-dispense": 420, industrial: 2600, commercial: 140 }[m.role];
  let drift = 0.25 * noise(k + ":drift");
  if (meterId === SCENARIOS.driftingMeter) drift = -2.14 + 0.05 * noise(k + ":d2");
  const calibAgeDays = (anchor - Date.parse(m.lastCalibration)) / DAY;
  if (calibAgeDays > 365) drift += (drift >= 0 ? 1 : -1) * 0.35;
  return {
    meterId,
    flowScmh: Math.round(baseFlow * demandShape(istHour(anchor)) * (1 + 0.05 * noise(k + ":f"))),
    driftPct: +drift.toFixed(2),
    diagnosticsOk: meterId !== SCENARIOS.driftingMeter,
    sampledAt: anchor - rtuLag(m.siteId).lagMinutes * 60_000,
    unitReported: meterId === SCENARIOS.unitMismatchMeter ? "kg/cm2" : "bar(g)",
    unitExpected: "bar(g)",
  };
}

/* ---------------- billing (monthly Discom bills) ---------------- */

export interface DiscomBill {
  billNo: string;
  siteId: string;
  month: string; // YYYY-MM
  billedKwh: number;
  measuredKwh: number;
  recordedMdKva: number;
  contractDemandKva: number;
  powerFactor: number;
  energyRateInr: number;
  demandRateInr: number;
  billedAmountInr: number;
  expectedAmountInr: number;
  tariffCategory: string;
  expectedTariffCategory: string;
  documentRef: string;
}

export function monthlyBills(anchor: number, months = 3): DiscomBill[] {
  const out: DiscomBill[] = [];
  const d = new Date(anchor);
  for (let mi = 1; mi <= months; mi++) {
    const md = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - mi, 1));
    const month = md.toISOString().slice(0, 7);
    for (const s of sites) {
      const k = `${s.id}:${month}`;
      const cmpKw = assets.filter((a) => a.siteId === s.id && a.cls === "compressor").reduce((t, a) => t + a.ratedKw, 0);
      const measured = Math.round((cmpKw * 24 * 30 * 0.52 + { CGS: 13000, CNG_MOTHER: 16000, CNG_ONLINE: 11500, CNG_DB: 6500, OFFICE: 31000 }[s.type]) * (1 + 0.04 * noise(k + ":m")));
      let billed = Math.round(measured * (1 + 0.004 * noise(k + ":b")));
      if (s.id === SCENARIOS.overbilledSite) billed = Math.round(measured * 1.087);
      let mdKva = Math.round(s.contractDemandKva * (0.78 + 0.1 * rand(k + ":md")));
      if (s.id === SCENARIOS.demandPenaltySite && mi <= 2) mdKva = Math.round(s.contractDemandKva * 1.14);
      let pf = +(0.965 + 0.02 * rand(k + ":pf")).toFixed(3);
      if (s.id === SCENARIOS.pfPenaltySite) pf = 0.872;
      const energyRate = 7.35;
      const demandRate = 475;
      const excess = Math.max(0, mdKva - s.contractDemandKva);
      const pfPenalty = pf < 0.9 ? (0.9 - pf) * 100 * 0.01 * billed * energyRate : 0;
      const billedAmount = billed * energyRate + Math.max(mdKva, s.contractDemandKva * 0.85) * demandRate + excess * demandRate * 1 + pfPenalty;
      const expected = measured * energyRate + Math.max(mdKva, s.contractDemandKva * 0.85) * demandRate + excess * demandRate + pfPenalty;
      const tariff = s.type === "OFFICE" ? "HT-Commercial" : "HT-Industrial";
      out.push({
        billNo: `${s.discom.replace(/\W/g, "").slice(0, 4).toUpperCase()}-${month.replace("-", "")}-${s.id.replace(/-/g, "")}`,
        siteId: s.id,
        month,
        billedKwh: billed,
        measuredKwh: measured,
        recordedMdKva: mdKva,
        contractDemandKva: s.contractDemandKva,
        powerFactor: pf,
        energyRateInr: energyRate,
        demandRateInr: demandRate,
        billedAmountInr: Math.round(billedAmount),
        expectedAmountInr: Math.round(expected),
        tariffCategory: s.id === "KHJ-OS-01" ? "HT-Commercial" : tariff,
        expectedTariffCategory: tariff,
        documentRef: `billing://discom/${s.discom.replace(/\s/g, "_")}/${month}/${s.id}.pdf`,
      });
    }
  }
  return out;
}

/* ---------------- maintenance / work orders ---------------- */

export interface WorkOrder {
  id: string;
  assetId: string;
  contractId: string;
  raisedAt: number;
  respondedAt: number | null;
  closedAt: number | null;
  type: "breakdown" | "preventive" | "calibration";
  description: string;
}

export function workOrders(anchor: number): WorkOrder[] {
  const out: WorkOrder[] = [];
  let n = 1000;
  for (const a of assets) {
    if (!a.vendorContractId) continue;
    for (let i = 0; i < 3; i++) {
      const k = `${a.id}:wo:${i}`;
      if (rand(k) > 0.42) continue;
      const raised = anchor - Math.floor(rand(k + ":t") * 40 * DAY);
      const c = vendorContracts.find((x) => x.id === a.vendorContractId)!;
      let respH = c.slaResponseHours * (0.3 + 0.78 * rand(k + ":r"));
      if (c.id === SCENARIOS.slaBreachContract) respH = c.slaResponseHours * (0.75 + 0.9 * rand(k + ":r"));
      const responded = raised + respH * HOUR;
      const closed = rand(k + ":c") > 0.3 ? responded + (4 + 40 * rand(k + ":cc")) * HOUR : null;
      const type = (["breakdown", "preventive", "calibration"] as const)[Math.floor(rand(k + ":ty") * 3)];
      out.push({
        id: `WO-${n++}`,
        assetId: a.id,
        contractId: c.id,
        raisedAt: raised,
        respondedAt: responded <= anchor ? responded : null,
        closedAt: closed && closed <= anchor ? closed : null,
        type,
        description: {
          breakdown: `${a.name} trip / abnormal noise reported by site`,
          preventive: `${a.name} scheduled preventive maintenance`,
          calibration: `${a.name} calibration and verification`,
        }[type],
      });
    }
  }
  if (!out.some((w) => w.assetId === SCENARIOS.degradingCompressor)) {
    out.push({ id: `WO-${n++}`, assetId: SCENARIOS.degradingCompressor, contractId: "AMC-CMP-BAUER", raisedAt: anchor - 3 * DAY, respondedAt: anchor - 3 * DAY + 10.5 * HOUR, closedAt: null, type: "breakdown", description: "Compressor 2 high vibration alarm acknowledged at site" });
  }
  return out.sort((a, b) => b.raisedAt - a.raisedAt);
}

export interface VendorPayment {
  contractId: string;
  dueDate: string;
  amountInr: number;
  status: "paid" | "due" | "on-hold";
}

export function vendorPayments(anchor: number): VendorPayment[] {
  const out: VendorPayment[] = [];
  for (const c of vendorContracts) {
    const per = c.paymentCycle === "monthly" ? c.annualValueInr / 12 : c.annualValueInr / 4;
    const step = c.paymentCycle === "monthly" ? 1 : 3;
    const d = new Date(anchor);
    for (let i = -2; i <= 1; i++) {
      const due = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i * step, 10));
      const status = due.getTime() < anchor ? (c.id === SCENARIOS.slaBreachContract && i === 0 ? "on-hold" : "paid") : "due";
      out.push({ contractId: c.id, dueDate: due.toISOString().slice(0, 10), amountInr: Math.round(per), status });
    }
  }
  return out;
}

/* ---------------- safety & integrity (GIS / CP / patrol) ---------------- */

export interface CpReading {
  segmentId: string;
  testPoint: string;
  /** Pipe-to-soil ON potential, V vs CSE. Protection criterion: <= -0.85 V. */
  potentialV: number;
  readAt: number;
}

export function cpReadings(anchor: number): CpReading[] {
  const out: CpReading[] = [];
  for (const seg of pipelineSegments.filter((s) => s.material === "steel")) {
    const tps = Math.round(seg.lengthKm / 3);
    for (let i = 1; i <= tps; i++) {
      const k = `${seg.id}:TP${i}:${istDay(anchor)}`;
      let v = -1.05 - 0.08 * noise(k);
      if (seg.id === SCENARIOS.weakCpSegment && i >= 2 && i <= 4) v = -0.76 - 0.03 * rand(k);
      out.push({ segmentId: seg.id, testPoint: `TP-${String(i).padStart(2, "0")}`, potentialV: +v.toFixed(3), readAt: anchor - (6 + Math.floor(rand(k + ":t") * 20)) * HOUR });
    }
  }
  return out;
}

export interface SafetyEvent {
  id: string;
  kind: "excavation" | "leak" | "patrol" | "emergency-call";
  zoneId: string;
  segmentId: string;
  at: number;
  severity: "low" | "medium" | "high";
  permitted?: boolean;
  distanceM?: number;
  description: string;
  status: "open" | "closed";
}

export function safetyEvents(anchor: number): SafetyEvent[] {
  const out: SafetyEvent[] = [];
  let n = 1;
  for (const z of zones) {
    const segs = pipelineSegments.filter((s) => s.zoneId === z.id);
    const exc = z.id === SCENARIOS.excavationZone ? 5 : 1 + Math.floor(rand(z.id + ":exc") * 2);
    for (let i = 0; i < exc; i++) {
      const k = `${z.id}:exc:${i}`;
      const permitted = !(z.id === SCENARIOS.excavationZone && i === 1) && rand(k + ":p") > 0.15;
      const dist = Math.round(2 + rand(k + ":d") * 25);
      out.push({
        id: `SE-${String(n++).padStart(4, "0")}`,
        kind: "excavation",
        zoneId: z.id,
        segmentId: segs[i % 2].id,
        at: anchor - Math.floor(rand(k + ":t") * 6 * DAY),
        severity: !permitted && dist < 10 ? "high" : dist < 10 ? "medium" : "low",
        permitted,
        distanceM: dist,
        description: `${permitted ? "Permitted" : "Unpermitted"} third-party excavation ${dist} m from ${segs[i % 2].name}`,
        status: i === 0 ? "closed" : "open",
      });
    }
    for (let i = 0; i < 4; i++) {
      out.push({
        id: `SE-${String(n++).padStart(4, "0")}`,
        kind: "patrol",
        zoneId: z.id,
        segmentId: segs[i].id,
        at: anchor - (i + 1) * DAY - Math.floor(rand(`${z.id}:pat:${i}`) * 8) * HOUR,
        severity: "low",
        description: `GIS patrol completed: ${segs[i].name}`,
        status: "closed",
      });
    }
  }
  out.push({ id: `SE-${String(n++).padStart(4, "0")}`, kind: "leak", zoneId: "VAD", segmentId: SCENARIOS.leakSegment, at: anchor - 2 * DAY - 5 * HOUR, severity: "high", description: "Leak survey: gas detected at service tee, MDPE south, 3 ppm-m reading", status: "open" });
  out.push({ id: `SE-${String(n++).padStart(4, "0")}`, kind: "emergency-call", zoneId: "AHD", segmentId: "AHD-SEG-PE-01", at: anchor - 9 * HOUR, severity: "medium", description: "Emergency 1800 call: gas smell reported near domestic riser, attended in 22 min", status: "closed" });
  return out.sort((a, b) => b.at - a.at);
}
