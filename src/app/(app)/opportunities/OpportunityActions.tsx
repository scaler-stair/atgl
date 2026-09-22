"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { updateOpportunityAction, validateOpportunityAction } from "@/app/actions/workflow";

const EDITABLE_STATUSES = [
  { key: "identified", label: "Identified" },
  { key: "under-review", label: "Under review" },
  { key: "in-progress", label: "In progress" },
  { key: "implemented", label: "Implemented" },
  { key: "rejected", label: "Rejected" },
];

function Result({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (!state) return null;
  return state.error ? (
    <p role="alert" className="text-[12.5px] text-crit">
      {state.error}
    </p>
  ) : (
    <p role="status" className="text-[12.5px] font-semibold text-ok">
      {state.ok}
    </p>
  );
}

export function EditOpportunity({ id, status, ownerId, owners }: { id: string; status: string; ownerId: string | null; owners: { id: string; name: string; role: string }[] }) {
  const qs = useSearchParams().toString();
  const [state, action, pending] = useActionState(updateOpportunityAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="qs" value={qs} />
      <div>
        <label htmlFor={`st-${id}`} className="mb-1 block text-[12.5px] font-semibold text-ink">
          Status
        </label>
        <select id={`st-${id}`} name="status" defaultValue={status === "approved" ? "" : status} className="field w-44">
          {status === "approved" && <option value="">Approved (keep)</option>}
          {EDITABLE_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`ow-${id}`} className="mb-1 block text-[12.5px] font-semibold text-ink">
          Owner
        </label>
        <select id={`ow-${id}`} name="ownerId" defaultValue={ownerId ?? "none"} className="field w-56">
          <option value="none">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.role})
            </option>
          ))}
        </select>
      </div>
      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function ValidateOpportunity({ id, suggested }: { id: string; suggested: number }) {
  const qs = useSearchParams().toString();
  const [state, action, pending] = useActionState(validateOpportunityAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="qs" value={qs} />
      <div>
        <label htmlFor={`val-${id}`} className="mb-1 block text-[12.5px] font-semibold text-ink">
          Validated annual value (₹)
        </label>
        <input id={`val-${id}`} name="value" inputMode="numeric" defaultValue={suggested} className="field w-48" required />
      </div>
      <label className="flex items-center gap-2 pb-2 text-[13px] text-ink">
        <input type="checkbox" name="approve" /> Approve for implementation
      </label>
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Validating…" : "Validate value"}
      </button>
      <Result state={state} />
    </form>
  );
}
