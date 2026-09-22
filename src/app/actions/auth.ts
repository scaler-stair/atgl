"use server";

import { redirect } from "next/navigation";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/server/audit";
import { get, run } from "@/lib/server/db";
import { currentUser, login, logout } from "@/lib/server/session";

export type FormState = { error?: string; ok?: string } | undefined;

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password." };
  const res = await login(username, password);
  if (!res.ok) return { error: res.error };
  const next = String(form.get("next") ?? "/");
  redirect(res.mustReset ? "/account/password" : next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const row = (await get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id))!;
  if (!(await verifyPassword(current, row.password_hash))) return { error: "Current password is incorrect." };
  if (next !== confirm) return { error: "The new passwords don't match." };
  if (next === current) return { error: "Choose a password you haven't used for this account." };
  const problems = passwordProblems(next);
  if (problems.length) return { error: `New password needs ${problems.join(", ")}.` };
  await run("UPDATE users SET password_hash = ?, must_reset = 0, password_changed_at = ? WHERE id = ?", await hashPassword(next), Date.now(), user.id);
  await audit({ actorId: user.id, actorName: user.displayName, action: "auth.password_change", targetType: "user", targetId: user.id });
  redirect("/");
}
