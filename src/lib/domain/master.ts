import type { Asset, Meter, PipelineSegment, Site, VendorContract, Zone } from "./types";

/**
 * Master data register. In production this is loaded from the approved master
 * data source with change history and effective dates (Section 6). The IDs
 * here follow the canonical pattern ZONE-TYPE-NN so connectors can map tags.
 */

export const MASTER_DATA_VERSION = "master@2026.09.1";

export const zones: Zone[] = [
  { id: "AHD", name: "Ahmedabad", state: "Gujarat" },
  { id: "VAD", name: "Vadodara", state: "Gujarat" },
  { id: "FBD", name: "Faridabad", state: "Haryana" },
  { id: "KHJ", name: "Khurja", state: "Uttar Pradesh" },
  { id: "UDR", name: "Udaipur", state: "Rajasthan" },
];

const discomByZone: Record<string, string> = {
  AHD: "Torrent Power",
  VAD: "MGVCL",
  FBD: "DHBVN",
  KHJ: "PVVNL",
  UDR: "AVVNL",
};

const origin: Record<string, [number, number]> = {
  AHD: [23.03, 72.58],
  VAD: [22.31, 73.18],
  FBD: [28.41, 77.31],
  KHJ: [28.25, 77.85],
  UDR: [24.58, 73.71],
};

const localities: Record<string, string[]> = {
  AHD: ["Chharodi", "Naroda", "Vatva", "Sanand", "Bopal", "Gota"],
  VAD: ["Nandesari", "Makarpura", "Waghodia", "Gotri", "Alkapuri"],
  FBD: ["Sector 37", "Ballabgarh", "Palwal Road", "NIT 5", "Badkhal"],
  KHJ: ["GT Road", "Bulandshahr Road", "Sikandrabad", "Jewar Road"],
  UDR: ["Madri", "Sukher", "Debari", "Bhuwana"],
};

function buildSites(): Site[] {
  const out: Site[] = [];
  for (const z of zones) {
    const names = localities[z.id];
    const [lat, lng] = origin[z.id];
    const plan: Array<[Site["type"], number]> = [
      ["CGS", 0],
      ["CNG_MOTHER", 1],
      ["CNG_ONLINE", 2],
      ["CNG_ONLINE", 3 % names.length],
      ["CNG_DB", 0],
    ];
    if (z.id === "AHD" || z.id === "VAD" || z.id === "FBD") plan.push(["OFFICE", names.length - 1]);
    if (z.id === "AHD") plan.push(["CNG_ONLINE", 4], ["CNG_DB", 5]);
    const counters: Record<string, number> = {};
    plan.forEach(([type, locIdx], i) => {
      counters[type] = (counters[type] ?? 0) + 1;
      const short = { CGS: "CGS", CNG_MOTHER: "MS", CNG_ONLINE: "OS", CNG_DB: "DB", OFFICE: "OFF" }[type];
      const label = {
        CGS: "City Gate Station",
        CNG_MOTHER: "CNG Mother Station",
        CNG_ONLINE: "CNG Online Station",
        CNG_DB: "CNG Daughter Booster",
        OFFICE: "Zonal Office",
      }[type];
      out.push({
        id: `${z.id}-${short}-${String(counters[type]).padStart(2, "0")}`,
        zoneId: z.id,
        name: `${names[locIdx % names.length]} ${label}`,
        type,
        contractDemandKva: { CGS: 150, CNG_MOTHER: 900, CNG_ONLINE: 600, CNG_DB: 350, OFFICE: 250 }[type],
        discom: discomByZone[z.id],
        lat: +(lat + ((i * 37) % 11) / 100 - 0.05).toFixed(4),
        lng: +(lng + ((i * 53) % 13) / 100 - 0.06).toFixed(4),
      });
    });
  }
  return out;
}

export const sites: Site[] = buildSites();

