import "server-only";
import { parseWindow } from "../analytics/common";
import type { ModuleKey } from "../auth/rbac";
import { siteById, zoneById } from "../domain/master";
import type { Scope, WindowKey } from "../domain/types";
import { ensureAgentsBootstrapped } from "./agents";
import { requireModule, scopeFor } from "./session";
import type { User } from "./users";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export interface PageContext {
  user: User;
  scope: Scope;
  windowKey: WindowKey;
  filter: { zone?: string; site?: string };
  params: Record<string, string | undefined>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Guard + scope resolution shared by every module page. */
export async function pageContext(module: ModuleKey, searchParams: SearchParams): Promise<PageContext> {
  const user = await requireModule(module);
  await ensureAgentsBootstrapped();
  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) params[k] = first(v);
  const zone = params.zone && zoneById.has(params.zone) ? params.zone : undefined;
  let site = params.site && siteById.has(params.site) ? params.site : undefined;
  if (site && zone && siteById.get(site)?.zoneId !== zone) site = undefined;
  const filter = { zone, site };
  return { user, scope: scopeFor(user, filter), windowKey: parseWindow(params.window), filter, params };
}
