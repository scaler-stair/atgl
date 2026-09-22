"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/server/audit";
import { requireAction } from "@/lib/server/session";
import { getDqIssue, updateDqIssue } from "@/lib/server/workflow";

export type ActionState = { error?: string; ok?: string; secret?: string } | undefined;

export async function assignDqAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = String(form.get("id") ?? "");
    const user = await requireAction("dq.resolve", id);
    const issue = await getDqIssue(id);
    if (!issue) return { error: "Issue not found. Refresh the page and try again." };
    if (issue.status === "resolved") return { error: "This issue is already resolved." };
    const { before, after } = await updateDqIssue(id, { ownerId: user.id });
    await audit({ actorId: user.id, actorName: user.displayName, action: "dq.assign", targetType: "dq_issue", targetId: id, before, after });
    revalidatePath("/data-quality");
    return { ok: "Issue assigned to you." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function resolveDqAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = String(form.get("id") ?? "");
    const user = await requireAction("dq.resolve", id);
    const resolution = String(form.get("resolution") ?? "").trim();
    if (resolution.length < 5) return { error: "Describe the fix and where the corrected data came from (at least 5 characters)." };
    const issue = await getDqIssue(id);
    if (!issue) return { error: "Issue not found. Refresh the page and try again." };
    if (issue.status === "resolved") return { error: "This issue is already resolved." };
    const { before, after } = await updateDqIssue(id, { resolution });
    await audit({ actorId: user.id, actorName: user.displayName, action: "dq.resolve", targetType: "dq_issue", targetId: id, before, after });
    revalidatePath("/data-quality");
    return { ok: "Issue resolved." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
