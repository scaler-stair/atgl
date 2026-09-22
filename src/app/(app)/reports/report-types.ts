export type ReportType = "management" | "exceptions" | "site" | "opportunities";

export const REPORT_TYPES: { key: ReportType; title: string; summary: string; contents: string[] }[] = [
  {
    key: "management",
    title: "Management summary",
    summary: "Headline position across every intelligence domain in scope.",
    contents: ["Compression energy and specific energy against benchmark", "Gas balance and unaccounted-for gas", "Metering, asset reliability, billing, vendors and safety headlines", "Open alerts and the opportunity register total"],
  },
  {
    key: "exceptions",
    title: "Exception pack",
    summary: "Everything that currently needs a decision or review.",
    contents: ["Open alerts by severity and routed role", "Billing exceptions awaiting review", "Meters in fault with revenue exposure"],
  },
  {
    key: "site",
    title: "Site report",
    summary: "One site in depth: energy, meters, assets, bills and alerts.",
    contents: ["Site energy and specific energy", "Meter health and calibration", "Asset health scores and open work orders", "Recent bills and open alerts for the site"],
  },
  {
    key: "opportunities",
    title: "Opportunity register extract",
    summary: "Opportunities identified by the agents with owner, status and validation.",
    contents: ["Indicative and validated value per year", "Owner, status and recommendation", "Evidence for each opportunity"],
  },
];

export function isReportType(v: string | undefined): v is ReportType {
  return REPORT_TYPES.some((r) => r.key === v);
}
