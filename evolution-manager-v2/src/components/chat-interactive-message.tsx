import { useState } from "react";

import { Message } from "@/types/evolution.types";

const parse = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, any>;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
};

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

const unwrap = (value: unknown): Record<string, any> => {
  let current = parse(value);
  for (let step = 0; step < 4; step++) {
    const nested = current.viewOnceMessage?.message || current.viewOnceMessageV2?.message || current.ephemeralMessage?.message || current.deviceSentMessage?.message;
    if (!nested) break;
    current = parse(nested);
  }
  return current;
};

const safeUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

export function ChatInteractiveMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const content = unwrap(message.message);
  const response = content.buttonsResponseMessage || content.templateButtonReplyMessage || content.listResponseMessage || content.interactiveResponseMessage ||
    (["buttonsResponseMessage", "templateButtonReplyMessage", "listResponseMessage", "interactiveResponseMessage"].includes(message.messageType) ? content : null);
  if (response) {
    const label = response.selectedDisplayText || response.title || response.buttonText || response.body?.text || response.singleSelectReply?.selectedRowId || response.selectedButtonId || "Opção selecionada";
    return <span className="whitespace-pre-wrap">{label}</span>;
  }

  const poll = content.pollCreationMessageV3 || content.pollCreationMessageV2 || content.pollCreationMessage ||
    (message.messageType.startsWith("pollCreationMessage") ? content : null);
  if (poll) return <div className="space-y-2">
    <p className="font-medium">{poll.name || "Enquete"}</p>
    {asArray(poll.options).map((option: any, index: number) => <div key={index} className="rounded-md border px-3 py-2 text-sm">{option.optionName || option.name || `Opção ${index + 1}`}</div>)}
    <p className="text-xs opacity-70">{poll.selectableOptionsCount > 1 ? `Até ${poll.selectableOptionsCount} escolhas` : "Uma escolha"}</p>
  </div>;
  if (content.pollUpdateMessage || message.messageType === "pollUpdateMessage") {
    const selected = (content.pollUpdateMessage || content).vote?.selectedOptions;
    return <span>{Array.isArray(selected) && selected.every((option) => typeof option === "string") && selected.length ? `Voto: ${selected.join(", ")}` : "Voto registrado na enquete"}</span>;
  }

  const list = content.listMessage || (message.messageType === "listMessage" ? content : null);
  if (list) return <div className="space-y-2">
    <p className="font-medium">{list.title || "Lista"}</p>
    {list.description && <p className="whitespace-pre-wrap">{list.description}</p>}
    {asArray(list.sections).map((section: any, index: number) => <div key={index} className="space-y-1">
      {section.title && <p className="text-xs font-semibold opacity-75">{section.title}</p>}
      {asArray(section.rows).map((row: any, rowIndex: number) => <div key={row.rowId || rowIndex} className="rounded-md border px-3 py-2">
        <p>{row.title}</p>{row.description && <p className="text-xs opacity-70">{row.description}</p>}
      </div>)}
    </div>)}
  </div>;

  const interactive = content.interactiveMessage || (message.messageType === "interactiveMessage" ? content : null);
  const buttonsMessage = content.buttonsMessage || (message.messageType === "buttonsMessage" ? content : null);
  const buttons = interactive?.nativeFlowMessage?.buttons || buttonsMessage?.buttons;
  if (interactive || buttons) {
    const body = interactive?.body?.text || buttonsMessage?.contentText || buttonsMessage?.text || "Mensagem interativa";
    return <div className="min-w-56 max-w-sm space-y-2">
      <p className="whitespace-pre-wrap">{body}</p>
      {asArray(buttons).map((button: any, index: number) => {
        const params = parse(button.buttonParamsJson);
        const label = params.display_text || button.buttonText?.displayText || button.displayText || `Opção ${index + 1}`;
        const copyCode = params.copy_code;
        const url = safeUrl(params.url);
        if (button.name === "payment_info") {
          const payment = asArray(params.payment_settings).find((setting: any) => setting.type === "pix_static_code")?.pix_static_code;
          const amount = params.total_amount?.value;
          return <div key={index} className="rounded-md border px-3 py-2 text-sm">
            <p className="font-medium">Pagamento Pix</p>
            {payment?.merchant_name && <p>{payment.merchant_name}</p>}
            {typeof amount === "number" && amount > 0 && <p>{(amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>}
            {payment?.key && <p className="break-all text-xs">Chave: {payment.key}</p>}
          </div>;
        }
        return <div key={index} className="space-y-1">
          {copyCode && <textarea readOnly aria-label="Código para copiar" value={copyCode} onFocus={(event) => event.target.select()} className="h-20 w-full resize-none rounded-md border bg-background p-2 text-xs break-all" />}
          {copyCode ? <button type="button" className="w-full rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-muted" onClick={async () => {
            try { await navigator.clipboard.writeText(copyCode); setCopied(true); } catch { setCopied(false); }
          }}>{copied ? "Código copiado" : label}</button>
            : url ? <a className="block rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-muted" href={url} target="_blank" rel="noopener noreferrer">{label}</a>
              : <div className="rounded-md border px-3 py-2 text-center text-sm opacity-80">{label}</div>}
        </div>;
      })}
    </div>;
  }

  return <span className="whitespace-pre-wrap">{content.conversation || content.text || "Mensagem interativa"}</span>;
}
