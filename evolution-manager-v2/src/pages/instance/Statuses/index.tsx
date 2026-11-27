import { Avatar, AvatarFallback, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CircleDot, ImagePlus, Send, User, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useInstance } from "@/contexts/InstanceContext";
import { api } from "@/lib/queries/api";
import { useManagerAccount } from "@/lib/queries/saas";
import { Message } from "@/types/evolution.types";

type Contact = {
  remoteJid: string;
  pushName?: string;
  customName?: string;
  profilePicUrl?: string;
};

type ContactStatusGroup = {
  id: string;
  contact?: Contact;
  name: string;
  phone: string;
  statuses: Message[];
  latestAt: number;
};

const getStatusSender = (status: Message) =>
  status.key.participant || status.key.participantAlt || status.key.participantUsername || status.key.remoteJid;

const statusText = (message: any) =>
  message?.conversation ||
  message?.extendedTextMessage?.text ||
  message?.imageMessage?.caption ||
  message?.videoMessage?.caption ||
  message?.documentMessage?.caption ||
  "";

function StatusMedia({ message, instanceName, token, onVideoEnded }: {
  message: Message;
  instanceName: string;
  token: string;
  onVideoEnded: () => void;
}) {
  const content = message.message || {};
  const mediaType = content.imageMessage ? "image" : content.videoMessage ? "video" : content.audioMessage ? "audio" : null;
  const { data, isPending, isError } = useQuery({
    queryKey: ["chat", "status-media", instanceName, message.key.id],
    queryFn: async () => (await api.post<{ base64?: string; mimetype?: string }>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      { message },
      { headers: { apikey: token } },
    )).data,
    enabled: !!mediaType,
    retry: false,
  });

  if (!mediaType) return null;
  if (isPending) return <p className="text-sm text-white/70">Carregando status...</p>;
  if (isError || !data?.base64) return <p className="text-sm text-white/70">Esta mídia não está disponível.</p>;

  const fallbackMime = mediaType === "video" ? "video/mp4" : mediaType === "audio" ? "audio/ogg" : "image/jpeg";
  const src = `data:${data.mimetype || fallbackMime};base64,${data.base64}`;
  if (mediaType === "video") {
    return <video src={src} autoPlay controls onEnded={onVideoEnded} className="max-h-full max-w-full object-contain" />;
  }
  if (mediaType === "audio") return <audio src={src} autoPlay controls onEnded={onVideoEnded} className="max-w-full" />;
  return <img src={src} alt="Status do contato" className="max-h-full max-w-full object-contain" />;
}

