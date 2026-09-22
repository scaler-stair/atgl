"use client";

import { useActionState, useState } from "react";
import { changeRoleAction, createUserAction, resetPasswordAction, setUserStatusAction, type ActionState } from "@/app/actions/users";

export interface SiteOption {
  id: string;
  name: string;
  zone: string;
}
export interface RoleOption {
  value: string;
  label: string;
}

const SCOPABLE = ["operations", "site_user"];

function Feedback({ state }: { state: ActionState }) {
  if (state?.error)
    return (
      <p role="alert" className="mt-2 rounded-md bg-crit-soft px-3 py-2 text-[12.5px] text-crit">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <div role="status" className="mt-2 rounded-md bg-ok-soft px-3 py-2 text-[12.5px] text-ok">
        <p className="font-semibold">{state.ok}</p>
        {state.secret && (
          <p className="mt-1.5 text-ink">
            Temporary password:{" "}
            <code className="select-all rounded border border-line bg-surface px-1.5 py-0.5 text-[13px] font-semibold text-ink">{state.secret}</code>
          </p>
        )}
      </div>
    );
  return null;
}

function SitePicker({ sites, name, defaultSelected, disabled, idPrefix }: { sites: SiteOption[]; name: string; defaultSelected: string[]; disabled: boolean; idPrefix: string }) {
  const zones = [...new Set(sites.map((s) => s.zone))];
  return (
    <fieldset disabled={disabled} className={disabled ? "opacity-50" : ""}>
      <legend className="mb-1 text-[13px] font-semibold text-ink">Site scope</legend>
      <p className="mb-1.5 text-[12px] text-ink-2">
        {disabled ? "This role is tenant-wide and sees all sites." : "Select the sites this person may see. Leave empty for all sites (operations only)."}
      </p>
      <div className="max-h-48 overflow-auto rounded-md border border-line bg-surface px-3 py-2">
        {zones.map((z) => (
          <div key={z} className="mb-1.5 last:mb-0">
            <p className="text-[11.5px] font-semibold text-ink-3">{z}</p>
            <div className="grid gap-x-3 sm:grid-cols-2">
              {sites
                .filter((s) => s.zone === z)
                .map((s) => (
                  <label key={s.id} htmlFor={`${idPrefix}-${s.id}`} className="flex items-center gap-1.5 py-0.5 text-[12.5px] text-ink">
                    <input id={`${idPrefix}-${s.id}`} type="checkbox" name={name} value={s.id} defaultChecked={defaultSelected.includes(s.id)} />
                    <span className="truncate" title={s.name}>
                      {s.id} <span className="text-ink-3">{s.name}</span>
                    </span>
                  </label>
                ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function CreateUserForm({ roles, sites }: { roles: RoleOption[]; sites: SiteOption[] }) {
  const [state, action, pending] = useActionState(createUserAction, undefined);
  const [role, setRole] = useState("viewer");
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="nu-username" className="mb-1 block text-[13px] font-semibold text-ink">Username</label>
          <input id="nu-username" name="username" className="field" required pattern="[a-z][a-z0-9._\-]{2,31}" autoCapitalize="none" autoComplete="off" aria-describedby="nu-username-hint" />
          <p id="nu-username-hint" className="mt-0.5 text-[12px] text-ink-3">3 to 32 lowercase characters, starting with a letter</p>
        </div>
        <div>
          <label htmlFor="nu-name" className="mb-1 block text-[13px] font-semibold text-ink">Display name</label>
          <input id="nu-name" name="displayName" className="field" required minLength={2} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="nu-email" className="mb-1 block text-[13px] font-semibold text-ink">Work email</label>
          <input id="nu-email" name="email" type="email" className="field" required placeholder="name@example.com" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="nu-role" className="mb-1 block text-[13px] font-semibold text-ink">Role</label>
          <select id="nu-role" name="role" className="field" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>
      <SitePicker key={SCOPABLE.includes(role) ? "scoped" : "all"} sites={sites} name="siteIds" defaultSelected={[]} disabled={!SCOPABLE.includes(role)} idPrefix="nu" />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Creating user…" : "Create user"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function UserRowActions({
  user,
  isSelf,
  roles,
  sites,
}: {
  user: { id: string; username: string; role: string; siteIds: string[] | null; status: string };
  isSelf: boolean;
  roles: RoleOption[];
  sites: SiteOption[];
}) {
  const [statusState, statusAction, statusPending] = useActionState(setUserStatusAction, undefined);
  const [resetState, resetAction, resetPending] = useActionState(resetPasswordAction, undefined);
  const [roleState, roleAction, rolePending] = useActionState(changeRoleAction, undefined);
  const [role, setRole] = useState(user.role);
  const disabling = user.status === "active";
  return (
    <div className="min-w-44">
      <div className="flex flex-col items-start gap-1.5">
        {!(isSelf && disabling) && (
          <form
            action={statusAction}
            onSubmit={(e) => {
              if (disabling && !confirm(`Disable ${user.username}? They will be signed out immediately.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="status" value={disabling ? "disabled" : "active"} />
            <button type="submit" className="btn px-2.5 py-1 text-[12.5px]" disabled={statusPending}>
              {disabling ? "Disable user" : "Enable user"}
            </button>
          </form>
        )}
        <form
          action={resetAction}
          onSubmit={(e) => {
            if (!confirm(`Reset the password for ${user.username}? Their current password stops working and they are signed out.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={user.id} />
          <button type="submit" className="btn px-2.5 py-1 text-[12.5px]" disabled={resetPending}>
            {resetPending ? "Resetting…" : "Reset password"}
          </button>
        </form>
      </div>
      <Feedback state={statusState} />
      <Feedback state={resetState} />
      <details className="mt-1.5">
        <summary className="cursor-pointer select-none text-[12.5px] font-semibold text-brand">Change role or sites</summary>
        <form action={roleAction} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={user.id} />
          <div>
            <label htmlFor={`role-${user.id}`} className="mb-1 block text-[13px] font-semibold text-ink">Role</label>
            <select id={`role-${user.id}`} name="role" className="field" value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {isSelf && <input type="hidden" name="role" value={user.role} />}
          </div>
          <SitePicker key={SCOPABLE.includes(role) ? "scoped" : "all"} sites={sites} name="siteIds" defaultSelected={user.siteIds ?? []} disabled={!SCOPABLE.includes(role)} idPrefix={user.id} />
          <button type="submit" className="btn btn-primary px-2.5 py-1 text-[12.5px]" disabled={rolePending}>
            {rolePending ? "Saving…" : "Save role and sites"}
          </button>
          <Feedback state={roleState} />
        </form>
      </details>
    </div>
  );
}
