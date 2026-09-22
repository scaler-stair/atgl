"use client";

import { useActionState } from "react";
import { runAgentAction, runAllAgentsAction } from "@/app/actions/agents";

function Feedback({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p role="alert" className="mt-1.5 text-[12.5px] text-crit">{state.error}</p>;
  if (state?.ok) return <p role="status" className="mt-1.5 text-[12.5px] font-semibold text-ok">{state.ok}</p>;
  return null;
}

export function RunAgentButton({ agentId }: { agentId: string }) {
  const [state, action, pending] = useActionState(runAgentAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="agentId" value={agentId} />
      <button type="submit" className="btn px-2.5 py-1 text-[12.5px]" disabled={pending}>
        {pending ? "Running…" : "Run agent"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function RunAllButton() {
  const [state, action, pending] = useActionState(runAllAgentsAction, undefined);
  return (
    <form action={action} className="text-right">
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Running all agents…" : "Run all agents"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
