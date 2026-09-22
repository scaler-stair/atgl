import "server-only";
import { cache } from "react";
import type { Domain, Severity } from "../agents/definitions";
import type { Role } from "../auth/rbac";
import { siteById } from "../domain/master";
import type { Evidence } from "../domain/types";
import { all, get, parseJson, run } from "./db";
import type { User } from "./users";

/* ------------------------------ scoping ------------------------------ */

function inUserScope(user: User, siteId: string | null, zoneId: string | null): boolean {
  if (!user.siteIds) return true;
  if (siteId) return user.siteIds.includes(siteId);
  if (zoneId) return user.siteIds.some((s) => siteById.get(s)?.zoneId === zoneId);
  return true;
}

/** Site filter keeps site items plus zone-level items for that site's zone. */
function inFilter(f: { zone?: string; site?: string }, siteId: string | null, zoneId: string | null): boolean {
  const z = zoneId ?? (siteId ? siteById.get(siteId)?.zoneId : null);
  if (f.site) return siteId ? siteId === f.site : z === siteById.get(f.site)?.zoneId;
  if (f.zone) return z === f.zone;
  return true;
}

/* ------------------------------ alerts ------------------------------ */

export type AlertStatus = "open" | "acknowledged" | "closed";

export interface Alert {
  id: string;
  domain: Domain;
  severity: Severity;
  siteId: string | null;
  zoneId: string | null;
  title: string;
  detail: string;
  evidence: Evidence;
  routeRole: Role;
  status: AlertStatus;
  sourceAgent: string;
  createdAt: number;
  lastSeenAt: number;
  ackBy: string | null;
  ackAt: number | null;
  closedBy: string | null;
  closedAt: number | null;
  actionNote: string | null;
  closureEvidence: string | null;
}

interface AlertRow {
  id: string; domain: string; severity: string; site_id: string | null; zone_id: string | null; title: string; detail: string;
  evidence_json: string; route_role: string; status: string; source_agent: string; created_at: number; last_seen_at: number;
  ack_by: string | null; ack_at: number | null; closed_by: string | null; closed_at: number | null; action_note: string | null; closure_evidence: string | null;
}

const toAlert = (r: AlertRow): Alert => ({
  id: r.id,
  domain: r.domain as Domain,
  severity: r.severity as Severity,
  siteId: r.site_id,
  zoneId: r.zone_id,
  title: r.title,
  detail: r.detail,
  evidence: parseJson(r.evidence_json, {} as Evidence),
  routeRole: r.route_role as Role,
  status: r.status as AlertStatus,
  sourceAgent: r.source_agent,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  ackBy: r.ack_by,
  ackAt: r.ack_at,
  closedBy: r.closed_by,
  closedAt: r.closed_at,
  actionNote: r.action_note,
  closureEvidence: r.closure_evidence,
});

const SEV_ORDER = "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

/** Loaded once per request: several panels read the same queue. */
const loadAlerts = cache(async () =>
  all<AlertRow>(`SELECT * FROM alerts ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, ${SEV_ORDER}, created_at DESC`),
);

export async function listAlerts(user: User, f: { zone?: string; site?: string; status?: string; domain?: string } = {}): Promise<Alert[]> {
  const rows = await loadAlerts();
  return rows
    .map(toAlert)
    .filter((a) => inUserScope(user, a.siteId, a.zoneId) && inFilter(f, a.siteId, a.zoneId))
    .filter((a) => (!f.status || f.status === "all" ? true : a.status === f.status))
    .filter((a) => (!f.domain ? true : a.domain === f.domain));
}

export async function getAlert(id: string): Promise<Alert | null> {
  const r = await get<AlertRow>("SELECT * FROM alerts WHERE id = ?", id);
  return r ? toAlert(r) : null;
}

export function assertAlertAccess(user: User, a: Alert): void {
  if (!inUserScope(user, a.siteId, a.zoneId)) throw new Error("This alert is outside your assigned sites.");
}

