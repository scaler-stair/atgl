import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { currentUser } from "@/lib/server/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  const staging = config.appEnv !== "production";
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#14202c] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <PipelineMark />
        <div className="relative max-w-md">
          <p className="font-display text-[15px] font-semibold text-[#e79cc4]">{config.tenantName}</p>
          <h1 className="mt-2 font-display text-[44px] font-semibold leading-[1.05] tracking-tight">Observe, analyse, optimise. Never control.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            One read-only view of energy, gas balance, metering, asset health, billing, vendors and pipeline safety across the city gas network, with every number traceable to its source.
          </p>
        </div>
        <p className="relative text-[12px] text-white/50">STAIR Digital intelligence layer. OT/IT segregated; no operational write path.</p>
      </section>
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-[26px] font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-[13.5px] text-ink-2">Use your named ATGL account. Shared logins are not permitted.</p>
          <LoginForm next={next ?? "/"} />
          {staging && (
            <div className="mt-8 rounded-md border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-2">
              <p className="font-semibold text-warn">Staging environment, synthetic data</p>
              <p className="mt-1">
                Demo accounts: <code>admin</code>, <code>leadership</code>, <code>operations</code>, <code>engineering</code>, <code>finance</code>, <code>security</code>, <code>siteuser</code>, <code>viewer</code>. The password is the <code>DEMO_USER_PASSWORD</code> value in <code>.env.local</code>.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** Schematic of a gas network: city gate feeding stations along a ring main. */
function PipelineMark() {
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full opacity-[0.22]" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke="#3fb5b0" strokeWidth="2">
        <path d="M-20 520 H140 V300 H420 V620 H620" />
        <path d="M140 420 H300 V720" />
        <path d="M420 460 H560 V120" />
        <path d="M280 300 V80 H620" />
      </g>
      <g fill="#14202c" stroke="#e0579f" strokeWidth="2.5">
        <rect x="128" y="508" width="24" height="24" />
        <circle cx="420" cy="300" r="10" />
        <circle cx="300" cy="720" r="10" />
        <circle cx="560" cy="120" r="10" />
        <circle cx="280" cy="80" r="10" />
        <circle cx="420" cy="620" r="10" />
      </g>
    </svg>
  );
}