function buildAssets(): Asset[] {
  const out: Asset[] = [];
  for (const s of sites) {
    const push = (a: Omit<Asset, "siteId">) => out.push({ ...a, siteId: s.id });
    if (s.type.startsWith("CNG")) {
      const count = s.type === "CNG_MOTHER" ? 3 : s.type === "CNG_ONLINE" ? 2 : 1;
      for (let i = 1; i <= count; i++) {
        const kw = s.type === "CNG_MOTHER" ? 250 : s.type === "CNG_ONLINE" ? 160 : 75;
        push({
          id: `${s.id}-CMP-${i}`,
          cls: "compressor",
          name: `Compressor ${i}`,
          make: i % 2 ? "Ariel JGQ/2" : "Bauer GCS 250",
          ratedKw: kw,
          commissioned: `${2015 + ((i + s.id.length) % 8)}-0${1 + (i % 8)}-15`,
          criticality: "A",
          vendorContractId: i % 2 ? "AMC-CMP-ARIEL" : "AMC-CMP-BAUER",
        });
        push({
          id: `${s.id}-MTR-${i}`,
          cls: "motor",
          name: `Compressor ${i} drive motor`,
          make: "ABB M3BP",
          ratedKw: kw,
          commissioned: `${2015 + ((i + s.id.length) % 8)}-0${1 + (i % 8)}-15`,
          criticality: "A",
          vendorContractId: "AMC-ELEC-ZONAL",
        });
      }
      push({ id: `${s.id}-DSP-1`, cls: "dispenser", name: "Dispenser bank", make: "Tatsuno", ratedKw: 4, commissioned: "2019-06-01", criticality: "B", vendorContractId: "AMC-DSP-TATSUNO" });
    }
    if (s.type === "CGS") {
      push({ id: `${s.id}-PMP-1`, cls: "pump", name: "Odorant dosing pump", make: "Milton Roy", ratedKw: 1.5, commissioned: "2016-03-01", criticality: "B", vendorContractId: "AMC-CGS-SKID" });
    }
    if (s.type !== "CNG_DB") {
      push({ id: `${s.id}-TRF-1`, cls: "transformer", name: "Station transformer", make: "Siemens", ratedKw: s.contractDemandKva * 1.25, commissioned: "2016-01-10", criticality: s.type === "OFFICE" ? "C" : "A", vendorContractId: "AMC-ELEC-ZONAL" });
    }
    if (s.type === "OFFICE") {
      push({ id: `${s.id}-CHL-1`, cls: "chiller", name: "HVAC chiller", make: "Blue Star", ratedKw: 90, commissioned: "2018-04-20", criticality: "C", vendorContractId: "AMC-HVAC" });
    }
  }
  return out;
}

export const assets: Asset[] = buildAssets();

function buildMeters(): Meter[] {
  const out: Meter[] = [];
  const customers = ["Ceramic cluster", "Textile processor", "Pharma unit", "Hotel group", "Hospital", "Food processing"];
  let n = 0;
  for (const s of sites) {
    if (s.type === "CGS") {
      out.push({ id: `${s.id}-FM-1`, siteId: s.id, role: "fiscal-inlet", tech: "ultrasonic", sizeMm: 200, lastCalibration: "2026-03-12" });
      out.push({ id: `${s.id}-DM-1`, siteId: s.id, role: "district", tech: "turbine", sizeMm: 150, lastCalibration: "2025-11-04" });
      for (let i = 1; i <= 3; i++) {
        n++;
        out.push({
          id: `${s.id}-IM-${i}`,
          siteId: s.id,
          role: i === 3 ? "commercial" : "industrial",
          tech: i === 3 ? "rotary" : "turbine",
          sizeMm: i === 3 ? 50 : 100,
          lastCalibration: i === 2 ? "2024-08-19" : "2026-01-22",
          customer: customers[n % customers.length],
        });
      }
    }
    if (s.type.startsWith("CNG")) {
      out.push({ id: `${s.id}-CM-1`, siteId: s.id, role: "cng-dispense", tech: "coriolis", sizeMm: 25, lastCalibration: s.id.endsWith("02") ? "2024-12-01" : "2026-02-15" });
    }
  }
  return out;
}

export const meters: Meter[] = buildMeters();

