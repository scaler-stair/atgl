import type { Metadata } from "next";
import { Panel, PageHeader, TableWrap, Tag } from "@/components/ui";
import { ROLE_LABEL, ROLE_SUMMARY, ROLES } from "@/lib/auth/rbac";
import { sites, zoneById } from "@/lib/domain/master";
import { ago, date } from "@/lib/format";
import { isLocked } from "@/lib/server/admin";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { listUsers } from "@/lib/server/users";
import { CreateUserForm, UserRowActions } from "./UserForms";

export const metadata: Metadata = { title: "Users and roles" };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const { user: me } = await pageContext("admin-users", searchParams);
  const users = await listUsers();
  const roles = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const siteOptions = sites.map((s) => ({ id: s.id, name: s.name, zone: zoneById.get(s.zoneId)?.name ?? s.zoneId }));
  const active = users.filter((u) => u.status === "active").length;

  return (
    <>
      <PageHeader
        title="Users and roles"
        description="Named accounts only. New and reset accounts get a one-time temporary password and must set their own at first sign-in. Every change here is written to the audit log."
      />

      <Panel title="Users" description={`${users.length} accounts, ${active} active`} bodyClass="p-4">
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Site scope</th>
                <th scope="col">Status</th>
                <th scope="col">Last login</th>
                <th scope="col">Password changed</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap">
                    <span className="font-semibold text-ink">{u.displayName}</span>
                    {u.id === me.id && <span className="ml-1.5 text-[12px] font-semibold text-brand">You</span>}
                    <span className="block text-[12px] text-ink-3">
                      {u.username}, {u.email}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{ROLE_LABEL[u.role]}</td>
                  <td className="max-w-56 text-[13px]">
                    {u.siteIds ? (
                      <span title={u.siteIds.join(", ")}>
                        {u.siteIds.length} site{u.siteIds.length === 1 ? "" : "s"}
                        <span className="block truncate text-[12px] text-ink-3">{u.siteIds.join(", ")}</span>
                      </span>
                    ) : (
                      "All sites"
                    )}
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <Tag tone={u.status === "active" ? "ok" : "neutral"}>{u.status === "active" ? "Active" : "Disabled"}</Tag>
                      {u.mustReset && <Tag tone="warn">Must reset</Tag>}
                      {isLocked(u) && <Tag tone="crit">Locked</Tag>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-[13px]">{u.lastLoginAt ? ago(u.lastLoginAt) : <span className="text-ink-3">Never</span>}</td>
                  <td className="whitespace-nowrap text-[13px]">{date(u.passwordChangedAt)}</td>
                  <td>
                    <UserRowActions user={{ id: u.id, username: u.username, role: u.role, siteIds: u.siteIds, status: u.status }} isSelf={u.id === me.id} roles={roles} sites={siteOptions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Create user" description="The temporary password is shown once after creation. Share it over an approved channel.">
          <CreateUserForm roles={roles} sites={siteOptions} />
        </Panel>

        <Panel title="Role matrix" description="What each role can see and where it stops. Server checks enforce this on every page and action." bodyClass="p-0">
          <ul>
            {ROLES.map((r) => (
              <li key={r} className="border-b border-line-2 px-4 py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{ROLE_LABEL[r]}</span>
                  <span className="text-[12px] text-ink-3">{users.filter((u) => u.role === r && u.status === "active").length} active</span>
                </div>
                <p className="mt-0.5 text-[13px] text-ink-2">{ROLE_SUMMARY[r].access}</p>
                <p className="text-[12.5px] text-ink-3">Restriction: {ROLE_SUMMARY[r].restriction}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
