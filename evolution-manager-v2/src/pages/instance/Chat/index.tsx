import "./style.css";
import { Avatar, AvatarFallback, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@evoapi/design-system/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { ArrowLeft, ContactRound, ListFilter, MessageCircle, MoreVertical, Plus, Search, Send, Trash2, User, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import { useInstance } from "@/contexts/InstanceContext";

import { useFindChats } from "@/lib/queries/chat/findChats";
import { api } from "@/lib/queries/api";
import { saasApi } from "@/lib/queries/saas";
import { getToken, TOKEN_ID } from "@/lib/queries/token";
import { cn } from "@/lib/utils";

import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

import { Chat as ChatType, Message } from "@/types/evolution.types";
import { useMediaQuery } from "@/utils/useMediaQuery";

import { Messages } from "./messages";

function ContactStatusMedia({ message, instanceName, token }: { message: Message; instanceName: string; token: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["chat", "status-media", instanceName, message.key.id],
    queryFn: async () => (await api.post<{ base64?: string; mimetype?: string }>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      { message },
      { headers: { apikey: token } },
    )).data,
    retry: false,
  });
  const content = message.message || {};
  const mediaType = content.imageMessage ? "image" : content.videoMessage ? "video" : content.audioMessage ? "audio" : null;
  if (!mediaType) return null;
  if (isPending || !data?.base64) return <p className="text-sm text-muted-foreground">{isPending ? "Carregando status..." : "Mídia indisponível"}</p>;
  const src = `data:${data.mimetype || (mediaType === "video" ? "video/mp4" : mediaType === "audio" ? "audio/ogg" : "image/jpeg")};base64,${data.base64}`;
  if (mediaType === "video") return <video src={src} controls className="max-h-[50vh] max-w-full rounded-lg" />;
  if (mediaType === "audio") return <audio src={src} controls className="max-w-full" />;
  return <img src={src} alt="Status do contato" className="max-h-[50vh] max-w-full rounded-lg object-contain" />;
}

const formatJid = (remoteJid: string): string => remoteJid.split("@")[0];
const toPickerDate = (date: string) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "");
const fromPickerDate = (date: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
};