export const pipelineSegments: PipelineSegment[] = zones.flatMap((z) => [
  { id: `${z.id}-SEG-ST-01`, zoneId: z.id, name: `${z.name} steel ring main`, lengthKm: 38, material: "steel" as const, diameterMm: 300, pressureClass: "high" as const },
  { id: `${z.id}-SEG-ST-02`, zoneId: z.id, name: `${z.name} industrial spur`, lengthKm: 14, material: "steel" as const, diameterMm: 200, pressureClass: "high" as const },
  { id: `${z.id}-SEG-PE-01`, zoneId: z.id, name: `${z.name} MDPE network north`, lengthKm: 120, material: "MDPE" as const, diameterMm: 125, pressureClass: "medium" as const },
  { id: `${z.id}-SEG-PE-02`, zoneId: z.id, name: `${z.name} MDPE network south`, lengthKm: 96, material: "MDPE" as const, diameterMm: 90, pressureClass: "low" as const },
]);

export const vendorContracts: VendorContract[] = [
  { id: "AMC-CMP-ARIEL", vendor: "Kirloskar Pneumatic (Ariel packages)", scope: "Comprehensive AMC, CNG compressors", assetClass: "compressor", siteIds: sites.filter((s) => s.type.startsWith("CNG")).map((s) => s.id), startDate: "2025-04-01", endDate: "2027-03-31", annualValueInr: 42_000_000, slaResponseHours: 4, paymentCycle: "quarterly" },
  { id: "AMC-CMP-BAUER", vendor: "Bauer Kompressoren India", scope: "Non-comprehensive AMC, CNG compressors", assetClass: "compressor", siteIds: sites.filter((s) => s.type === "CNG_MOTHER" || s.type === "CNG_ONLINE").map((s) => s.id), startDate: "2024-10-01", endDate: "2026-11-30", annualValueInr: 18_500_000, slaResponseHours: 6, paymentCycle: "quarterly" },
  { id: "AMC-ELEC-ZONAL", vendor: "Voltech Electrical Services", scope: "Electrical O&M: transformers, panels, motors", assetClass: "transformer", siteIds: sites.map((s) => s.id), startDate: "2025-07-01", endDate: "2026-12-31", annualValueInr: 9_600_000, slaResponseHours: 8, paymentCycle: "monthly" },
  { id: "AMC-DSP-TATSUNO", vendor: "Tatsuno India", scope: "Dispenser calibration and repair", assetClass: "dispenser", siteIds: sites.filter((s) => s.type.startsWith("CNG")).map((s) => s.id), startDate: "2025-01-01", endDate: "2027-12-31", annualValueInr: 6_200_000, slaResponseHours: 12, paymentCycle: "monthly" },
  { id: "AMC-CGS-SKID", vendor: "Emerson Automation Solutions", scope: "CGS skid, odorisation, metering", assetClass: "pump", siteIds: sites.filter((s) => s.type === "CGS").map((s) => s.id), startDate: "2025-04-01", endDate: "2028-03-31", annualValueInr: 11_000_000, slaResponseHours: 6, paymentCycle: "quarterly" },
  { id: "AMC-HVAC", vendor: "Blue Star Ltd", scope: "Office HVAC and chillers", assetClass: "chiller", siteIds: sites.filter((s) => s.type === "OFFICE").map((s) => s.id), startDate: "2025-05-01", endDate: "2026-10-15", annualValueInr: 2_400_000, slaResponseHours: 24, paymentCycle: "monthly" },
];

export const siteById = new Map(sites.map((s) => [s.id, s]));
export const zoneById = new Map(zones.map((z) => [z.id, z]));
export const assetById = new Map(assets.map((a) => [a.id, a]));
export const meterById = new Map(meters.map((m) => [m.id, m]));

export const siteTypeLabel: Record<Site["type"], string> = {
  CGS: "City gate station",
  CNG_MOTHER: "CNG mother station",
  CNG_ONLINE: "CNG online station",
  CNG_DB: "CNG daughter booster",
  OFFICE: "Office",
};
