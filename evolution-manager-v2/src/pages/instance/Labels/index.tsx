import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";

import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { saasApi } from "@/lib/queries/saas";
import { useInstance } from "@/contexts/InstanceContext";

type Label = { id: string; name: string; color: string };
type Contact = { id: string; remoteJid: string; pushName?: string; customName?: string; birthDate?: string | null; labels: Label[] };
type Organization = { labels: Label[]; contacts: Contact[] };

const BIRTHDAY_LABEL_ID = "__birthdays_today__";
const toPickerDate = (date: string) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "");
const fromPickerDate = (date: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
};
const getLocalDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function ContactLabels() {
  const { instance } = useInstance();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const localDate = getLocalDate();
  const queryKey = ["contactOrganization", instance?.id];
  const { data, isLoading } = useQuery<Organization>({
    queryKey: [...queryKey, localDate],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instance?.id}/organization?date=${localDate}`)).data,
    enabled: !!instance?.id,
  });
  const labels = data?.labels || [];
  const contactName = (contact: Contact) => contact.customName?.trim() || contact.pushName?.trim() || contact.remoteJid.split("@")[0];
  const contacts = (data?.contacts || []).filter((contact) => `${contactName(contact)} ${contact.pushName || ""} ${contact.remoteJid}`.toLowerCase().includes(search.toLowerCase()));
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(contacts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageContacts = contacts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allVisibleSelected = pageContacts.length > 0 && pageContacts.every((contact) => selectedContactIds.includes(contact.id));

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const createLabel = async () => {
    if (!instance || !name.trim()) return;
    try {
      await saasApi.post(`/saas/instance/${instance.id}/labels`, { name: name.trim(), color });
      setName("");
      refresh();
      toast.success("Etiqueta criada");
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Não foi possível criar a etiqueta");
    }
  };
  const deleteLabel = async (labelId: string) => {
    if (!instance) return;
    try {
      await saasApi.delete(`/saas/instance/${instance.id}/labels/${labelId}`);
      refresh();
    } catch {
      toast.error("Não foi possível excluir a etiqueta");
    }
  };
  const updateContact = async (contact: Contact, patch: { labelIds?: string[]; birthDate?: string | null }) => {
    if (!instance) return;
    const currentLabels = patch.labelIds || contact.labels.map((label) => label.id);
    try {
      await saasApi.put(`/saas/instance/${instance.id}/contacts/${contact.id}/organization`, {
        ...(patch.labelIds !== undefined ? { labelIds: currentLabels } : {}),
        ...(patch.birthDate !== undefined ? { birthDate: patch.birthDate } : {}),
      });
      await refresh();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Não foi possível atualizar o contato");
    }
  };
  const assignSelectedContacts = async () => {
    if (!instance || !selectedLabelId || !selectedContactIds.length) return;
    setAssigning(true);
    try {
      await saasApi.post(`/saas/instance/${instance.id}/labels/${selectedLabelId}/contacts`, { contactIds: selectedContactIds });
      setSelectedContactIds([]);
      await refresh();
      toast.success(`Etiqueta atribuída a ${selectedContactIds.length} contato(s)`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Não foi possível atribuir a etiqueta");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Etiquetas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Organize seus contatos por assunto e encontre-os facilmente pelas etiquetas.</p>
      </header>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 font-semibold">Criar etiqueta</h2>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Nome da etiqueta" placeholder="Ex.: Clientes ativos" value={name} onChange={(event) => setName(event.target.value)} className="max-w-sm" maxLength={80} />
          <input aria-label="Cor da etiqueta" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-9 w-12 rounded border p-1" />
          <Button onClick={createLabel} disabled={!name.trim()}>
            <Plus className="mr-2 h-4 w-4" />
            Criar
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
            {labels.map((label) => (
            <span key={label.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm" style={{ borderColor: label.color, color: label.color }}>
              <Tag className="h-3.5 w-3.5" />
              {label.name}
                {label.id === BIRTHDAY_LABEL_ID ? (
                  <span className="text-xs">automática</span>
                ) : (
                  <button type="button" aria-label={`Excluir etiqueta ${label.name}`} onClick={() => deleteLabel(label.id)} className="opacity-70 hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
            </span>
          ))}
          {!labels.length && <p className="text-sm text-muted-foreground">Nenhuma etiqueta criada.</p>}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Contatos</h2>
          </div>
          <Input aria-label="Buscar contatos" placeholder="Buscar por nome ou número" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="max-w-sm" />
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-3">
          <span className="text-sm font-medium">Atribuir etiqueta aos contatos selecionados</span>
          <select
            aria-label="Etiqueta para atribuição em lote"
            value={selectedLabelId}
            onChange={(event) => setSelectedLabelId(event.target.value)}
            className="h-9 min-w-48 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Selecione uma etiqueta</option>
            {labels.filter((label) => label.id !== BIRTHDAY_LABEL_ID).map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
          </select>
          <Button onClick={assignSelectedContacts} disabled={assigning || !selectedLabelId || !selectedContactIds.length}>
            {assigning ? "Atribuindo…" : `Atribuir${selectedContactIds.length ? ` (${selectedContactIds.length})` : ""}`}
          </Button>
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando contatos…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="p-2">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os contatos desta página"
                      checked={allVisibleSelected}
                      onChange={(event) => setSelectedContactIds((current) => event.target.checked
                        ? [...new Set([...current, ...pageContacts.map((contact) => contact.id)])]
                        : current.filter((id) => !pageContacts.some((contact) => contact.id === id)))}
                    />
                  </th>
                  <th className="p-2">Contato</th>
                  <th className="p-2">Data de nascimento</th>
                  <th className="p-2">Etiquetas</th>
                </tr>
              </thead>
              <tbody>
                {pageContacts.map((contact) => (
                  <tr key={contact.id} className="border-b last:border-0">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${contactName(contact)}`}
                        checked={selectedContactIds.includes(contact.id)}
                        onChange={(event) => setSelectedContactIds((current) => event.target.checked
                          ? [...current, contact.id]
                          : current.filter((id) => id !== contact.id))}
                      />
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{contactName(contact)}</div>
                      <div className="text-xs text-muted-foreground">{contact.remoteJid.split("@")[0]}</div>
                    </td>
                    <td className="p-2">
                      <div className="w-44">
                        <DatePicker
                          id={`birth-date-${contact.id}`}
                          value={toPickerDate(contact.birthDate?.slice(0, 10) || "")}
                          onChange={(value) => updateContact(contact, { birthDate: fromPickerDate(value) || null })}
                        />
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        {labels.map((label) => (
                          <label key={label.id} className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={contact.labels.some((assigned) => assigned.id === label.id)}
                              disabled={label.id === BIRTHDAY_LABEL_ID}
                              title={label.id === BIRTHDAY_LABEL_ID ? "Etiqueta automática, atualizada a cada dia" : undefined}
                              onChange={(event) =>
                                updateContact(contact, {
                                  labelIds: event.target.checked
                                    ? [...contact.labels.map((assigned) => assigned.id), label.id]
                                    : contact.labels.filter((assigned) => assigned.id !== label.id).map((assigned) => assigned.id),
                                })
                              }
                            />
                            <span className="rounded px-1.5 py-0.5 text-xs" style={{ backgroundColor: `${label.color}20`, color: label.color }}>
                              {label.name}
                            </span>
                          </label>
                        ))}
                      </div>
                      {!labels.length && <span className="text-xs text-muted-foreground">Crie uma etiqueta acima</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!contacts.length && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</p>}
          </div>
        )}
        {!isLoading && contacts.length > pageSize && (
          <nav aria-label="Paginação dos contatos" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Mostrando {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, contacts.length)} de {contacts.length} contatos
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Anterior
              </Button>
              <span className="min-w-20 text-center text-sm">Página {currentPage} de {pageCount}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage >= pageCount}>
                Próxima <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </nav>
        )}
      </div>
    </section>
  );
}