function ContactStatuses() {
  const { instance } = useInstance();
  const { data: account } = useManagerAccount();
  const queryClient = useQueryClient();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [activeStatusIndex, setActiveStatusIndex] = useState(0);
  const [addStatusOpen, setAddStatusOpen] = useState(false);
  const [statusTextValue, setStatusTextValue] = useState("");
  const [statusFile, setStatusFile] = useState<File | null>(null);
  const [publishing, setPublishing] = useState(false);
  const allowedRole = account?.role === "superadmin" || account?.role === "admin" || account?.role === "user";

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["chats", "findContacts", instance?.name],
    queryFn: async () => (await api.post(`/chat/findContacts/${instance!.name}`, { where: {} }, {
      headers: { apikey: instance!.token },
    })).data,
    enabled: !!instance?.name,
  });
  const { data: statuses = [], isLoading, isError, refetch } = useQuery<Message[]>({
    queryKey: ["chats", "contactStatuses", instance?.name],
    queryFn: async () => (await api.get(`/chat/findContactStatuses/${instance!.name}`, {
      headers: { apikey: instance!.token },
    })).data,
    enabled: !!instance?.name && allowedRole,
    refetchInterval: 30000,
  });

  const contactGroups = useMemo(() => {
    const groups = new Map<string, ContactStatusGroup>();
    for (const status of statuses) {
      const senderJid = getStatusSender(status);
      const candidates = [senderJid, status.key.participantAlt, status.key.remoteJidAlt].filter(Boolean);
      const contact = contacts.find((item) => candidates.includes(item.remoteJid));
      const id = contact?.remoteJid || senderJid;
      const timestamp = Number(status.messageTimestamp);
      let group = groups.get(id);
      if (!group) {
        const pushName = contact?.customName?.trim() || contact?.pushName?.trim() || status.pushName?.trim();
        group = {
          id,
          contact,
          name: pushName || senderJid.split("@")[0],
          phone: (contact?.remoteJid || status.key.participantAlt || senderJid).split("@")[0],
          statuses: [],
          latestAt: timestamp,
        };
        groups.set(id, group);
      }
      group.statuses.push(status);
      group.latestAt = Math.max(group.latestAt, timestamp);
    }
    return [...groups.values()].sort((a, b) => b.latestAt - a.latestAt);
  }, [statuses, contacts]);

  const selectedGroup = contactGroups.find((group) => group.id === selectedContactId) || null;
  const activeStatus = selectedGroup?.statuses[activeStatusIndex] || null;

  useEffect(() => {
    if (!activeStatus || !selectedGroup) return;
    const content = activeStatus.message || {};
    if (content.videoMessage || content.audioMessage) return;
    const timer = window.setTimeout(() => {
      setActiveStatusIndex((index) => (index + 1 < selectedGroup.statuses.length ? index + 1 : index));
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [activeStatus, selectedGroup]);

  const showNextStatus = () => {
    if (!selectedGroup) return;
    if (activeStatusIndex + 1 < selectedGroup.statuses.length) setActiveStatusIndex((index) => index + 1);
    else {
      const currentIndex = contactGroups.findIndex((group) => group.id === selectedGroup.id);
      const nextGroup = contactGroups[currentIndex + 1];
      if (nextGroup) {
        setActiveStatusIndex(0);
        setSelectedContactId(nextGroup.id);
      }
      else setSelectedContactId(null);
    }
  };

  const showPreviousStatus = () => {
    if (activeStatusIndex > 0) {
      setActiveStatusIndex((index) => index - 1);
      return;
    }
    if (!selectedGroup) return;
    const currentIndex = contactGroups.findIndex((group) => group.id === selectedGroup.id);
    const previousGroup = contactGroups[currentIndex - 1];
    if (previousGroup) {
      setActiveStatusIndex(previousGroup.statuses.length - 1);
      setSelectedContactId(previousGroup.id);
    }
  };

  const publishStatus = async () => {
    if (!instance || publishing || (!statusFile && !statusTextValue.trim())) return;
    setPublishing(true);
    try {
      const form = new FormData();
      form.append("type", statusFile ? (statusFile.type.startsWith("video/") ? "video" : "image") : "text");
      form.append("allContacts", "true");
      if (statusFile) {
        form.append("file", statusFile);
        if (statusTextValue.trim()) form.append("caption", statusTextValue.trim());
      } else {
        form.append("content", statusTextValue.trim());
        form.append("backgroundColor", "#075e54");
        form.append("font", "1");
      }
      await api.post(`/message/sendStatus/${instance.name}`, form, {
        headers: { apikey: instance.token },
        timeout: 120000,
      });
      setStatusTextValue("");
      setStatusFile(null);
      setAddStatusOpen(false);
      toast.success("Status publicado para seus contatos");
      await queryClient.invalidateQueries({ queryKey: ["chats", "contactStatuses", instance.name] });
      await refetch();
    } catch (error) {
      console.error("Error publishing status:", error);
      const responseData = (error as { response?: { data?: { message?: string; error?: string } } }).response?.data;
      toast.error(responseData?.message || responseData?.error || "Não foi possível publicar o status");
    } finally {
      setPublishing(false);
    }
  };

  if (!allowedRole) return <div className="p-6 text-sm text-muted-foreground">Acesso restrito.</div>;

  return (
    <section className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[520px] max-w-6xl flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold">Status</h1>
          <p className="text-sm text-muted-foreground">Atualizações dos seus contatos que ainda estão disponíveis.</p>
        </div>
        <Button onClick={() => setAddStatusOpen(true)}>
          <ImagePlus className="mr-2 h-4 w-4" /> Adicionar status
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-full max-w-sm shrink-0 flex-col border-r md:w-[340px]">
          <div className="border-b p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Meu status</p>
            <button type="button" onClick={() => setAddStatusOpen(true)} className="mt-3 flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent">
              <span className="relative">
                <Avatar className="h-12 w-12"><AvatarFallback><User className="h-5 w-5" /></AvatarFallback></Avatar>
                <span className="absolute -bottom-1 -right-1 rounded-full bg-primary p-0.5 text-primary-foreground"><ImagePlus className="h-4 w-4" /></span>
              </span>
              <span><span className="block font-medium">Adicionar status</span><span className="text-sm text-muted-foreground">Compartilhe texto, foto ou vídeo</span></span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atualizações recentes</p>
            {isLoading && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando status...</p>}
            {isError && <div className="space-y-3 px-3 py-6 text-center text-sm text-muted-foreground"><p>Não foi possível carregar os status.</p><Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button></div>}
            {!isLoading && !isError && contactGroups.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum contato tem status disponível agora.</p>
            )}
            {contactGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => { setActiveStatusIndex(0); setSelectedContactId(group.id); }}
                className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${selectedContactId === group.id ? "bg-accent" : "hover:bg-accent/70"}`}>
                <span className="rounded-full bg-gradient-to-tr from-amber-400 via-fuchsia-600 to-violet-600 p-[2px]">
                  <Avatar className="h-12 w-12 border-2 border-card">
                    <AvatarImage src={group.contact?.profilePicUrl} alt={group.name} />
                    <AvatarFallback>{group.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{group.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{group.phone} · {group.statuses.length} {group.statuses.length === 1 ? "atualização" : "atualizações"}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(group.latestAt * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="hidden min-w-0 flex-1 items-center justify-center bg-muted/30 p-6 md:flex">
          {selectedGroup && activeStatus ? (
            <div className="relative flex h-full max-h-[720px] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl bg-neutral-950 text-white shadow-xl">
              <div className="absolute inset-x-0 top-0 z-10 p-4">
                <div className="mb-3 flex gap-1">
                  {selectedGroup.statuses.map((status, index) => (
                    <span key={status.id || status.key.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/35">
                      <span className={`block h-full rounded-full bg-white ${index < activeStatusIndex ? "w-full" : index === activeStatusIndex ? "w-1/2" : "w-0"}`} />
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Avatar className="h-9 w-9"><AvatarImage src={selectedGroup.contact?.profilePicUrl} /><AvatarFallback>{selectedGroup.name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{selectedGroup.name}</span><span className="text-xs text-white/70">{new Date(Number(activeStatus.messageTimestamp) * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></span>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" aria-label="Fechar status" onClick={() => setSelectedContactId(null)}>×</Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-20">
                <StatusMedia message={activeStatus} instanceName={instance!.name} token={instance!.token} onVideoEnded={showNextStatus} />
                {!activeStatus.message?.imageMessage && !activeStatus.message?.videoMessage && !activeStatus.message?.audioMessage && (
                  <p className="max-w-full whitespace-pre-wrap break-words text-center text-3xl font-medium">{statusText(activeStatus.message) || "Status"}</p>
                )}
              </div>
              <div className="absolute inset-y-0 left-0 flex items-center"><Button variant="ghost" size="icon" aria-label="Status anterior" className="text-white hover:bg-white/10 hover:text-white" onClick={showPreviousStatus}><ArrowLeft /></Button></div>
              <div className="absolute inset-y-0 right-0 flex items-center"><Button variant="ghost" size="icon" aria-label="Próximo status" className="text-white hover:bg-white/10 hover:text-white" onClick={showNextStatus}><ArrowRight /></Button></div>
              {statusText(activeStatus.message) && (activeStatus.message?.imageMessage || activeStatus.message?.videoMessage) && <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-4 text-center text-sm">{statusText(activeStatus.message)}</p>}
            </div>
          ) : (
            <div className="max-w-sm text-center text-muted-foreground">
              <CircleDot className="mx-auto mb-4 h-12 w-12 opacity-50" />
              <p className="font-medium">Selecione um contato para ver o status</p>
              <p className="mt-1 text-sm">As atualizações ficam disponíveis por até 24 horas.</p>
            </div>
          )}
        </main>
      </div>

      <Dialog open={addStatusOpen} onOpenChange={setAddStatusOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>Adicionar status</DialogTitle>
          <DialogDescription>Seu status será compartilhado com os contatos salvos nesta instância.</DialogDescription>
          <Input type="file" accept="image/*,video/*" aria-label="Selecionar foto ou vídeo" onChange={(event) => setStatusFile(event.target.files?.[0] || null)} />
          <Input value={statusTextValue} onChange={(event) => setStatusTextValue(event.target.value)} placeholder={statusFile ? "Legenda (opcional)" : "Escreva um status de texto"} maxLength={700} />
          <Button onClick={publishStatus} disabled={publishing || (!statusFile && !statusTextValue.trim())}>
            {statusFile?.type.startsWith("video/") ? <Video className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" />}
            {publishing ? "Publicando..." : "Compartilhar status"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default ContactStatuses;
