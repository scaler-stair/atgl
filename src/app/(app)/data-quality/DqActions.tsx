"use client";

import { useActionState } from "react";
import { assignDqAction, resolveDqAction } from "@/app/actions/dq";

function Feedback({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p role="alert" className="mt-1.5 text-[12.5px] text-crit">{state.error}</p>;
  if (state?.ok) return <p role="status" className="mt-1.5 text-[12.5px] font-semibold text-ok">{state.ok}</p>;
  return null;
}

export function DqActions({ id, canAssign, resolved }: { id: string; canAssign: boolean; resolved: boolean }) {
  const [assignState, assign, assigning] = useActionState(assignDqAction, undefined);
  const [resolveState, resolve, resolving] = useActionState(resolveDqAction, undefined);
  if (resolved) {
    return resolveState?.ok ? <Feedback state={resolveState} /> : <span className="text-[12.5px] text-ink-3">Closed</span>;
  }
  return (
    <div className="min-w-56">
      {canAssign && (
        <form action={assign}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="btn px-2.5 py-1 text-[12.5px]" disabled={assigning}>
            {assigning ? "Assigning…" : "Assign to me"}
          </button>
        </form>
      )}
      <Feedback state={assignState} />
      <details className="mt-1.5">
        <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-brand">Resolve issue</summary>
        <form action={resolve} className="mt-1.5 space-y-1.5">
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`res-${id}`} className="block text-[12px] text-ink-2">
            What was fixed, and where the corrected data came from
          </label>
          <textarea id={`res-${id}`} name="resolution" className="field text-[13px]" rows={3} minLength={5} required placeholder="e.g. RTU link restored by O&M; gap left unfilled, flagged in historian" />
          <button type="submit" className="btn btn-primary px-2.5 py-1 text-[12.5px]" disabled={resolving}>
            {resolving ? "Resolving…" : "Resolve issue"}
          </button>
          <Feedback state={resolveState} />
        </form>
      </details>
    </div>
  );
}
