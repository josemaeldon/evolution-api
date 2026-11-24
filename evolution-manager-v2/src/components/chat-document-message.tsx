import { FileDown } from "lucide-react";

import { useMediaSource } from "@/lib/queries/chat/useMediaSource";
import { Message } from "@/types/evolution.types";

export function ChatDocumentMessage({ message, instanceName, token }: { message: Message; instanceName?: string; token?: string }) {
  const document = message.message?.documentMessage || message.message?.documentWithCaptionMessage?.message?.documentMessage;
  const { source, isPending, isError, refetch } = useMediaSource(message, instanceName, token, document?.mimetype || "application/octet-stream");
  const fileName = document?.fileName || "Documento";

  return (
    <div className="flex max-w-xs items-center gap-2 rounded-lg bg-muted p-3 text-foreground">
      <FileDown className="h-6 w-6 shrink-0" />
      <div className="min-w-0">
        {source ? (
          <a href={source} download={fileName} className="block truncate font-medium underline" title={fileName}>
            {fileName}
          </a>
        ) : (
          <span className="block truncate font-medium" title={fileName}>{fileName}</span>
        )}
        {!source && <span className="text-xs text-muted-foreground">{isPending && instanceName ? "Carregando documento..." : "Documento indisponível"}</span>}
        {isError && <button type="button" className="block text-xs text-primary underline" onClick={() => refetch()}>Tentar novamente</button>}
      </div>
    </div>
  );
}
