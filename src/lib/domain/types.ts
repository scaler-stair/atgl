/**
 * Canonical domain model (Section 6: master data with canonical site, station,
 * compressor, meter and asset IDs). Shared by connectors, analytics and UI.
 */

export type ZoneId = string;
export type SiteId = string;

export type SiteType = "CGS" | "CNG_MOTHER" | "CNG_ONLINE" | "CNG_DB" | "OFFICE";

export interface Zone {
  id: ZoneId;
  name: string;
  state: string;
}

export interface Site {
  id: SiteId;
  zoneId: ZoneId;
  name: string;
  type: SiteType;
  /** Contract demand with Discom, kVA. */
  contractDemandKva: number;
  discom: string;
  lat: number;
  lng: number;
}

export type AssetClass = "compressor" | "motor" | "pump" | "transformer" | "chiller" | "dispenser";

export interface Asset {
  id: string;
  siteId: SiteId;
  cls: AssetClass;
  name: string;
  make: string;
  ratedKw: number;
  commissioned: string;
  criticality: "A" | "B" | "C";
  vendorContractId?: string;
}

export type MeterRole = "fiscal-inlet" | "district" | "cng-dispense" | "industrial" | "commercial";

export interface Meter {
  id: string;
  siteId: SiteId;
  role: MeterRole;
  tech: "ultrasonic" | "turbine" | "coriolis" | "rotary";
  sizeMm: number;
  lastCalibration: string;
  customer?: string;
}

export interface PipelineSegment {
  id: string;
  zoneId: ZoneId;
  name: string;
  lengthKm: number;
  material: "steel" | "MDPE";
  diameterMm: number;
  pressureClass: "high" | "medium" | "low";
}

export interface VendorContract {
  id: string;
  vendor: string;
  scope: string;
  assetClass: AssetClass;
  siteIds: SiteId[];
  startDate: string;
  endDate: string;
  annualValueInr: number;
  slaResponseHours: number;
  paymentCycle: "monthly" | "quarterly";
}

/* ------------------------------------------------------------------ */
/* Evidence / lineage: every KPI and AI answer carries one (Section 8) */
/* ------------------------------------------------------------------ */

export type QualityState = "good" | "degraded" | "stale" | "missing";

export type SourceSystem = "SCADA" | "HISTORIAN" | "RTU" | "ERP" | "BILLING" | "MAINTENANCE" | "GIS" | "MASTER";

export interface TimeWindow {
  key: WindowKey;
  from: string;
  to: string;
  label: string;
}

export type WindowKey = "24h" | "7d" | "30d";

export interface Evidence {
  window: TimeWindow;
  sources: SourceSystem[];
  quality: QualityState;
  /** Oldest "last good sample" among contributing sources. */
  asOf: string;
  /** Rule / formula / model version that produced the figure. */
  version: string;
  scopeLabel: string;
  notes?: string[];
}

export interface Measure<T = number> {
  value: T;
  unit: string;
  evidence: Evidence;
}

export interface Scope {
  zoneId?: ZoneId;
  siteId?: SiteId;
  /** Site IDs the current user is allowed to see (role/site scoping). null = all. */
  allowedSiteIds: SiteId[] | null;
}
