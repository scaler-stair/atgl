import type { Metadata } from "next";
import Link from "next/link";
import { ROLE_LABEL } from "@/lib/auth/rbac";
import { NAV } from "@/lib/nav";
import { currentUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Access denied" };

export default async function DeniedPage({ searchParams }: { searchParams: Promise<{ module?: string | string[] }> }) {
  const raw = (await searchParams).module;
  const moduleKey = Array.isArray(raw) ? raw[0] : raw;
  const item = NAV.flatMap((g) => g.items).find((i) => i.module === moduleKey);
  const user = await currentUser();
  const what = item ? item.label : "this page";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
        <p className="text-[13px] font-semibold text-crit">Access denied</p>
        <h1 className="mt-1 font-display text-[26px] font-semibold leading-8 text-ink">You can&apos;t open {what}</h1>
        <p className="mt-2 text-[14px] text-ink-2">
          {user ? (
            <>
              Your role, <span className="font-semibold text-ink">{ROLE_LABEL[user.role]}</span>, does not include {what}.
            </>
          ) : (
            <>Your role does not include {what}.</>
          )}{" "}
          If you need it for your work, ask a platform admin to review your role. The attempt has not changed anything.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/" className="btn btn-primary">
            Go to overview
          </Link>
          <Link href="/sops" className="btn">
            Read the SOPs
          </Link>
        </div>
      </div>
    </main>
  );
}
