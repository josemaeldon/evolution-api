import "./style.css";
import { Avatar, AvatarFallback, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@evoapi/design-system/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ContactRound, MessageCircle, MoreVertical, Plus, Search, Trash2, User, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import { useInstance } from "@/contexts/InstanceContext";

import { useFindChats } from "@/lib/queries/chat/findChats";
import { api } from "@/lib/queries/api";
import { getToken, TOKEN_ID } from "@/lib/queries/token";
import { cn } from "@/lib/utils";

import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

import { Chat as ChatType } from "@/types/evolution.types";

import { useMediaQuery } from "@/utils/useMediaQuery";

import { Messages } from "./messages";

const formatJid = (remoteJid: string): string => remoteJid.split("@")[0];

type ChatKind = "contacts" | "groups";
type ContactFormMode = "contact" | "conversation" | "edit" | null;
type ManagedContact = { remoteJid: string; pushName?: string; profilePicUrl?: string };

function Chat() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isMD = useMediaQuery("(min-width: 768px)");
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const [textareaHeight] = useState("auto");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { instance } = useInstance();

  const [realtimeChats, setRealtimeChats] = useState<ChatType[]>([]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ChatKind>("contacts");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [contactFormMode, setContactFormMode] = useState<ContactFormMode>(null);
  const [contactNumber, setContactNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const { data: chats } = useFindChats({ instanceName: instance?.name, refetchInterval: 5000 });
  const {
    data: contacts = [],
    isPending: contactsPending,
    isError: contactsError,
  } = useQuery<ManagedContact[]>({
    queryKey: ["chats", "findContacts", instance?.name],
    queryFn: async () => (await api.post(`/chat/findContacts/${instance?.name}`, { where: {} }, { headers: { apikey: instance?.token } })).data,
    enabled: !!instance?.name,
  });

  const allChats = useMemo(() => {
    const map = new Map<string, ChatType>();
    chats?.forEach((c) => map.set(c.remoteJid, c));
    realtimeChats.forEach((c) => {
      const existing = map.get(c.remoteJid);
      map.set(c.remoteJid, existing ? { ...c, ...existing, profilePicUrl: existing.profilePicUrl || c.profilePicUrl } : c);
    });
    contacts.forEach((contact) => {
      const existing = map.get(contact.remoteJid);
      if (existing)
        map.set(contact.remoteJid, {
          ...existing,
          pushName: contact.pushName || existing.pushName,
          profilePicUrl: contact.profilePicUrl || existing.profilePicUrl,
        });
    });
    return Array.from(map.values());
  }, [chats, realtimeChats, contacts]);

  const { instanceId, remoteJid } = useParams<{ instanceId: string; remoteJid: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!instance?.name) return;
    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) return;

    const socket = connectSocket(serverUrl, instance.token);

    const handle = (data: { instance?: string; data?: { key?: { remoteJid?: string; profilePictureUrl?: string }; pushName?: string } }) => {
      if (!instance || data.instance !== instance.name) return;
      const jid = data?.data?.key?.remoteJid;
      if (!jid) return;

      setRealtimeChats((prev) => {
        const idx = prev.findIndex((c) => c.remoteJid === jid);
        const incoming = data.data as Partial<ChatType> | undefined;
        const obj: ChatType = {
          ...incoming,
          id: jid,
          remoteJid: jid,
          pushName: data?.data?.pushName || formatJid(jid),
          profilePicUrl: data?.data?.key?.profilePictureUrl || "",
          labels: incoming?.labels ?? null,
          createdAt: incoming?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          instanceId: instance.id,
        };
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...obj };
          return next;
        }
        return [...prev, obj];
      });
    };

    socket.on("messages.upsert", handle);
    socket.on("send.message", handle);
    socket.connect();

    return () => {
      socket.off("messages.upsert");
      socket.off("send.message");
      disconnectSocket(socket);
    };
  }, [instance, instance?.name]);

  const scrollToBottom = useCallback(() => {
    lastMessageRef.current?.scrollIntoView({});
  }, []);

  const handleTextareaChange = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    const scrollHeight = textareaRef.current.scrollHeight;
    const lineHeight = parseInt(getComputedStyle(textareaRef.current).lineHeight);
    const maxHeight = lineHeight * 10;
    textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  };

  const handleChat = (jid: string) => navigate(`/manager/instance/${instanceId}/chat/${jid}`);

  const handleBack = () => navigate(`/manager/instance/${instanceId}/chat`);

  const refreshChats = () => {
    queryClient.invalidateQueries({ queryKey: ["chats", "findChats"] }).catch(console.error);
    queryClient.invalidateQueries({ queryKey: ["chats", "findContacts"] }).catch(console.error);
    queryClient.invalidateQueries({ queryKey: ["chats", "findMessages"] }).catch(console.error);
  };

  const openContactForm = (mode: Exclude<ContactFormMode, null>, contact?: ManagedContact) => {
    setContactsOpen(false);
    setConversationOpen(false);
    setContactFormMode(mode);
    setContactNumber(contact?.remoteJid.split("@")[0] || "");
    setContactName(contact?.pushName || "");
  };

  const saveContact = async () => {
    if (!instance || !contactFormMode || savingContact) return;
    const digits = contactNumber.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      toast.error("Informe o telefone com DDI e DDD");
      return;
    }
    if (contactFormMode !== "conversation" && !contactName.trim()) {
      toast.error("Informe o nome do contato");
      return;
    }
    try {
      setSavingContact(true);
      const response = await api.post(
        `/chat/saveContact/${instance.name}`,
        { remoteJid: contactFormMode === "edit" ? `${digits}@s.whatsapp.net` : digits, name: contactName.trim() || digits },
        { headers: { apikey: instance.token } },
      );
      setContactFormMode(null);
      refreshChats();
      if (contactFormMode === "conversation") handleChat(response.data.remoteJid);
      else toast.success(contactFormMode === "edit" ? "Contato atualizado" : "Contato adicionado");
    } catch (error) {
      console.error("Error saving contact:", error);
      toast.error("Não foi possível salvar o contato");
    } finally {
      setSavingContact(false);
    }
  };

  const deleteContact = async (jid: string) => {
    if (!instance || !window.confirm("Excluir este contato? As mensagens da conversa serão mantidas.")) return;
    try {
      await api.delete(`/chat/deleteContact/${instance.name}`, { data: { remoteJid: jid }, headers: { apikey: instance.token } });
      refreshChats();
      toast.success("Contato excluído");
    } catch (error) {
      console.error("Error deleting contact:", error);
      toast.error("Não foi possível excluir o contato");
    }
  };

  const deleteConversation = async () => {
    if (!instance || !remoteJid || !window.confirm("Excluir esta conversa e suas mensagens desta instância?")) return;
    try {
      await api.delete(`/chat/deleteConversation/${instance.name}`, { data: { remoteJid }, headers: { apikey: instance.token } });
      setRealtimeChats((current) => current.filter((chat) => chat.remoteJid !== remoteJid));
      refreshChats();
      handleBack();
      toast.success("Conversa excluída");
    } catch (error) {
      console.error("Error deleting conversation:", error);
      toast.error("Não foi possível excluir a conversa");
    }
  };

  const selectedContact = contacts.find((contact) => contact.remoteJid === remoteJid);
  const contactList = contacts.filter((contact) => contact.remoteJid.endsWith("@s.whatsapp.net")).sort((a, b) => (a.pushName || a.remoteJid).localeCompare(b.pushName || b.remoteJid));
  const normalizedSearch = conversationSearch
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const searchDigits = conversationSearch.replace(/\D/g, "");
  const matchingContacts = contactList.filter(
    (contact) =>
      !normalizedSearch ||
      (contact.pushName || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(normalizedSearch) ||
      (searchDigits.length > 0 && formatJid(contact.remoteJid).includes(searchDigits)),
  );

  const visibleChats = useMemo(() => {
    const isContacts = kind === "contacts";
    const filtered = allChats.filter((c) => c.remoteJid !== "0@s.whatsapp.net" && (isContacts ? c.remoteJid.includes("@s.whatsapp.net") : c.remoteJid.includes("@g.us")));
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter((c) => (c.pushName && c.pushName.toLowerCase().includes(q)) || c.remoteJid.toLowerCase().includes(q));
  }, [allChats, kind, search]);

  const showSidebar = !remoteJid || isMD;
  const showChat = !!remoteJid;

  return (
    <div className="flex h-full w-full overflow-hidden rounded-lg border">
      <aside className={cn("flex w-full flex-col border-r bg-card/50 md:w-80 md:flex-shrink-0", showSidebar ? "flex" : "hidden md:flex")}>
        <div className="space-y-3 border-b p-4">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" placeholder={t("chat.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              title="Iniciar conversa"
              aria-label="Iniciar conversa"
              onClick={() => {
                setConversationSearch("");
                setConversationOpen(true);
              }}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="outline" title="Gerenciar contatos" aria-label="Gerenciar contatos" onClick={() => setContactsOpen(true)}>
              <ContactRound className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant={kind === "contacts" ? "secondary" : "ghost"} className="h-8" onClick={() => setKind("contacts")}>
              <User className="mr-1 h-4 w-4" />
              {t("chat.tabs.contacts")}
            </Button>
            <Button type="button" size="sm" variant={kind === "groups" ? "secondary" : "ghost"} className="h-8" onClick={() => setKind("groups")}>
              <Users className="mr-1 h-4 w-4" />
              {t("chat.tabs.groups")}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("chat.count", { count: visibleChats.length })}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {visibleChats.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <MessageCircle className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">{search ? t("chat.empty.search") : t("chat.empty.default")}</p>
              {search && <p className="mt-1 text-xs text-muted-foreground">{t("chat.empty.tryAnother")}</p>}
            </div>
          ) : (
            visibleChats.map((chat) => {
              const selected = remoteJid === chat.remoteJid;
              const name = chat.pushName || formatJid(chat.remoteJid);

              return (
                <button
                  key={chat.remoteJid}
                  type="button"
                  onClick={() => handleChat(chat.remoteJid)}
                  className={cn("block w-full cursor-pointer p-4 text-left transition-colors", selected ? "border-l-2 border-l-primary bg-primary/10" : "border-b border-border/50 hover:bg-accent")}>
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarImage src={chat.profilePicUrl} alt={name} />
                      <AvatarFallback className="bg-muted text-muted-foreground">{kind === "groups" ? <Users className="h-5 w-5" /> : <User className="h-5 w-5" />}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between gap-2">
                        <p className="truncate font-medium">{name}</p>
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{formatJid(chat.remoteJid)}</p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className={cn("flex h-full min-h-0 flex-1 flex-col overflow-hidden", showChat ? "flex" : "hidden md:flex")}>
        {remoteJid ? (
          <>
            {!isMD && (
              <div className="flex items-center border-b bg-background/95 p-2 backdrop-blur-sm">
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  {t("chat.back")}
                </Button>
              </div>
            )}
            <Messages
              key={remoteJid}
              contacts={contactList}
              headerNameOverride={selectedContact?.pushName}
              headerActions={
                remoteJid.endsWith("@s.whatsapp.net") && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" aria-label="Ações da conversa">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openContactForm(selectedContact ? "edit" : "contact", selectedContact || { remoteJid })}>
                        {selectedContact ? "Editar contato" : "Adicionar contato"}
                      </DropdownMenuItem>
                      {selectedContact && <DropdownMenuItem onClick={() => deleteContact(remoteJid)}>Excluir contato</DropdownMenuItem>}
                      <DropdownMenuItem className="text-destructive" onClick={deleteConversation}>
                        <Trash2 className="mr-2 h-4 w-4" /> Excluir conversa
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              }
              textareaRef={textareaRef}
              handleTextareaChange={handleTextareaChange}
              textareaHeight={textareaHeight}
              lastMessageRef={lastMessageRef}
              scrollToBottom={scrollToBottom}
            />
          </>
        ) : (
          <div className="flex h-full flex-1 items-center justify-center p-8">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <MessageCircle className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mb-1 text-lg font-semibold">{t("chat.empty.selectTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("chat.empty.selectDescription")}</p>
            </div>
          </div>
        )}
      </main>

      <Dialog open={conversationOpen} onOpenChange={setConversationOpen}>
        <DialogContent className="max-h-[85dvh] sm:max-w-lg">
          <DialogTitle>Iniciar conversa</DialogTitle>
          <DialogDescription>Pesquise um contato pelo nome ou número.</DialogDescription>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              autoFocus
              aria-label="Pesquisar contatos"
              placeholder="Nome ou número"
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <div className="max-h-[48dvh] space-y-1 overflow-y-auto" aria-label="Contatos encontrados">
            {contactsPending && <p className="py-4 text-center text-sm text-muted-foreground">Carregando contatos...</p>}
            {contactsError && <p className="py-4 text-center text-sm text-destructive">Não foi possível carregar os contatos.</p>}
            {!contactsPending && !contactsError && matchingContacts.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</p>}
            {matchingContacts.map((contact) => {
              const name = contact.pushName || formatJid(contact.remoteJid);
              return (
                <button
                  key={contact.remoteJid}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => {
                    setConversationOpen(false);
                    handleChat(contact.remoteJid);
                  }}>
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={contact.profilePicUrl} alt={name} />
                    <AvatarFallback>
                      <User className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{formatJid(contact.remoteJid)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={() => openContactForm("conversation")}>
            <Plus className="mr-2 h-4 w-4" /> Conversar com novo número
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={contactsOpen} onOpenChange={setContactsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>Gerenciar contatos</DialogTitle>
          <DialogDescription>Contatos salvos nesta instância.</DialogDescription>
          <Button type="button" size="sm" className="w-fit" onClick={() => openContactForm("contact")}>
            <Plus className="mr-2 h-4 w-4" /> Adicionar contato
          </Button>
          <div className="space-y-2">
            {contactList.length === 0 && <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p>}
            {contactList.map((contact) => (
              <div key={contact.remoteJid} className="flex items-center gap-2 rounded-md border p-2">
                <Avatar className="h-9 w-9 flex-shrink-0">
                  <AvatarImage src={contact.profilePicUrl} alt={contact.pushName || formatJid(contact.remoteJid)} />
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setContactsOpen(false);
                    handleChat(contact.remoteJid);
                  }}>
                  <span className="block truncate text-sm font-medium">{contact.pushName || formatJid(contact.remoteJid)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{formatJid(contact.remoteJid)}</span>
                </button>
                <Button type="button" size="sm" variant="ghost" onClick={() => openContactForm("edit", contact)}>
                  Editar
                </Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Excluir ${contact.pushName || contact.remoteJid}`} onClick={() => deleteContact(contact.remoteJid)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={contactFormMode !== null}
        onOpenChange={(open) => {
          if (!open && !savingContact) setContactFormMode(null);
        }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{contactFormMode === "conversation" ? "Iniciar conversa" : contactFormMode === "edit" ? "Editar contato" : "Adicionar contato"}</DialogTitle>
          <DialogDescription>Informe o telefone com código do país e DDD.</DialogDescription>
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="contact-number" className="text-sm font-medium">
                Telefone
              </label>
              <Input
                id="contact-number"
                type="tel"
                placeholder="5591999999999"
                value={contactNumber}
                disabled={contactFormMode === "edit" || savingContact}
                onChange={(event) => setContactNumber(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="contact-name" className="text-sm font-medium">
                Nome {contactFormMode === "conversation" ? "(opcional)" : ""}
              </label>
              <Input id="contact-name" value={contactName} disabled={savingContact} onChange={(event) => setContactName(event.target.value)} maxLength={100} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={savingContact} onClick={() => setContactFormMode(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={savingContact} onClick={saveContact}>
              {contactFormMode === "conversation" ? "Abrir conversa" : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { Chat };
