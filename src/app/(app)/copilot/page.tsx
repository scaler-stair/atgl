import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { COPILOT_PROMPT_VERSION } from "@/lib/ai/prompts";
import { config, geminiConfigured } from "@/lib/config";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { CopilotChat } from "./CopilotChat";

export const metadata: Metadata = { title: "Executive copilot" };

export default async function CopilotPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, scope, filter } = await pageContext("copilot", searchParams);
  return (
    <>
      <PageHeader
        title="Executive copilot"
        description="Ask cross-domain questions in plain language. Answers come only from the platform's approved data and always state the time window, scope, sources and calculation version."
      />
      <CopilotChat
        userName={user.displayName.split(" ")[0]}
        scopeLabel={scopeLabel(scope)}
        filter={filter}
        engine={geminiConfigured() ? `Gemini (${config.gemini.model})` : "Deterministic grounded responder"}
        promptVersion={COPILOT_PROMPT_VERSION}
      />
    </>
  );
}
