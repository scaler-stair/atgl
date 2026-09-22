"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions/auth";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label htmlFor="current" className="mb-1 block text-[13px] font-semibold text-ink">
          Current password
        </label>
        <input id="current" name="current" type="password" className="field" autoComplete="current-password" required autoFocus />
      </div>
      <div>
        <label htmlFor="next" className="mb-1 block text-[13px] font-semibold text-ink">
          New password
        </label>
        <input id="next" name="next" type="password" className="field" autoComplete="new-password" required minLength={12} aria-describedby="pw-policy" />
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-[13px] font-semibold text-ink">
          Confirm new password
        </label>
        <input id="confirm" name="confirm" type="password" className="field" autoComplete="new-password" required minLength={12} />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-md bg-crit-soft px-3 py-2 text-[13px] text-crit">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full justify-center py-2" disabled={pending}>
        {pending ? "Changing password…" : "Change password"}
      </button>
    </form>
  );
}
