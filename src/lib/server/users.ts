import "server-only";
import { config } from "../config";
import { hashPassword } from "../auth/password";
import type { Role } from "../auth/rbac";
import { all, get, newId, parseJson, run } from "./db";

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: Role;
  /** null = all sites (tenant-wide roles). */
  siteIds: string[] | null;
  status: "active" | "disabled";
  mustReset: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  passwordChangedAt: number;
  createdAt: number;
  lastLoginAt: number | null;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: string;
  site_ids: string | null;
  password_hash: string;
  status: string;
  must_reset: number;
  failed_attempts: number;
  locked_until: number | null;
  password_changed_at: number;
  created_at: number;
  last_login_at: number | null;
}

export function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    role: r.role as Role,
    siteIds: parseJson<string[] | null>(r.site_ids, null),
    status: r.status as User["status"],
    mustReset: !!r.must_reset,
    failedAttempts: r.failed_attempts,
    lockedUntil: r.locked_until,
    passwordChangedAt: r.password_changed_at,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}

export async function getUserRowByUsername(username: string): Promise<UserRow | undefined> {
  return get<UserRow>("SELECT * FROM users WHERE username = ?", username.toLowerCase().trim());
}

export async function getUser(id: string): Promise<User | null> {
  const r = await get<UserRow>("SELECT * FROM users WHERE id = ?", id);
  return r ? toUser(r) : null;
}

export async function listUsers(): Promise<User[]> {
  return (await all<UserRow>("SELECT * FROM users ORDER BY role, display_name")).map(toUser);
}

export async function createUser(input: {
  username: string;
  displayName: string;
  email: string;
  role: Role;
  siteIds: string[] | null;
  password: string;
  mustReset: boolean;
}): Promise<User> {
  const id = newId("usr");
  const now = Date.now();
  await run(
    `INSERT INTO users (id, username, display_name, email, role, site_ids, password_hash, status, must_reset, password_changed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    id,
    input.username.toLowerCase().trim(),
    input.displayName,
    input.email,
    input.role,
    input.siteIds ? JSON.stringify(input.siteIds) : null,
    await hashPassword(input.password),
    input.mustReset ? 1 : 0,
    now,
    now,
  );
  return (await getUser(id))!;
}

/**
 * Staging/demo seed. Only runs against an empty users table and never in
 * production (production gets a single bootstrap admin that must reset).
 * All emails use the reserved example.com domain.
 */
const DEMO_USERS: { username: string; displayName: string; role: Role; siteIds: string[] | null }[] = [
  { username: "admin", displayName: "Platform Administrator", role: "platform_admin", siteIds: null },
  { username: "leadership", displayName: "Riya Mehta", role: "leadership", siteIds: null },
  { username: "operations", displayName: "Arjun Patel", role: "operations", siteIds: ["AHD-CGS-01", "AHD-MS-01", "AHD-OS-01", "AHD-OS-02", "AHD-OS-03", "AHD-DB-01", "AHD-DB-02", "AHD-OFF-01", "VAD-CGS-01", "VAD-MS-01", "VAD-OS-01", "VAD-OS-02", "VAD-DB-01", "VAD-OFF-01"] },
  { username: "engineering", displayName: "Kavya Iyer", role: "engineering", siteIds: null },
  { username: "finance", displayName: "Nikhil Shah", role: "finance", siteIds: null },
  { username: "security", displayName: "Sana Qureshi", role: "security", siteIds: null },
  { username: "siteuser", displayName: "Vikram Singh", role: "site_user", siteIds: ["FBD-MS-01", "FBD-OS-01"] },
  { username: "viewer", displayName: "Meera Joshi", role: "viewer", siteIds: null },
];

export const DEMO_PASSWORD_ENV = "DEMO_USER_PASSWORD";

export async function ensureSeedUsers(): Promise<void> {
  const count = Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM users"))?.n ?? 0);
  if (count > 0) return;
  if (config.appEnv === "production") {
    if (!config.bootstrapAdminPassword) {
      throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be set to initialise a production tenant.");
    }
    await createUser({ username: "admin", displayName: "Platform Administrator", email: "admin@example.com", role: "platform_admin", siteIds: null, password: config.bootstrapAdminPassword, mustReset: true });
    return;
  }
  const pw = process.env[DEMO_PASSWORD_ENV];
  if (!pw) throw new Error(`${DEMO_PASSWORD_ENV} must be set in .env.local to seed staging users.`);
  for (const u of DEMO_USERS) {
    await createUser({ ...u, email: `${u.username}@example.com`, password: pw, mustReset: false });
  }
}
