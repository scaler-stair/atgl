"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/server/audit";
import { requireAction } from "@/lib/server/session";
import { getUser } from "@/lib/server/users";
import { acknowledgeAlert, closeAlert, getOpportunity, OPP_STATUSES, updateOpportunity, validateOpportunity, type OppStatus } from "@/lib/server/workflow";

export type ActionState = { error?: string; ok?: string } | undefined;

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * After a successful change, return to the same list with a confirmation. The
 * changed item may leave the current filter, so the message is carried in the
 * URL rather than in the form's own state.
 */
function back(path: string, form: FormData, patch: Record<string, string>): never {
  const q = new URLSearchParams(s(form, "qs"));
  q.delete("done");
  q.delete("focus");
  for (const [k, v] of Object.entries(patch)) q.set(k, v);
  redirect(`${path}?${q.toString()}`);
}

export async function acknowledgeAlertAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = s(form, "id");
    const user = await requireAction("alert.acknowledge", id);
    const { before, after } = await acknowledgeAlert(id, user, s(form, "note").slice(0, 1000));
    await audit({ actorId: user.id, actorName: user.displayName, action: "alert.acknowledge", targetType: "alert", targetId: id, before: { status: before.status }, after: { status: after.status, note: after.actionNote } });
    revalidatePath("/alerts");
  } catch (e) {
    return { error: (e as Error).message };
  }
  back("/alerts", form, { status: "acknowledged", focus: s(form, "id"), done: "acknowledged" });
}

export async function closeAlertAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = s(form, "id");
    const user = await requireAction("alert.close", id);
    const { before, after } = await closeAlert(id, user, s(form, "action").slice(0, 2000), s(form, "evidence").slice(0, 2000));
    await audit({ actorId: user.id, actorName: user.displayName, action: "alert.close", targetType: "alert", targetId: id, before: { status: before.status }, after: { status: after.status, action: after.actionNote, evidence: after.closureEvidence } });
    revalidatePath("/alerts");
  } catch (e) {
    return { error: (e as Error).message };
  }
  back("/alerts", form, { status: "closed", focus: s(form, "id"), done: "closed" });
}

export async function updateOpportunityAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = s(form, "id");
    const user = await requireAction("opportunity.edit", id);
    const status = s(form, "status") as OppStatus;
    if (status && !OPP_STATUSES.includes(status)) throw new Error("Choose a valid status.");
    if (status === "approved") throw new Error("Leadership approves opportunities when validating their value.");
    const owner = s(form, "ownerId");
    if (owner && owner !== "none" && !await getUser(owner)) throw new Error("Choose an owner from the list.");
    const { before, after } = await updateOpportunity(id, user, { status: status || undefined, ownerId: owner ? (owner === "none" ? null : owner) : undefined });
    await audit({ actorId: user.id, actorName: user.displayName, action: "opportunity.update", targetType: "opportunity", targetId: id, before: { status: before.status, ownerId: before.ownerId }, after: { status: after.status, ownerId: after.ownerId } });
    revalidatePath("/opportunities");
  } catch (e) {
    return { error: (e as Error).message };
  }
  back("/opportunities", form, { focus: s(form, "id"), done: "updated" });
}

export async function validateOpportunityAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let approved = false;
  try {
    const id = s(form, "id");
    const user = await requireAction("opportunity.validate", id);
    const value = Number(s(form, "value").replace(/[,₹\s]/g, ""));
    if (!Number.isFinite(value) || value < 0) throw new Error("Enter the validated annual value in rupees, for example 1250000.");
    const { before } = await validateOpportunity(id, user, value);
    const after = form.get("approve") === "on" ? (await updateOpportunity(id, user, { status: "approved" })).after : (await getOpportunity(id))!;
    await audit({ actorId: user.id, actorName: user.displayName, action: "opportunity.validate", targetType: "opportunity", targetId: id, before: { validation: before.validation, impactInr: before.impactInr }, after: { validation: after.validation, validatedValueInr: after.validatedValueInr, status: after.status } });
    revalidatePath("/opportunities");
    approved = after.status === "approved";
  } catch (e) {
    return { error: (e as Error).message };
  }
  back("/opportunities", form, { focus: s(form, "id"), done: approved ? "approved" : "validated" });
}
