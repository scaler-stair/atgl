"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { acknowledgeAlertAction, closeAlertAction } from "@/app/actions/workflow";

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

export function AlertActions({ id, status, canAck, canClose }: { id: string; status: string; canAck: boolean; canClose: boolean }) {
  const qs = useSearchParams().toString();
  const [ackState, ack, acking] = useActionState(acknowledgeAlertAction, undefined);
  const [closeState, close, closing] = useActionState(closeAlertAction, undefined);
  if (status === "closed") return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {canAck && status === "open" && (
        <form action={ack} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="qs" value={qs} />
          <label className="block text-[12.5px] font-semibold text-ink" htmlFor={`note-${id}`}>
            Acknowledge
          </label>
          <input id={`note-${id}`} name="note" className="field" placeholder="Optional note, e.g. assigned to zonal O&M lead" maxLength={1000} />
          <div className="flex items-center gap-3">
            <button className="btn" disabled={acking}>
              {acking ? "Acknowledging…" : "Acknowledge alert"}
            </button>
            <Result state={ackState} />
          </div>
        </form>
      )}
      {canClose && (
        <form action={close} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="qs" value={qs} />
          <label className="block text-[12.5px] font-semibold text-ink" htmlFor={`action-${id}`}>
            Close with evidence
          </label>
          <input id={`action-${id}`} name="action" className="field" placeholder="Action taken" required minLength={5} maxLength={2000} />
          <input name="evidence" className="field" placeholder="Evidence, e.g. work order WO-1234 or inspection report ref" required minLength={3} maxLength={2000} />
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={closing}>
              {closing ? "Closing…" : "Close alert"}
            </button>
            <Result state={closeState} />
          </div>
        </form>
      )}
    </div>
  );
}
