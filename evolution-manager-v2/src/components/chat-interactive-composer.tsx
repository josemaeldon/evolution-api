import { useQueryClient } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { useState } from "react";

import { Button } from "@evoapi/design-system/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/queries/api";

type Kind = "buttons" | "list" | "poll" | "flow";

type Props = {
  instanceName: string;
  token: string;
  integration: string;
  remoteJid: string;
};

const routes: Record<Kind, string> = {
  buttons: "sendButtons",
  list: "sendList",
  poll: "sendPoll",
  flow: "sendFlow",
};

const labels: Record<Kind, string> = {
  buttons: "Botões",
  list: "Lista",
  poll: "Enquete",
  flow: "Formulário",
};

export function ChatInteractiveComposer({ instanceName, token, integration, remoteJid }: Props) {
  const business = integration === "WHATSAPP-BUSINESS";
  const supported = business || integration === "WHATSAPP-BAILEYS";
  const group = remoteJid.endsWith("@g.us");
  const kinds: Kind[] = group ? ["poll"] : business ? ["buttons", "list", "flow"] : ["buttons", "list", "poll"];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(group ? "poll" : "buttons");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("");
  const [items, setItems] = useState<string[]>(["", ""]);
  const [flowId, setFlowId] = useState("");
  const [screenId, setScreenId] = useState("");
  const [selectableCount, setSelectableCount] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  if (!supported || (business && group)) return null;

  const entries = items.map((item) => item.trim()).filter(Boolean);
  const valid = kind === "flow"
    ? Boolean(flowId.trim() && body.trim() && cta.trim())
    : kind === "poll"
      ? Boolean(title.trim() && entries.length >= 2 && selectableCount >= 1 && selectableCount <= entries.length)
      : kind === "list"
        ? Boolean(title.trim() && body.trim() && cta.trim() && entries.length > 0)
        : Boolean(title.trim() && entries.length > 0);

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError("");
    const number = remoteJid.split("@")[0];
    const payload = kind === "buttons"
      ? { number, title: title.trim(), buttons: entries.map((displayText, index) => ({ type: "reply", displayText, id: `reply_${index + 1}` })) }
      : kind === "list"
        ? { number, title: title.trim(), description: body.trim(), buttonText: cta.trim(), sections: [{ title: title.trim().slice(0, 24), rows: entries.map((rowTitle, index) => ({ title: rowTitle, description: "", rowId: `row_${index + 1}` })) }] }
        : kind === "poll"
          ? { number, name: title.trim(), selectableCount, values: entries }
          : { number, flowId: flowId.trim(), body: body.trim(), cta: cta.trim(), ...(title.trim() && { header: title.trim() }), ...(screenId.trim() && { screenId: screenId.trim() }) };
    try {
      await api.post(`/message/${routes[kind]}/${instanceName}`, payload, { headers: { apikey: token } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chats", "findMessages"] }),
        queryClient.invalidateQueries({ queryKey: ["chats", "findChats"] }),
      ]);
      setOpen(false);
      setTitle("");
      setBody("");
      setCta("");
      setItems(["", ""]);
      setFlowId("");
      setScreenId("");
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.message || "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="icon" variant="ghost" title="Enviar mensagem interativa" aria-label="Enviar mensagem interativa" className="h-9 w-9 flex-shrink-0">
          <ListChecks className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar mensagem interativa</DialogTitle>
          <DialogDescription>Escolha o formato e preencha os dados que o contato receberá.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {kinds.map((option) => (
            <Button key={option} type="button" variant={kind === option ? "default" : "outline"} size="sm" onClick={() => { setKind(option); setError(""); }}>
              {labels[option]}
            </Button>
          ))}
        </div>
        <div className="grid gap-3">
          {kind !== "flow" && <Input aria-label={kind === "poll" ? "Pergunta da enquete" : "Título"} placeholder={kind === "poll" ? "Pergunta da enquete" : "Título"} maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} />}
          {kind === "flow" && <>
            <p className="text-sm text-muted-foreground">Informe o ID de um Flow publicado no WhatsApp Manager.</p>
            <Input aria-label="ID do Flow" placeholder="ID do Flow publicado" value={flowId} onChange={(event) => setFlowId(event.target.value)} />
            <Input aria-label="Cabeçalho opcional" placeholder="Cabeçalho (opcional)" maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} />
            <Input aria-label="Tela inicial opcional" placeholder="ID da tela inicial (opcional)" value={screenId} onChange={(event) => setScreenId(event.target.value)} />
          </>}
          {(kind === "list" || kind === "flow") && <Textarea aria-label="Texto da mensagem" placeholder="Texto da mensagem" maxLength={1024} value={body} onChange={(event) => setBody(event.target.value)} />}
          {(kind === "list" || kind === "flow") && <Input aria-label="Texto do botão" placeholder="Texto do botão" maxLength={20} value={cta} onChange={(event) => setCta(event.target.value)} />}
          {kind !== "flow" && <div className="grid gap-2">
            <span className="text-sm font-medium">{kind === "poll" ? "Opções" : kind === "list" ? "Itens da lista" : "Botões"}</span>
            {items.map((item, index) => <div key={index} className="flex gap-2">
              <Input aria-label={`Opção ${index + 1}`} placeholder={`Opção ${index + 1}`} maxLength={kind === "list" ? 24 : 20} value={item} onChange={(event) => setItems((current) => current.map((value, position) => position === index ? event.target.value : value))} />
              {items.length > (kind === "poll" ? 2 : 1) && <Button type="button" variant="outline" onClick={() => setItems((current) => current.filter((_, position) => position !== index))}>Remover</Button>}
            </div>)}
            {items.length < (kind === "buttons" ? 3 : 10) && <Button type="button" variant="outline" onClick={() => setItems((current) => [...current, ""])}>Adicionar opção</Button>}
          </div>}
          {kind === "poll" && <label className="text-sm">Máximo de escolhas
            <Input type="number" min={1} max={Math.max(1, entries.length)} value={selectableCount} onChange={(event) => setSelectableCount(Number(event.target.value))} />
          </label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" disabled={!valid || sending} onClick={send}>{sending ? "Enviando..." : `Enviar ${labels[kind].toLowerCase()}`}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
