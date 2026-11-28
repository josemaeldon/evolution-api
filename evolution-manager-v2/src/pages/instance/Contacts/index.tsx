import { Avatar, AvatarFallback, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useInstance } from "@/contexts/InstanceContext";
import { api } from "@/lib/queries/api";
import { saasApi } from "@/lib/queries/saas";

type Contact = { id: string; remoteJid: string; pushName?: string; profilePicUrl?: string };
type Organization = { contacts: { id: string; remoteJid: string; birthDate?: string | null }[] };

const toPickerDate = (date: string) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "");
const fromPickerDate = (date: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
};
const getLocalDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function Contacts() {
  const { instance } = useInstance();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [saving, setSaving] = useState(false);
  const localDate = getLocalDate();

  const { data: contacts = [], isPending, isError } = useQuery<Contact[]>({
    queryKey: ["chats", "findContacts", instance?.name],
    queryFn: async () => (await api.post(`/chat/findContacts/${instance!.name}`, { where: {} }, { headers: { apikey: instance!.token } })).data,
    enabled: !!instance?.name,
  });
  const { data: organization } = useQuery<Organization>({
    queryKey: ["contactOrganization", instance?.id, localDate],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instance!.id}/organization?date=${localDate}`)).data,
    enabled: !!instance?.id,
  });

  const normalizedSearch = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const searchDigits = search.replace(/\D/g, "");
  const visibleContacts = contacts
    .filter((contact) => contact.remoteJid.endsWith("@s.whatsapp.net"))
    .filter((contact) =>
      !normalizedSearch ||
      (contact.pushName || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(normalizedSearch) ||
      (searchDigits.length > 0 && contact.remoteJid.split("@")[0].includes(searchDigits)),
    )
    .sort((a, b) => (a.pushName || a.remoteJid).localeCompare(b.pushName || b.remoteJid));

  const openForm = (contact: Contact | null) => {
    setEditing(contact);
    setNumber(contact?.remoteJid.split("@")[0] || "");
    setName(contact?.pushName || "");
    setBirthDate(organization?.contacts.find((saved) => saved.remoteJid === contact?.remoteJid)?.birthDate?.slice(0, 10) || "");
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["chats", "findContacts", instance?.name] });
    queryClient.invalidateQueries({ queryKey: ["chats", "findChats"] });
    queryClient.invalidateQueries({ queryKey: ["contactOrganization", instance?.id] });
  };

  const saveContact = async () => {
    if (!instance || editing === undefined || saving) return;
    const digits = number.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return toast.error("Informe o telefone com DDI e DDD");
    if (!name.trim()) return toast.error("Informe o nome do contato");
    setSaving(true);
    try {
      const response = await api.post(
        `/chat/saveContact/${instance.name}`,
        { remoteJid: editing ? `${digits}@s.whatsapp.net` : digits, name: name.trim() },
        { headers: { apikey: instance.token } },
      );
      if (response.data?.id) {
        await saasApi.put(`/saas/instance/${instance.id}/contacts/${response.data.id}/organization`, { birthDate: birthDate || null });
      }
      setEditing(undefined);
      refresh();
      toast.success(editing ? "Contato atualizado" : "Contato adicionado");
    } catch (error) {
      console.error("Error saving contact:", error);
      toast.error("Não foi possível salvar o contato");
    } finally {
      setSaving(false);
    }
  };

  const deleteContact = async (contact: Contact) => {
    if (!instance || !window.confirm("Excluir este contato? As mensagens da conversa serão mantidas.")) return;
    try {
      await api.delete(`/chat/deleteContact/${instance.name}`, {
        data: { remoteJid: contact.remoteJid },
        headers: { apikey: instance.token },
      });
      refresh();
      toast.success("Contato excluído");
    } catch (error) {
      console.error("Error deleting contact:", error);
      toast.error("Não foi possível excluir o contato");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contatos</h1>
          <p className="text-sm text-muted-foreground">Gerencie os contatos salvos nesta instância.</p>
        </div>
        <Button type="button" onClick={() => openForm(null)}><Plus className="mr-2 h-4 w-4" />Adicionar contato</Button>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Pesquisar contatos" placeholder="Pesquisar por nome ou número" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" aria-label="Contatos salvos">
        {isPending && <p className="text-sm text-muted-foreground">Carregando contatos...</p>}
        {isError && <p className="text-sm text-destructive">Não foi possível carregar os contatos.</p>}
        {!isPending && !isError && visibleContacts.length === 0 && <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p>}
        {visibleContacts.map((contact) => (
          <div key={contact.remoteJid} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 sm:flex-nowrap">
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarImage src={contact.profilePicUrl} alt={contact.pushName || contact.remoteJid} />
              <AvatarFallback><UserRound className="h-5 w-5" /></AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{contact.pushName || contact.remoteJid.split("@")[0]}</p>
              <p className="truncate text-sm text-muted-foreground">{contact.remoteJid.split("@")[0]}</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => navigate(`/manager/instance/${instance!.id}/chat/${contact.remoteJid}`)}>
              <MessageCircle className="mr-2 h-4 w-4" />Conversar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => openForm(contact)}>Editar</Button>
            <Button type="button" size="icon" variant="ghost" aria-label={`Excluir ${contact.pushName || contact.remoteJid}`} onClick={() => deleteContact(contact)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>

      <Dialog open={editing !== undefined} onOpenChange={(open) => { if (!open && !saving) setEditing(undefined); }}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(event) => { if (event.target instanceof Element && event.target.closest("[data-datepicker-calendar]")) event.preventDefault(); }}>
          <DialogTitle>{editing ? "Editar contato" : "Adicionar contato"}</DialogTitle>
          <DialogDescription>Informe o telefone com código do país e DDD.</DialogDescription>
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="contact-number" className="text-sm font-medium">Telefone</label>
              <Input id="contact-number" type="tel" placeholder="5591999999999" value={number} disabled={!!editing || saving} onChange={(event) => setNumber(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="contact-name" className="text-sm font-medium">Nome</label>
              <Input id="contact-name" value={name} disabled={saving} onChange={(event) => setName(event.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1">
              <label htmlFor="contact-birth-date" className="text-sm font-medium">Data de nascimento (opcional)</label>
              <DatePicker id="contact-birth-date" value={toPickerDate(birthDate)} disabled={saving} onChange={(value) => setBirthDate(fromPickerDate(value))} inline />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(undefined)}>Cancelar</Button>
            <Button type="button" disabled={saving} onClick={saveContact}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