export async function acknowledgeAlert(id: string, user: User, note: string): Promise<{ before: Alert; after: Alert }> {
  const before = await getAlert(id);
  if (!before) throw new Error("Alert not found.");
  assertAlertAccess(user, before);
  if (before.status !== "open") throw new Error("Only open alerts can be acknowledged.");
  await run("UPDATE alerts SET status = 'acknowledged', ack_by = ?, ack_at = ?, action_note = ? WHERE id = ?", user.displayName, Date.now(), note || null, id);
  return { before, after: (await getAlert(id))! };
}

export async function closeAlert(id: string, user: User, action: string, evidence: string): Promise<{ before: Alert; after: Alert }> {
  const before = await getAlert(id);
  if (!before) throw new Error("Alert not found.");
  assertAlertAccess(user, before);
  if (before.status === "closed") throw new Error("Alert is already closed.");
  if (action.trim().length < 5 || evidence.trim().length < 3) throw new Error("Record the action taken and the closure evidence before closing.");
  const now = Date.now();
  await run(
    "UPDATE alerts SET status = 'closed', ack_by = COALESCE(ack_by, ?), ack_at = COALESCE(ack_at, ?), closed_by = ?, closed_at = ?, action_note = ?, closure_evidence = ? WHERE id = ?",
    user.displayName,
    now,
    user.displayName,
    now,
    action.trim(),
    evidence.trim(),
    id,
  );
  return { before, after: (await getAlert(id))! };
}

/* --------------------------- opportunities --------------------------- */

export const OPP_STATUSES = ["identified", "under-review", "approved", "in-progress", "implemented", "rejected"] as const;
export type OppStatus = (typeof OPP_STATUSES)[number];

export interface Opportunity {
  id: string;
  domain: Domain;
  title: string;
  siteId: string | null;
  zoneId: string | null;
  impactInr: number;
  impactBasis: string;
  recommendation: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerRole: Role | null;
  evidence: Evidence;
  status: OppStatus;
  validation: "indicative" | "validated";
  validatedBy: string | null;
  validatedAt: number | null;
  validatedValueInr: number | null;
  sourceAgent: string;
  createdAt: number;
  updatedAt: number;
}

interface OppRow {
  id: string; domain: string; title: string; site_id: string | null; zone_id: string | null; impact_inr: number; impact_basis: string; recommendation: string;
  owner_id: string | null; owner_name: string | null; owner_role: string | null; evidence_json: string; status: string; validation: string; validated_by: string | null;
  validated_at: number | null; validated_value_inr: number | null; source_agent: string; created_at: number; updated_at: number;
}

