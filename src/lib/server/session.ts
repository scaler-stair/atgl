import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { config } from "../config";
import { verifyPassword } from "../auth/password";
import { can, canView, type Action, type ModuleKey } from "../auth/rbac";
import type { Scope } from "../domain/types";
import { audit, requestContext } from "./audit";
import { get, run } from "./db";
import { ensureSeedUsers, getUser, getUserRowByUsername, toUser, type User } from "./users";

export const SESSION_COOKIE = "atgl_session";
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type LoginResult = { ok: true; mustReset: boolean } | { ok: false; error: string };

export async function login(username: string, password: string): Promise<LoginResult> {
  await ensureSeedUsers();
  const ctx = await requestContext();
  const row = await getUserRowByUsername(username);
  const generic = "Username or password is incorrect.";
  if (!row) {
    await audit({ action: "auth.login", targetType: "user", targetId: username.slice(0, 64), outcome: "failure", after: { reason: "unknown user" } });
    return { ok: false, error: generic };
  }
  const now = Date.now();
  if (row.status !== "active") {
    await audit({ actorId: row.id, actorName: row.display_name, action: "auth.login", targetType: "user", targetId: row.id, outcome: "denied", after: { reason: "disabled" } });
    return { ok: false, error: "This account is disabled. Ask a platform admin to re-enable it." };
  }
  if (row.locked_until && row.locked_until > now) {
    await audit({ actorId: row.id, actorName: row.display_name, action: "auth.login", targetType: "user", targetId: row.id, outcome: "denied", after: { reason: "locked" } });
    return { ok: false, error: `Too many failed attempts. Try again after ${new Date(row.locked_until).toLocaleTimeString("en-IN")}.` };
  }
  if (!(await verifyPassword(password, row.password_hash))) {
    const attempts = row.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED ? now + LOCK_MINUTES * 60_000 : null;
    await run("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?", lock ? 0 : attempts, lock, row.id);
    await audit({ actorId: row.id, actorName: row.display_name, action: lock ? "auth.lockout" : "auth.login", targetType: "user", targetId: row.id, outcome: "failure", after: { attempts } });
    return { ok: false, error: generic };
  }
  const token = randomBytes(32).toString("base64url");
  const expires = now + config.sessionTtlHours * 3_600_000;
  await run("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)", hashToken(token), row.id, now, now, expires, ctx.ip, ctx.userAgent?.slice(0, 200) ?? null);
  await run("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", now, row.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expires),
  });
  await audit({ actorId: row.id, actorName: row.display_name, action: "auth.login", targetType: "user", targetId: row.id });
  return { ok: true, mustReset: !!row.must_reset };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const s = await get<{ user_id: string }>("SELECT user_id FROM sessions WHERE id = ?", hashToken(token));
    await run("DELETE FROM sessions WHERE id = ?", hashToken(token));
    if (s) {
      const u = await getUser(s.user_id);
      await audit({ actorId: s.user_id, actorName: u?.displayName, action: "auth.logout", targetType: "user", targetId: s.user_id });
    }
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeSessionsForUser(userId: string): Promise<void> {
  await run("DELETE FROM sessions WHERE user_id = ?", userId);
}

/** Resolve the current user; enforces absolute and idle session expiry. */
export const currentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);
  // Session and user in one round trip: the database may be a region away.
  const s = await get<Parameters<typeof toUser>[0] & { expires_at: number; last_seen_at: number }>(
    "SELECT u.*, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    id,
  );
  const now = Date.now();
  if (!s) return null;
  if (s.expires_at < now || now - s.last_seen_at > config.sessionIdleMinutes * 60_000) {
    await run("DELETE FROM sessions WHERE id = ?", id);
    return null;
  }
  const user = toUser(s);
  if (user.status !== "active") return null;
  // Touch the session without blocking the response.
  if (now - s.last_seen_at > 60_000) void run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", now, id).catch(() => undefined);
  return user;
});

/** Page guard: redirects to login, or to an access-denied page for the wrong role. */
export async function requireModule(module: ModuleKey): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustReset) redirect("/account/password");
  if (!canView(user.role, module)) {
    await audit({ actorId: user.id, actorName: user.displayName, action: "page.view", targetType: "module", targetId: module, outcome: "denied" });
    redirect(`/denied?module=${module}`);
  }
  return user;
}

export class AccessDenied extends Error {
  constructor(public action: string) {
    super(`Your role does not permit ${action}.`);
  }
}

/** Action guard for server actions and route handlers. Denials are audited. */
export async function requireAction(action: Action, targetId?: string): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AccessDenied(action);
  if (!can(user.role, action)) {
    await audit({ actorId: user.id, actorName: user.displayName, action, targetId, outcome: "denied" });
    throw new AccessDenied(action);
  }
  return user;
}

/** Build the data scope for a user, intersected with the requested zone/site filter. */
export function scopeFor(user: User, filter: { zone?: string; site?: string }): Scope {
  const allowed = user.siteIds;
  let siteId = filter.site || undefined;
  if (siteId && allowed && !allowed.includes(siteId)) siteId = undefined;
  return { zoneId: filter.zone || undefined, siteId, allowedSiteIds: allowed };
}

export function userCanSeeSite(user: User, siteId: string | null | undefined): boolean {
  if (!siteId || !user.siteIds) return true;
  return user.siteIds.includes(siteId);
}
