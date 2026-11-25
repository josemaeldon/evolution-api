import { useQueryClient } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { useState } from "react";

import { Button } from "@evoapi/design-system/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/queries/api";

type Kind = "buttons" | "copy" | "pix" | "list" | "poll" | "flow";

type Props = {
  instanceName: string;
  token: string;
  integration: string;
  remoteJid: string;
  recipientName?: string;
};

const routes: Record<Kind, string> = {
  buttons: "sendButtons",
  copy: "sendButtons",
  pix: "sendButtons",
  list: "sendList",
  poll: "sendPoll",
  flow: "sendFlow",
};

const labels: Record<Kind, string> = {
  buttons: "Botões",
  copy: "Copiar código",
  pix: "Pix copia e cola",
  list: "Lista",
  poll: "Enquete",
  flow: "Formulário",
};

export function ChatInteractiveComposer({ instanceName, token, integration, remoteJid, recipientName }: Props) {
  const business = integration === "WHATSAPP-BUSINESS";
  const supported = business || integration === "WHATSAPP-BAILEYS";
  const group = remoteJid.endsWith("@g.us");
  const kinds: Kind[] = group ? ["poll"] : business ? ["buttons", "list", "flow"] : ["buttons", "copy", "pix", "list", "poll"];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(group ? "poll" : "buttons");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("");
  const [items, setItems] = useState<string[]>(["", ""]);
  const [flowId, setFlowId] = useState("");
  const [screenId, setScreenId] = useState("");
  const [copyCode, setCopyCode] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [merchantName, setMerchantName] = useState(recipientName || "");
  const [merchantCity, setMerchantCity] = useState("");
  const [amount, setAmount] = useState("");
  const [selectableCount, setSelectableCount] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  if (!supported || (business && group)) return null;

  const entries = items.map((item) => item.trim()).filter(Boolean);
  const validPaymentUrl = (() => {
    try {
      return new URL(paymentUrl.trim()).protocol === "https:";
    } catch {
      return false;
    }
  })();
  const valid =
    kind === "flow"
      ? Boolean(flowId.trim() && body.trim() && cta.trim())
      : kind === "pix"
        ? Boolean(title.trim() && pixKey.trim() && merchantName.trim() && merchantCity.trim() && /^\d{1,6}[.,]\d{2}$/.test(amount.trim()) && Number(amount.replace(",", ".")) > 0)
        : kind === "copy"
          ? Boolean(title.trim() && copyCode.trim() && (!paymentUrl.trim() || validPaymentUrl))
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
    let charge: { code: string; paymentUrl: string; amount: string } | null = null;
    try {
      if (kind === "pix") {
        const response = await api.post(
          `/pix/create/${instanceName}`,
          {
            key: pixKey.trim(),
            amount: amount.trim(),
            merchantName: merchantName.trim(),
            merchantCity: merchantCity.trim(),
            description: body.trim(),
          },
          { headers: { apikey: token } },
        );
        charge = response.data;
        if (!charge?.code || !charge.paymentUrl || !charge.amount) throw new Error("Não foi possível gerar a cobrança Pix.");
      }
      const payload =
        kind === "buttons"
          ? { number, title: title.trim(), buttons: entries.map((displayText, index) => ({ type: "reply", displayText, id: `reply_${index + 1}` })) }
          : kind === "pix"
            ? {
                number,
                title: title.trim(),
                description: [body.trim(), `Valor: R$ ${charge?.amount.replace(".", ",")}`].filter(Boolean).join("\n"),
                buttons: [{ type: "url", displayText: "Abrir pagamento", url: charge?.paymentUrl }],
              }
            : kind === "copy"
              ? {
                  number,
                  title: title.trim(),
                  ...(body.trim() && { description: body.trim() }),
                  buttons: [{ type: "copy", displayText: "Copiar código", copyCode }, ...(paymentUrl.trim() ? [{ type: "url", displayText: "Abrir página", url: paymentUrl.trim() }] : [])],
                }
              : kind === "list"
                ? {
                    number,
                    title: title.trim(),
                    description: body.trim(),
                    buttonText: cta.trim(),
                    sections: [{ title: title.trim().slice(0, 24), rows: entries.map((rowTitle, index) => ({ title: rowTitle, description: "", rowId: `row_${index + 1}` })) }],
                  }
                : kind === "poll"
                  ? { number, name: title.trim(), selectableCount, values: entries }
                  : { number, flowId: flowId.trim(), body: body.trim(), cta: cta.trim(), ...(title.trim() && { header: title.trim() }), ...(screenId.trim() && { screenId: screenId.trim() }) };
      await api.post(`/message/${routes[kind]}/${instanceName}`, payload, { headers: { apikey: token } });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["chats", "findMessages"] }), queryClient.invalidateQueries({ queryKey: ["chats", "findChats"] })]);
      setOpen(false);
      setTitle("");
      setBody("");
      setCta("");
      setItems(["", ""]);
      setFlowId("");
      setScreenId("");
      setCopyCode("");
      setPaymentUrl("");
      setPixKey("");
      setAmount("");
    } catch (cause: any) {
      setError(cause?.response?.data?.response?.message || cause?.response?.data?.message || cause?.message || "Não foi possível enviar a mensagem.");
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
            <Button
              key={option}
              type="button"
              variant={kind === option ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setKind(option);
                setError("");
              }}>
              {labels[option]}
            </Button>
          ))}
        </div>
        <div className="grid gap-3">
          {kind !== "flow" && (
            <Input
              aria-label={kind === "poll" ? "Pergunta da enquete" : "Título"}
              placeholder={kind === "poll" ? "Pergunta da enquete" : "Título"}
              maxLength={60}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
          {kind === "flow" && (
            <>
              <p className="text-sm text-muted-foreground">Informe o ID de um Flow publicado no WhatsApp Manager.</p>
              <Input aria-label="ID do Flow" placeholder="ID do Flow publicado" value={flowId} onChange={(event) => setFlowId(event.target.value)} />
              <Input aria-label="Cabeçalho opcional" placeholder="Cabeçalho (opcional)" maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input aria-label="Tela inicial opcional" placeholder="ID da tela inicial (opcional)" value={screenId} onChange={(event) => setScreenId(event.target.value)} />
            </>
          )}
          {(kind === "list" || kind === "flow" || kind === "copy" || kind === "pix") && (
            <Textarea
              aria-label="Texto da mensagem"
              placeholder={kind === "copy" || kind === "pix" ? "Descrição da cobrança (opcional)" : "Texto da mensagem"}
              maxLength={1024}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          )}
          {(kind === "list" || kind === "flow") && <Input aria-label="Texto do botão" placeholder="Texto do botão" maxLength={20} value={cta} onChange={(event) => setCta(event.target.value)} />}
          {kind === "pix" && (
            <>
              <Input aria-label="Chave Pix do recebedor" placeholder="Chave Pix do recebedor" maxLength={77} value={pixKey} onChange={(event) => setPixKey(event.target.value)} />
              <Input aria-label="Nome do recebedor" placeholder="Nome do recebedor" maxLength={25} value={merchantName} onChange={(event) => setMerchantName(event.target.value)} />
              <Input aria-label="Cidade do recebedor" placeholder="Cidade do recebedor" maxLength={15} value={merchantCity} onChange={(event) => setMerchantCity(event.target.value)} />
              <Input aria-label="Valor em reais" placeholder="Valor em reais (ex.: 25,00)" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              <p className="text-xs text-muted-foreground">O código Pix e a página de pagamento serão gerados automaticamente para esse valor. A confirmação do pagamento deve ser feita no banco.</p>
            </>
          )}
          {kind === "copy" && (
            <>
              <Textarea aria-label="Código para copiar" placeholder="Código para copiar" value={copyCode} onChange={(event) => setCopyCode(event.target.value)} />
              <Input type="url" aria-label="URL da página" placeholder="https://... página opcional" value={paymentUrl} onChange={(event) => setPaymentUrl(event.target.value)} />
              {paymentUrl.trim() && !validPaymentUrl && <p className="text-xs text-destructive">Informe uma URL HTTPS válida.</p>}
              <p className="text-xs text-muted-foreground">O código será copiado exatamente como informado.</p>
            </>
          )}
          {kind !== "flow" && kind !== "copy" && kind !== "pix" && (
            <div className="grid gap-2">
              <span className="text-sm font-medium">{kind === "poll" ? "Opções" : kind === "list" ? "Itens da lista" : "Botões"}</span>
              {items.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    aria-label={`Opção ${index + 1}`}
                    placeholder={`Opção ${index + 1}`}
                    maxLength={kind === "list" ? 24 : 20}
                    value={item}
                    onChange={(event) => setItems((current) => current.map((value, position) => (position === index ? event.target.value : value)))}
                  />
                  {items.length > (kind === "poll" ? 2 : 1) && (
                    <Button type="button" variant="outline" onClick={() => setItems((current) => current.filter((_, position) => position !== index))}>
                      Remover
                    </Button>
                  )}
                </div>
              ))}
              {items.length < (kind === "buttons" ? 3 : 10) && (
                <Button type="button" variant="outline" onClick={() => setItems((current) => [...current, ""])}>
                  Adicionar opção
                </Button>
              )}
            </div>
          )}
          {kind === "poll" && (
            <label className="text-sm">
              Máximo de escolhas
              <Input type="number" min={1} max={Math.max(1, entries.length)} value={selectableCount} onChange={(event) => setSelectableCount(Number(event.target.value))} />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="button" disabled={!valid || sending} onClick={send}>
            {sending ? "Enviando..." : `Enviar ${labels[kind].toLowerCase()}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
