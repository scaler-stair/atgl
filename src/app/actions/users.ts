"use server";

import { revalidatePath } from "next/cache";
import { generateTemporaryPassword } from "@/lib/auth/password";
import { isRole, ROLE_LABEL, type Role } from "@/lib/auth/rbac";
import { siteById } from "@/lib/domain/master";
import { setTemporaryPassword, setUserRoleAndScope, setUserStatus, USERNAME_PATTERN, usernameTaken, userSnapshot } from "@/lib/server/admin";
import { audit } from "@/lib/server/audit";
import { requireAction, revokeSessionsForUser } from "@/lib/server/session";
import { createUser, getUser } from "@/lib/server/users";

export type ActionState = { error?: string; ok?: string; secret?: string } | undefined;

const SCOPABLE: Role[] = ["operations", "site_user"];

/** Validate role + site scope. Returns the stored scope (null = all sites) or an error message. */
function resolveScope(role: Role, raw: string[]): { siteIds: string[] | null } | { error: string } {
  const ids = [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
  const unknown = ids.filter((s) => !siteById.has(s));
  if (unknown.length) return { error: `Unknown site ID: ${unknown.join(", ")}. Pick sites from the list.` };
  if (role === "site_user" && ids.length === 0) return { error: "Site users must be scoped to at least one site. Select their sites." };
  if (!SCOPABLE.includes(role) && ids.length > 0) return { error: `${ROLE_LABEL[role]} is a tenant-wide role. Clear the site selection, or choose Operations or Site user.` };
  return { siteIds: ids.length ? ids : null };
}

async function target(form: FormData) {
  const id = String(form.get("id") ?? "");
  const u = await getUser(id);
  if (!u) throw new Error("User not found. Refresh the page and try again.");
  return u;
}

export async function createUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const admin = await requireAction("user.manage");
    const username = String(form.get("username") ?? "").trim().toLowerCase();
    const displayName = String(form.get("displayName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "");
    if (!USERNAME_PATTERN.test(username)) return { error: "Username must be 3 to 32 characters: start with a letter, then lowercase letters, numbers, dot, dash or underscore." };
    if (await usernameTaken(username)) return { error: `The username ${username} is already taken. Choose another.` };
    if (displayName.length < 2) return { error: "Enter the person's display name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid work email address." };
    if (!isRole(role)) return { error: "Choose a role." };
    const scope = resolveScope(role, form.getAll("siteIds").map(String));
    if ("error" in scope) return { error: scope.error };
    const temp = generateTemporaryPassword();
    const user = await createUser({ username, displayName, email, role, siteIds: scope.siteIds, password: temp, mustReset: true });
    await audit({ actorId: admin.id, actorName: admin.displayName, action: "user.create", targetType: "user", targetId: user.id, before: null, after: await userSnapshot(user.id) });
    revalidatePath("/admin/users");
    return { ok: `User ${username} created. Share this temporary password over an approved channel; it is shown only once and must be changed at first sign-in.`, secret: temp };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setUserStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const admin = await requireAction("user.manage");
    const u = await target(form);
    const status = String(form.get("status") ?? "");
    if (status !== "active" && status !== "disabled") return { error: "Unknown status." };
    if (status === "disabled" && u.id === admin.id) return { error: "You can't disable your own account. Ask another platform admin." };
    if (u.status === status) return { error: `This user is already ${status}.` };
    const before = await userSnapshot(u.id);
    await setUserStatus(u.id, status);
    if (status === "disabled") await revokeSessionsForUser(u.id);
    await audit({ actorId: admin.id, actorName: admin.displayName, action: status === "disabled" ? "user.disable" : "user.enable", targetType: "user", targetId: u.id, before, after: await userSnapshot(u.id) });
    revalidatePath("/admin/users");
    return { ok: status === "disabled" ? `User ${u.username} disabled and signed out.` : `User ${u.username} enabled.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function resetPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const admin = await requireAction("user.manage");
    const u = await target(form);
    const before = await userSnapshot(u.id);
    const temp = generateTemporaryPassword();
    await setTemporaryPassword(u.id, temp);
    await revokeSessionsForUser(u.id);
    await audit({ actorId: admin.id, actorName: admin.displayName, action: "user.reset_password", targetType: "user", targetId: u.id, before, after: await userSnapshot(u.id) });
    revalidatePath("/admin/users");
    return { ok: `Password reset for ${u.username} and their sessions were signed out. This temporary password is shown only once.`, secret: temp };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function changeRoleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const admin = await requireAction("user.manage");
    const u = await target(form);
    const role = String(form.get("role") ?? "");
    if (!isRole(role)) return { error: "Choose a role." };
    if (u.id === admin.id && role !== "platform_admin") return { error: "You can't remove your own admin role. Ask another platform admin." };
    const scope = resolveScope(role, form.getAll("siteIds").map(String));
    if ("error" in scope) return { error: scope.error };
    const before = await userSnapshot(u.id);
    await setUserRoleAndScope(u.id, role, scope.siteIds);
    await audit({ actorId: admin.id, actorName: admin.displayName, action: "user.role_change", targetType: "user", targetId: u.id, before, after: await userSnapshot(u.id) });
    revalidatePath("/admin/users");
    return { ok: `Role and site scope updated for ${u.username}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