const toOpp = (r: OppRow): Opportunity => ({
  id: r.id,
  domain: r.domain as Domain,
  title: r.title,
  siteId: r.site_id,
  zoneId: r.zone_id,
  impactInr: r.impact_inr,
  impactBasis: r.impact_basis,
  recommendation: r.recommendation,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  ownerRole: r.owner_role as Role | null,
  evidence: parseJson(r.evidence_json, {} as Evidence),
  status: r.status as OppStatus,
  validation: r.validation as Opportunity["validation"],
  validatedBy: r.validated_by,
  validatedAt: r.validated_at,
  validatedValueInr: r.validated_value_inr,
  sourceAgent: r.source_agent,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const OPP_SELECT = "SELECT o.*, u.display_name AS owner_name FROM opportunities o LEFT JOIN users u ON u.id = o.owner_id";

const loadOpportunities = cache(async () => all<OppRow>(`${OPP_SELECT} ORDER BY o.impact_inr DESC`));

export async function listOpportunities(user: User, f: { zone?: string; site?: string; domain?: string; status?: string } = {}): Promise<Opportunity[]> {
  const rows = await loadOpportunities();
  return rows
    .map(toOpp)
    .filter((o) => inUserScope(user, o.siteId, o.zoneId) && inFilter(f, o.siteId, o.zoneId))
    .filter((o) => (!f.domain ? true : o.domain === f.domain))
    .filter((o) => (!f.status ? true : o.status === f.status));
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const r = await get<OppRow>(`${OPP_SELECT} WHERE o.id = ?`, id);
  return r ? toOpp(r) : null;
}

export async function updateOpportunity(id: string, user: User, patch: { status?: OppStatus; ownerId?: string | null }): Promise<{ before: Opportunity; after: Opportunity }> {
  const before = await getOpportunity(id);
  if (!before) throw new Error("Opportunity not found.");
  if (!inUserScope(user, before.siteId, before.zoneId)) throw new Error("This opportunity is outside your assigned sites.");
  if (patch.status === "approved" && before.validation !== "validated") throw new Error("Only validated opportunities can be approved. Ask leadership to validate the value first.");
  await run(
    "UPDATE opportunities SET status = COALESCE(?, status), owner_id = CASE WHEN ? = 1 THEN ? ELSE owner_id END, updated_at = ? WHERE id = ?",
    patch.status ?? null,
    patch.ownerId !== undefined ? 1 : 0,
    patch.ownerId ?? null,
    Date.now(),
    id,
  );
  return { before, after: (await getOpportunity(id))! };
}

export async function validateOpportunity(id: string, user: User, valueInr: number): Promise<{ before: Opportunity; after: Opportunity }> {
  const before = await getOpportunity(id);
  if (!before) throw new Error("Opportunity not found.");
  if (!(valueInr >= 0)) throw new Error("Enter the validated value in rupees.");
  await run(
    "UPDATE opportunities SET validation = 'validated', validated_by = ?, validated_at = ?, validated_value_inr = ?, status = CASE WHEN status = 'identified' THEN 'under-review' ELSE status END, updated_at = ? WHERE id = ?",
    user.displayName,
    Date.now(),
    Math.round(valueInr),
    Date.now(),
    id,
  );
  return { before, after: (await getOpportunity(id))! };
}

/* ---------------------------- data quality ---------------------------- */

export interface DqIssue {
  id: string;
  source: string;
  entity: string;
  kind: string;
  detail: string;
  severity: Severity;
  status: "open" | "assigned" | "resolved";
  ownerRole: string | null;
  ownerId: string | null;
  ownerName: string | null;
  resolution: string | null;
  detectedAt: number;
  lastSeenAt: number;
  resolvedAt: number | null;
}

const DQ_SELECT = "SELECT d.*, u.display_name AS owner_name FROM dq_issues d LEFT JOIN users u ON u.id = d.owner_id";

const toDq = (r: Record<string, unknown>): DqIssue => ({
  id: r.id as string,
  source: r.source as string,
  entity: r.entity as string,
  kind: r.kind as string,
  detail: r.detail as string,
  severity: r.severity as Severity,
  status: r.status as DqIssue["status"],
  ownerRole: r.owner_role as string | null,
  ownerId: r.owner_id as string | null,
  ownerName: r.owner_name as string | null,
  resolution: r.resolution as string | null,
  detectedAt: r.detected_at as number,
  lastSeenAt: r.last_seen_at as number,
  resolvedAt: r.resolved_at as number | null,
});

export async function listDqIssues(): Promise<DqIssue[]> {
  const rows = await all(`${DQ_SELECT} ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, ${SEV_ORDER.replace(/severity/g, "d.severity")}, d.detected_at DESC`);
  return rows.map(toDq);
}

export async function getDqIssue(id: string): Promise<DqIssue | null> {
  const r = await get(`${DQ_SELECT} WHERE d.id = ?`, id);
  return r ? toDq(r) : null;
}

export async function updateDqIssue(id: string, patch: { ownerId?: string; resolution?: string }): Promise<{ before: DqIssue; after: DqIssue }> {
  const before = await getDqIssue(id);
  if (!before) throw new Error("Issue not found.");
  if (patch.resolution !== undefined) {
    if (patch.resolution.trim().length < 5) throw new Error("Describe how the issue was resolved and its provenance.");
    await run("UPDATE dq_issues SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?", patch.resolution.trim(), Date.now(), id);
  } else if (patch.ownerId) {
    await run("UPDATE dq_issues SET status = 'assigned', owner_id = ? WHERE id = ?", patch.ownerId, id);
  }
  return { before, after: (await getDqIssue(id))! };
}
