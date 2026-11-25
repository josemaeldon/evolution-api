import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [editingUser, setEditingUser] = useState<ManagerUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagerUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");

  const openEdit = (user: ManagerUser) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditActive(user.active);
    setEditPassword("");
  };

  const saveUser = async () => {
    if (!editingUser || busy) return;
    setBusy(true);
    try {
      await saasApi.patch(`/saas/users/${editingUser.id}`, {
        name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
        active: editActive,
        ...(editPassword ? { password: editPassword } : {}),
      });
      setEditingUser(null);
      await refresh();
      toast.success("Usuário atualizado");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await saasApi.delete(`/saas/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      await refresh();
      toast.success("Usuário excluído");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

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
        <form
          className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_150px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const response = await saasApi.post("/saas/companies", { name: companyName, maxInstances: companyLimit });
              setSelectedId(response.data.id);
              setCompanyName("");
              setCompanyLimit(1);
            }, "Empresa criada");
          }}>
          <Input aria-label="Nome da empresa" placeholder="Nome da empresa" required maxLength={255} value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          <Input aria-label="Limite de instâncias" type="number" min={0} required value={companyLimit} onChange={(event) => setCompanyLimit(Number(event.target.value))} />
          <Button type="submit" disabled={busy}>
            Criar empresa
          </Button>
        </form>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-2">
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              onClick={() => setSelectedId(company.id)}
              className={`w-full rounded-lg border p-3 text-left ${selectedId === company.id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
              <span className="block font-medium">{company.name}</span>
              <span className="text-xs text-muted-foreground">
                {company.instanceCount}/{company.maxInstances} instâncias · {company._count.users} usuários{company.active ? "" : " · Inativa"}
              </span>
            </button>
          ))}
        </aside>

        {selected && (
          <div className="min-w-0 space-y-6">
            <section className="space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              {superadmin && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="space-y-1 text-sm">
                    Nome da empresa
                    <Input defaultValue={selected.name} key={selected.id} id="company-name" className="min-w-48" />
                  </label>
                  <label className="space-y-1 text-sm">
                    Limite de instâncias
                    <Input type="number" min={selected.instanceCount} defaultValue={selected.maxInstances} key={selected.id} id="company-limit" className="w-36" />
                  </label>
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() =>
                      run(
                        () =>
                          saasApi.patch(`/saas/companies/${selected.id}`, {
                            name: (document.getElementById("company-name") as HTMLInputElement).value,
                            maxInstances: Number((document.getElementById("company-limit") as HTMLInputElement).value),
                          }),
                        "Empresa atualizada",
                      )
                    }>
                    Salvar
                  </Button>
                  <Button
                    disabled={busy}
                    variant={selected.active ? "destructive" : "outline"}
                    onClick={() => run(() => saasApi.patch(`/saas/companies/${selected.id}`, { active: !selected.active }), selected.active ? "Empresa desativada" : "Empresa ativada")}>
                    {selected.active ? "Desativar" : "Ativar"}
                  </Button>
                </div>
              )}
              {superadmin && (
                <div className="flex flex-wrap gap-3">
                  <select
                    aria-label="Instância sem empresa"
                    className="min-w-56 rounded-md border bg-background p-2 text-sm"
                    value={assignmentId}
                    onChange={(event) => setAssignmentId(event.target.value)}>
                    <option value="">Selecionar instância sem empresa</option>
                    {unassigned.map((instance) => (
                      <option key={instance.id} value={instance.id}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={busy || !assignmentId || selected.instanceCount >= selected.maxInstances}
                    onClick={() =>
                      run(async () => {
                        await saasApi.post(`/saas/companies/${selected.id}/instances/${assignmentId}`);
                        setAssignmentId("");
                      }, "Instância atribuída")
                    }>
                    Atribuir instância
                  </Button>
                </div>
              )}
              <div className="divide-y rounded-md border">
                {assigned.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhuma instância atribuída.</p>}
                {assigned.map((instance) => (
                  <div key={instance.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="truncate">
                      {instance.name} · {instance.connectionStatus}
                    </span>
                    {superadmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => run(() => saasApi.delete(`/saas/companies/${selected.id}/instances/${instance.id}`), "Instância desvinculada")}>
                        Desvincular
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Usuários</h2>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    await saasApi.post(`/saas/companies/${selected.id}/users`, { name: userName, email: userEmail, password: userPassword, role: userRole });
                    setUserName("");
                    setUserEmail("");
                    setUserPassword("");
                  }, "Usuário criado");
                }}>
                <Input aria-label="Nome" placeholder="Nome" required value={userName} onChange={(event) => setUserName(event.target.value)} />
                <Input aria-label="E-mail" placeholder="E-mail" type="email" required value={userEmail} onChange={(event) => setUserEmail(event.target.value)} />
                <Input
                  aria-label="Senha"
                  placeholder="Senha inicial (mín. 10 caracteres)"
                  type="password"
                  minLength={10}
                  required
                  value={userPassword}
                  onChange={(event) => setUserPassword(event.target.value)}
                />
                <select aria-label="Perfil" className="rounded-md border bg-background p-2 text-sm" value={userRole} onChange={(event) => setUserRole(event.target.value as "admin" | "user")}>
                  <option value="user">Usuário · somente chat</option>
                  <option value="admin">Administrador · instâncias e usuários</option>
                </select>
                <Button type="submit" disabled={busy} className="sm:col-span-2">
                  Adicionar usuário
                </Button>
              </form>
              <div className="divide-y">
                {users.map((user) => (
                  <div key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {user.name} <span className="text-xs text-muted-foreground">({user.role === "admin" ? "Administrador" : "Chat"})</span>
                      </p>
                      <p className="break-all text-sm text-muted-foreground">{user.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => openEdit(user)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy || user.id === account?.id} onClick={() => setDeleteTarget(user)}>
                        Excluir
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
      <Dialog
        open={!!editingUser}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
            <DialogDescription>Atualize os dados e permissões do usuário.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveUser();
            }}>
            <Input aria-label="Nome do usuário" required maxLength={255} value={editName} onChange={(event) => setEditName(event.target.value)} />
            <Input aria-label="E-mail do usuário" type="email" required value={editEmail} onChange={(event) => setEditEmail(event.target.value)} />
            <select
              aria-label="Perfil do usuário"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={editRole}
              disabled={editingUser?.id === account?.id}
              onChange={(event) => setEditRole(event.target.value as "admin" | "user")}>
              <option value="user">Usuário · somente chat</option>
              <option value="admin">Administrador · instâncias e usuários</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editActive} disabled={editingUser?.id === account?.id} onChange={(event) => setEditActive(event.target.checked)} /> Usuário ativo
            </label>
            <Input
              aria-label="Nova senha"
              type="password"
              minLength={10}
              placeholder="Nova senha (opcional, mín. 10 caracteres)"
              value={editPassword}
              onChange={(event) => setEditPassword(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Salvar alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
            <DialogDescription>Excluir {deleteTarget?.name} e encerrar suas sessões? Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => deleteUser()}>
              Excluir usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
