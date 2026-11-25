import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { Input } from "@/components/ui/input";
import { ManagerCompany, ManagerUser, saasApi, UnassignedInstance, useManagerAccount } from "@/lib/queries/saas";

const errorMessage = (error: unknown) => {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }
  return "Não foi possível salvar. Tente novamente.";
};

export default function Companies() {
  const queryClient = useQueryClient();
  const { data: account } = useManagerAccount();
  const superadmin = account?.role === "superadmin";
  const [selectedId, setSelectedId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyLimit, setCompanyLimit] = useState(1);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<"admin" | "user">("user");
  const [assignmentId, setAssignmentId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: companies = [] } = useQuery<ManagerCompany[]>({
    queryKey: ["saas", "companies"],
    queryFn: async () => (await saasApi.get("/saas/companies")).data,
    enabled: account?.role === "admin" || superadmin,
  });
  useEffect(() => {
    if (!selectedId && companies.length) setSelectedId(companies[0].id);
  }, [companies, selectedId]);
  const selected = companies.find((company) => company.id === selectedId);
  const { data: users = [] } = useQuery<ManagerUser[]>({
    queryKey: ["saas", "users", selectedId],
    queryFn: async () => (await saasApi.get(`/saas/companies/${selectedId}/users`)).data,
    enabled: !!selectedId && (account?.role === "admin" || superadmin),
  });
  const { data: unassigned = [] } = useQuery<UnassignedInstance[]>({
    queryKey: ["saas", "unassigned"],
    queryFn: async () => (await saasApi.get("/saas/unassigned-instances")).data,
    enabled: superadmin,
  });
  const { data: assigned = [] } = useQuery<UnassignedInstance[]>({
    queryKey: ["saas", "assigned", selectedId],
    queryFn: async () => (await saasApi.get(`/saas/companies/${selectedId}/instances`)).data,
    enabled: !!selectedId && (account?.role === "admin" || superadmin),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["saas"] });
    await queryClient.invalidateQueries({ queryKey: ["instance"] });
  };
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (account?.role === "user") return <p>Acesso restrito.</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{superadmin ? "Empresas e usuários" : "Usuários da empresa"}</h1>
        <p className="text-sm text-muted-foreground">Gerencie o acesso e o limite de instâncias de cada empresa.</p>
      </div>

      {superadmin && (
        <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_150px_auto]" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const response = await saasApi.post("/saas/companies", { name: companyName, maxInstances: companyLimit });
            setSelectedId(response.data.id);
            setCompanyName("");
            setCompanyLimit(1);
          }, "Empresa criada");
        }}>
          <Input aria-label="Nome da empresa" placeholder="Nome da empresa" required maxLength={255} value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          <Input aria-label="Limite de instâncias" type="number" min={0} required value={companyLimit} onChange={(event) => setCompanyLimit(Number(event.target.value))} />
          <Button type="submit" disabled={busy}>Criar empresa</Button>
        </form>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-2">
          {companies.map((company) => (
            <button key={company.id} type="button" onClick={() => setSelectedId(company.id)} className={`w-full rounded-lg border p-3 text-left ${selectedId === company.id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
              <span className="block font-medium">{company.name}</span>
              <span className="text-xs text-muted-foreground">{company.instanceCount}/{company.maxInstances} instâncias · {company._count.users} usuários{company.active ? "" : " · Inativa"}</span>
            </button>
          ))}
        </aside>

        {selected && (
          <div className="min-w-0 space-y-6">
            <section className="space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              {superadmin && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="space-y-1 text-sm">Nome da empresa
                    <Input defaultValue={selected.name} key={selected.id} id="company-name" className="min-w-48" />
                  </label>
                  <label className="space-y-1 text-sm">Limite de instâncias
                    <Input type="number" min={selected.instanceCount} defaultValue={selected.maxInstances} key={selected.id} id="company-limit" className="w-36" />
                  </label>
                  <Button disabled={busy} variant="outline" onClick={() => void run(
                    () => saasApi.patch(`/saas/companies/${selected.id}`, {
                      name: (document.getElementById("company-name") as HTMLInputElement).value,
                      maxInstances: Number((document.getElementById("company-limit") as HTMLInputElement).value),
                    }),
                    "Empresa atualizada",
                  )}>Salvar</Button>
                  <Button disabled={busy} variant={selected.active ? "destructive" : "outline"} onClick={() => void run(
                    () => saasApi.patch(`/saas/companies/${selected.id}`, { active: !selected.active }),
                    selected.active ? "Empresa desativada" : "Empresa ativada",
                  )}>{selected.active ? "Desativar" : "Ativar"}</Button>
                </div>
              )}
              {superadmin && (
                <div className="flex flex-wrap gap-3">
                  <select aria-label="Instância sem empresa" className="min-w-56 rounded-md border bg-background p-2 text-sm" value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
                    <option value="">Selecionar instância sem empresa</option>
                    {unassigned.map((instance) => <option key={instance.id} value={instance.id}>{instance.name}</option>)}
                  </select>
                  <Button disabled={busy || !assignmentId || selected.instanceCount >= selected.maxInstances} onClick={() => void run(async () => {
                    await saasApi.post(`/saas/companies/${selected.id}/instances/${assignmentId}`);
                    setAssignmentId("");
                  }, "Instância atribuída")}>Atribuir instância</Button>
                </div>
              )}
              <div className="divide-y rounded-md border">
                {assigned.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhuma instância atribuída.</p>}
                {assigned.map((instance) => (
                  <div key={instance.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="truncate">{instance.name} · {instance.connectionStatus}</span>
                    {superadmin && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(
                      () => saasApi.delete(`/saas/companies/${selected.id}/instances/${instance.id}`),
                      "Instância desvinculada",
                    )}>Desvincular</Button>}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Usuários</h2>
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await saasApi.post(`/saas/companies/${selected.id}/users`, { name: userName, email: userEmail, password: userPassword, role: userRole });
                  setUserName("");
                  setUserEmail("");
                  setUserPassword("");
                }, "Usuário criado");
              }}>
                <Input aria-label="Nome" placeholder="Nome" required value={userName} onChange={(event) => setUserName(event.target.value)} />
                <Input aria-label="E-mail" placeholder="E-mail" type="email" required value={userEmail} onChange={(event) => setUserEmail(event.target.value)} />
                <Input aria-label="Senha" placeholder="Senha inicial (mín. 10 caracteres)" type="password" minLength={10} required value={userPassword} onChange={(event) => setUserPassword(event.target.value)} />
                <select aria-label="Perfil" className="rounded-md border bg-background p-2 text-sm" value={userRole} onChange={(event) => setUserRole(event.target.value as "admin" | "user")}>
                  <option value="user">Usuário · somente chat</option>
                  <option value="admin">Administrador · instâncias e usuários</option>
                </select>
                <Button type="submit" disabled={busy} className="sm:col-span-2">Adicionar usuário</Button>
              </form>
              <div className="divide-y">
                {users.map((user) => (
                  <div key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{user.name} <span className="text-xs text-muted-foreground">({user.role === "admin" ? "Administrador" : "Chat"})</span></p>
                      <p className="break-all text-sm text-muted-foreground">{user.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <select aria-label={`Perfil de ${user.name}`} className="rounded-md border bg-background p-2 text-sm" value={user.role} disabled={busy || user.id === account?.id} onChange={(event) => void run(
                        () => saasApi.patch(`/saas/users/${user.id}`, { role: event.target.value }),
                        "Perfil atualizado",
                      )}>
                        <option value="user">Chat</option>
                        <option value="admin">Administrador</option>
                      </select>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                        const password = window.prompt("Nova senha (mínimo de 10 caracteres):");
                        if (password) void run(() => saasApi.patch(`/saas/users/${user.id}`, { password }), "Senha alterada");
                      }}>Redefinir senha</Button>
                      <Button size="sm" variant={user.active ? "destructive" : "outline"} disabled={busy || user.id === account?.id} onClick={() => void run(
                        () => saasApi.patch(`/saas/users/${user.id}`, { active: !user.active }),
                        user.active ? "Usuário desativado" : "Usuário ativado",
                      )}>{user.active ? "Desativar" : "Ativar"}</Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