type ChatKind = "contacts" | "groups";
type ContactFormMode = "contact" | "conversation" | "edit" | null;
type ManagedContact = { remoteJid: string; pushName?: string; profilePicUrl?: string };
type OrganizationLabels = {
  labels: { id: string; name: string; color: string }[];
  contacts: {
    id: string;
    remoteJid: string;
    pushName?: string;
    customName?: string;
    marketingOptIn: boolean;
    birthDate?: string | null;
    labels: { id: string; name: string; color: string }[];
  }[];
};
const getLocalDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function Chat() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isMD = useMediaQuery("(min-width: 768px)");
  const lastMessageRef = useRef<HTMLDivElement | null>(null);
  const [textareaHeight] = useState("auto");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { instance } = useInstance();

  const [realtimeChats, setRealtimeChats] = useState<ChatType[]>([]);
  const [unreadOverrides, setUnreadOverrides] = useState<Record<string, number>>({});
  const seenMessageIdsRef = useRef(new Set<string>());
  const realtimeUnreadIdsRef = useRef(new Map<string, Set<string>>());
  const activeChatRef = useRef<string | undefined>(undefined);
  const serverUnreadRef = useRef<Record<string, number>>({});
  const previousServerUnreadRef = useRef(new Map<string, number>());
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ChatKind>("contacts");
  const [labelFilter, setLabelFilter] = useState("");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [statusesOpen, setStatusesOpen] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [statusFile, setStatusFile] = useState<File | null>(null);
  const [sendingStatus, setSendingStatus] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [conversationOpen, setConversationOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [contactFormMode, setContactFormMode] = useState<ContactFormMode>(null);
  const [contactNumber, setContactNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactBirthDate, setContactBirthDate] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const localDate = getLocalDate();

  const { data: chats } = useFindChats({ instanceName: instance?.name, refetchInterval: 5000 });
  const { data: contactStatuses = [], isLoading: statusesLoading, refetch: refreshStatuses } = useQuery<Message[]>({
    queryKey: ["chats", "contactStatuses", instance?.name],
    queryFn: async () => (await api.get(`/chat/findContactStatuses/${instance!.name}`, { headers: { apikey: instance!.token } })).data,
    enabled: !!instance?.name && statusesOpen,
    staleTime: 15000,
    refetchInterval: 30000,
  });
  const { data: participatingGroups, isSuccess: participatingGroupsLoaded } = useQuery<Array<{ id: string }>>({
    queryKey: ["chats", "participatingGroups", instance?.name],
    queryFn: async () =>
      (await api.get(`/group/fetchAllGroups/${instance!.name}`, {
        params: { getParticipants: "false" },
        headers: { apikey: instance!.token },
      })).data,
    enabled: !!instance?.name,
    refetchInterval: 30000,
  });
  const participatingGroupIds = useMemo(
    () => new Set((participatingGroups || []).map((group) => group.id)),
    [participatingGroups],
  );
  serverUnreadRef.current = Object.fromEntries((chats || []).map((chat) => [chat.remoteJid, chat.unreadCount || 0]));
  const {
    data: contacts = [],
    isPending: contactsPending,
    isError: contactsError,
  } = useQuery<ManagedContact[]>({
    queryKey: ["chats", "findContacts", instance?.name],
    queryFn: async () => (await api.post(`/chat/findContacts/${instance?.name}`, { where: {} }, { headers: { apikey: instance?.token } })).data,
    enabled: !!instance?.name,
  });
  const { data: organization } = useQuery<OrganizationLabels>({
    queryKey: ["contactOrganization", instance?.id, localDate],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instance?.id}/organization?date=${localDate}`)).data,
    enabled: !!instance?.id,
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
          pushName: contact.remoteJid.endsWith("@g.us") ? existing.pushName : contact.pushName || existing.pushName,
          profilePicUrl: contact.profilePicUrl || existing.profilePicUrl,
        });
    });
    return Array.from(map.values());
  }, [chats, realtimeChats, contacts]);

  const { instanceId, remoteJid } = useParams<{ instanceId: string; remoteJid: string }>();
  const navigate = useNavigate();
  activeChatRef.current = remoteJid;

  useEffect(() => {
    if (remoteJid?.endsWith("@g.us")) setKind("groups");
  }, [remoteJid]);

  useEffect(() => {
    seenMessageIdsRef.current.clear();
    realtimeUnreadIdsRef.current.clear();
    setUnreadOverrides({});
  }, [instance?.id]);

  useEffect(() => {
    if (remoteJid) setUnreadOverrides((current) => ({ ...current, [remoteJid]: 0 }));
  }, [remoteJid]);

  useEffect(() => {
    if (!instance?.name) return;
    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) return;

    const socket = connectSocket(serverUrl, instance.token, instance.name);

    const handle = (data: { instance?: string; data?: { key?: { id?: string; fromMe?: boolean; remoteJid?: string; profilePictureUrl?: string }; pushName?: string; status?: string } }) => {
      if (!instance || data.instance !== instance.name) return;
      const jid = data?.data?.key?.remoteJid;
      if (!jid) return;

      const key = data.data?.key;
      const messageId = key?.id ? `${jid}:${key.id}` : "";
      if (key?.fromMe === false && messageId && !seenMessageIdsRef.current.has(messageId)) {
        seenMessageIdsRef.current.add(messageId);
        if (seenMessageIdsRef.current.size > 5000) seenMessageIdsRef.current.delete(seenMessageIdsRef.current.values().next().value!);
      }

      // The list badge counts only messages still awaiting a read receipt.
      if (key?.fromMe === false && key.id && data.data?.status === "DELIVERY_ACK" && activeChatRef.current !== jid) {
        const unreadIds = realtimeUnreadIdsRef.current.get(jid) || new Set<string>();
        unreadIds.add(key.id);
        realtimeUnreadIdsRef.current.set(jid, unreadIds);
        setUnreadOverrides((current) => ({
          ...current,
          [jid]: Math.max(current[jid] ?? serverUnreadRef.current[jid] ?? 0, (serverUnreadRef.current[jid] || 0) + unreadIds.size),
        }));
      }

      setRealtimeChats((prev) => {
        const idx = prev.findIndex((c) => c.remoteJid === jid);
        const incoming = data.data as Partial<ChatType> | undefined;
        const obj: ChatType = {
          ...incoming,
          id: jid,
          remoteJid: jid,
          pushName: jid.endsWith("@g.us") ? (idx !== -1 ? prev[idx].pushName : formatJid(jid)) : data?.data?.pushName || formatJid(jid),
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

  useEffect(() => {
    (chats || []).forEach((chat) => {
      const serverCount = chat.unreadCount || 0;
      const override = unreadOverrides[chat.remoteJid];
      const previousServerCount = previousServerUnreadRef.current.get(chat.remoteJid);
      if (override > 0 && (serverCount >= override || (previousServerCount !== undefined && serverCount < previousServerCount))) {
        setUnreadOverrides((current) => {
          if (current[chat.remoteJid] !== override) return current;
          const next = { ...current };
          delete next[chat.remoteJid];
          return next;
        });
        realtimeUnreadIdsRef.current.delete(chat.remoteJid);
      }
      previousServerUnreadRef.current.set(chat.remoteJid, serverCount);
    });
  }, [chats, unreadOverrides]);

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

  const handleChat = (jid: string) => {
    setKind(jid.endsWith("@g.us") ? "groups" : "contacts");
    activeChatRef.current = jid;
    realtimeUnreadIdsRef.current.delete(jid);
    setUnreadOverrides((current) => ({ ...current, [jid]: 0 }));
    navigate(`/manager/instance/${instanceId}/chat/${jid}`);
  };

  const handleBack = () => navigate(`/manager/instance/${instanceId}/chat`);

  const handleKindChange = (nextKind: ChatKind) => {
    setKind(nextKind);
    if (remoteJid && remoteJid.endsWith("@g.us") !== (nextKind === "groups")) {
      navigate(`/manager/instance/${instanceId}/chat`);
    }
  };

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
    setContactBirthDate(organization?.contacts.find((saved) => saved.remoteJid === contact?.remoteJid)?.birthDate?.slice(0, 10) || "");
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
      if (contactFormMode !== "conversation" && response.data?.id) {
        await saasApi.put(`/saas/instance/${instance.id}/contacts/${response.data.id}/organization`, {
          birthDate: contactBirthDate || null,
        });
        queryClient.invalidateQueries({ queryKey: ["contactOrganization", instance.id] });
      }
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

  const publishStatus = async () => {
    if (!instance || sendingStatus || (!statusFile && !statusText.trim())) return;
    setSendingStatus(true);
    try {
      const form = new FormData();
      form.append("type", statusFile ? (statusFile.type.startsWith("video/") ? "video" : "image") : "text");
      form.append("allContacts", "true");
      if (statusFile) {
        form.append("file", statusFile);
        if (statusText.trim()) form.append("caption", statusText.trim());
      } else {
        form.append("content", statusText.trim());
        form.append("backgroundColor", "#075e54");
        form.append("font", "1");
      }
      await api.post(`/message/sendStatus/${instance.name}`, form, { headers: { apikey: instance.token } });
      setStatusText("");
      setStatusFile(null);
      toast.success("Status publicado para seus contatos");
      await refreshStatuses();
    } catch (error) {
      console.error("Error publishing status:", error);
      toast.error("Não foi possível publicar o status");
    } finally {
      setSendingStatus(false);
    }
  };

  const leaveGroup = async () => {
    if (!instance || !remoteJid || !window.confirm("Sair deste grupo? Você deixará de receber novas mensagens.")) return;
    try {
      await api.delete(`/group/leaveGroup/${instance.name}`, {
        data: { groupJid: remoteJid },
        headers: { apikey: instance.token },
      });
      queryClient.invalidateQueries({ queryKey: ["chats", "participatingGroups", instance.name] });
      setRealtimeChats((current) => current.filter((chat) => chat.remoteJid !== remoteJid));
      refreshChats();
      handleBack();
      toast.success("Você saiu do grupo");
    } catch (error) {
      console.error("Error leaving group:", error);
      toast.error("Não foi possível sair do grupo");
    }
  };

  const deleteGroup = async () => {
    if (!instance || !remoteJid || !window.confirm("Apagar este grupo para todos? Os participantes serão removidos e a instância sairá do grupo.")) return;
    try {
      await api.delete(`/group/deleteGroup/${instance.name}`, {
        data: { groupJid: remoteJid },
        headers: { apikey: instance.token },
      });
      queryClient.invalidateQueries({ queryKey: ["chats", "participatingGroups", instance.name] });
      setRealtimeChats((current) => current.filter((chat) => chat.remoteJid !== remoteJid));
      refreshChats();
      handleBack();
      toast.success("Grupo apagado");
    } catch (error) {
      console.error("Error deleting group:", error);
      toast.error("Não foi possível apagar o grupo. Verifique se a instância é administradora.");
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
  const normalizedContactSearch = contactSearch
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const contactSearchDigits = contactSearch.replace(/\D/g, "");
  const managedContacts = contactList.filter(
    (contact) =>
      !normalizedContactSearch ||
      (contact.pushName || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(normalizedContactSearch) ||
      (contactSearchDigits.length > 0 && formatJid(contact.remoteJid).includes(contactSearchDigits)),
  );

  const contactLabelsByJid = useMemo(() => new Map((organization?.contacts || []).map((contact) => [contact.remoteJid, contact.labels])), [organization?.contacts]);

  const visibleChats = useMemo(() => {
    const isContacts = kind === "contacts";
    const filtered = allChats.filter(
      (c) =>
        c.remoteJid !== "0@s.whatsapp.net" &&
        (isContacts ? c.remoteJid.includes("@s.whatsapp.net") : c.remoteJid.includes("@g.us")) &&
        (isContacts || !participatingGroupsLoaded || participatingGroupIds.has(c.remoteJid)) &&
        (!labelFilter || contactLabelsByJid.get(c.remoteJid)?.some((label) => label.id === labelFilter)),
    );
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter((c) => (c.pushName && c.pushName.toLowerCase().includes(q)) || c.remoteJid.toLowerCase().includes(q));
  }, [allChats, kind, search, contactLabelsByJid, labelFilter, participatingGroupsLoaded, participatingGroupIds]);

  const showSidebar = !remoteJid || isMD;
  const showChat = !!remoteJid;
  const activeContact = organization?.contacts.find((contact) => contact.remoteJid === remoteJid);
  const activeContactName = activeContact?.customName?.trim() || activeContact?.pushName?.trim() || selectedContact?.pushName || (remoteJid ? formatJid(remoteJid) : "");
  const activeBirthDate = activeContact?.birthDate?.slice(0, 10) || "";
  const activeBirthDateValue = activeBirthDate ? new Date(`${activeBirthDate}T00:00:00`).toLocaleDateString("pt-BR") : "";
  const activeAge = activeBirthDate ? String(new Date().getFullYear() - Number(activeBirthDate.slice(0, 4))) : "";

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
            <Button type="button" size="icon" variant="outline" title="Status" aria-label="Status" onClick={() => setStatusesOpen(true)}>
              <MessageCircle className="h-4 w-4" />
            </Button>
          </div>

          {kind === "contacts" && !!organization?.labels.length && (
            <label className="flex items-center gap-2">
              <ListFilter className="h-4 w-4 text-muted-foreground" />
              <select
                aria-label="Filtrar conversas por etiqueta"
                value={labelFilter}
                onChange={(event) => setLabelFilter(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm">
                <option value="">Todas as etiquetas</option>
                {organization.labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant={kind === "contacts" ? "secondary" : "ghost"} className="h-8" onClick={() => handleKindChange("contacts")}>
              <User className="mr-1 h-4 w-4" />
              {t("chat.tabs.contacts")}
            </Button>
            <Button type="button" size="sm" variant={kind === "groups" ? "secondary" : "ghost"} className="h-8" onClick={() => handleKindChange("groups")}>
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
              const unreadCount = selected ? 0 : (unreadOverrides[chat.remoteJid] ?? chat.unreadCount ?? 0);

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
                        <p className={cn("truncate font-medium", unreadCount > 0 && "font-semibold")}>{name}</p>
                        {unreadCount > 0 && (
                          <span
                            aria-label={`${unreadCount} mensagens não lidas`}
                            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{formatJid(chat.remoteJid)}</p>
                      {contactLabelsByJid.get(chat.remoteJid)?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {contactLabelsByJid.get(chat.remoteJid)?.map((label) => (
                            <span key={label.id} className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: `${label.color}20`, color: label.color }}>
                              {label.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
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
              contacts={organization?.contacts || contactList}
              contactVariables={{
                name: activeContactName,
                phone: remoteJid.split("@")[0],
                birthDate: activeBirthDateValue,
                anniversary: activeBirthDate ? `${activeBirthDate.slice(8, 10)}/${activeBirthDate.slice(5, 7)}` : "",
                age: activeAge,
                labels: activeContact?.labels.map((label) => label.name).join(", ") || "",
              }}
              headerNameOverride={remoteJid.endsWith("@g.us") ? allChats.find((chat) => chat.remoteJid === remoteJid)?.pushName : selectedContact?.pushName}
              headerActions={
                remoteJid.endsWith("@g.us") ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" aria-label="Ações do grupo">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={leaveGroup}>Sair do grupo</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={deleteGroup}>
                        <Trash2 className="mr-2 h-4 w-4" /> Apagar grupo para todos
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : remoteJid.endsWith("@s.whatsapp.net") && (
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

      <Dialog open={statusesOpen} onOpenChange={setStatusesOpen}>
        <DialogContent className="flex max-h-[min(85dvh,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-xl">
          <DialogTitle>Status</DialogTitle>
          <DialogDescription>Veja os status recentes e publique um status para seus contatos.</DialogDescription>
          <div className="space-y-2 rounded-lg border p-3">
            <Input
              type="file"
              accept="image/*,video/*"
              aria-label="Selecionar foto ou vídeo para o status"
              onChange={(event) => setStatusFile(event.target.files?.[0] || null)}
            />
            <Input
              value={statusText}
              onChange={(event) => setStatusText(event.target.value)}
              placeholder={statusFile ? "Legenda (opcional)" : "Escreva um status de texto"}
              maxLength={700}
            />
            <Button type="button" onClick={publishStatus} disabled={sendingStatus || (!statusFile && !statusText.trim())}>
              <Send className="mr-2 h-4 w-4" /> {sendingStatus ? "Publicando..." : "Publicar para contatos"}
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" aria-label="Status recentes dos contatos">
            {statusesLoading && <p className="py-4 text-center text-sm text-muted-foreground">Carregando status...</p>}
            {!statusesLoading && contactStatuses.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum status recente recebido. A instância precisa estar conectada e salvar mensagens no banco.</p>}
            {contactStatuses.map((status) => {
              const senderJid = status.key.participant || status.key.remoteJid;
              const sender = contacts.find((contact) => contact.remoteJid === senderJid);
              const name = sender?.pushName || status.pushName || formatJid(senderJid);
              const body = status.message || {};
              const text = body.conversation || body.extendedTextMessage?.text || body.imageMessage?.caption || body.videoMessage?.caption || "";
              return (
                <article key={status.id || status.key.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(Number(status.messageTimestamp) * 1000).toLocaleString("pt-BR")}</span>
                  </div>
                  <ContactStatusMedia message={status} instanceName={instance!.name} token={instance!.token} />
                  {text && <p className="whitespace-pre-wrap text-sm">{text}</p>}
                </article>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

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

      <Dialog
        open={contactsOpen}
        onOpenChange={(open) => {
          setContactsOpen(open);
          if (!open) setContactSearch("");
        }}>
        <DialogContent className="flex max-h-[min(85dvh,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-xl">
          <DialogTitle>Gerenciar contatos</DialogTitle>
          <DialogDescription>Contatos salvos nesta instância.</DialogDescription>
          <Button type="button" size="sm" className="w-fit" onClick={() => openContactForm("contact")}>
            <Plus className="mr-2 h-4 w-4" /> Adicionar contato
          </Button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Pesquisar contatos salvos"
              placeholder="Pesquisar por nome ou número"
              value={contactSearch}
              onChange={(event) => setContactSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1" aria-label="Contatos salvos">
            {managedContacts.length === 0 && <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p>}
            {managedContacts.map((contact) => (
              <div key={contact.remoteJid} className="flex flex-wrap items-center gap-2 rounded-md border p-2 sm:flex-nowrap">
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
                  <span className="block text-sm font-medium break-all">{contact.pushName || formatJid(contact.remoteJid)}</span>
                  <span className="block text-xs text-muted-foreground break-all">{formatJid(contact.remoteJid)}</span>
                </button>
                <Button type="button" size="sm" variant="ghost" className="ml-auto sm:ml-0" onClick={() => openContactForm("edit", contact)}>
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
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest("[data-datepicker-calendar]")) event.preventDefault();
          }}>
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
            {contactFormMode !== "conversation" && (
              <div className="space-y-1">
                <label htmlFor="contact-birth-date" className="text-sm font-medium">Data de nascimento (opcional)</label>
                <DatePicker id="contact-birth-date" value={toPickerDate(contactBirthDate)} disabled={savingContact} onChange={(value) => setContactBirthDate(fromPickerDate(value))} inline />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={savingContact} onClick={() => setContactFormMode(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={savingContact} onClick={saveContact}>
              {contactFormMode === "conversation" ? "Abrir conversa" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { Chat };
