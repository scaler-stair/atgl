"use client";

import { useActionState } from "react";
import { loginAction } from "../actions/auth";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="username" className="mb-1 block text-[13px] font-semibold text-ink">
          Username
        </label>
        <input id="username" name="username" className="field" autoComplete="username" autoCapitalize="none" required autoFocus />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-[13px] font-semibold text-ink">
          Password
        </label>
        <input id="password" name="password" type="password" className="field" autoComplete="current-password" required />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-md bg-crit-soft px-3 py-2 text-[13px] text-crit">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full justify-center py-2" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
