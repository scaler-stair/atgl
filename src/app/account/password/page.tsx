import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/auth/rbac";
import { date } from "@/lib/format";
import { currentUser } from "@/lib/server/session";
import { PasswordForm } from "./PasswordForm";

export const metadata: Metadata = { title: "Change password" };

export default async function PasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <h1 className="font-display text-[26px] font-semibold leading-8 text-ink">Change password</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Signed in as <span className="font-semibold text-ink">{user.displayName}</span> ({user.username}, {ROLE_LABEL[user.role]}). Last changed {date(user.passwordChangedAt)}.
        </p>
        {user.mustReset && (
          <div className="mt-4">
            <Notice tone="warn" title="Set your own password to continue">
              You signed in with a temporary password. Choose a new one before using the platform.
            </Notice>
          </div>
        )}
        <div className="mt-4 rounded-md border border-line-2 bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2" id="pw-policy">
          <p className="font-semibold text-ink">Password policy</p>
          <ul className="mt-1 list-disc pl-4">
            <li>At least 12 characters</li>
            <li>An uppercase and a lowercase letter</li>
            <li>A number and a symbol</li>
            <li>Different from your current password</li>
          </ul>
        </div>
        <PasswordForm />
        {!user.mustReset && (
          <p className="mt-4 text-center text-[13px]">
            <Link href="/" className="text-ink-2 hover:underline">
              Back to overview
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
