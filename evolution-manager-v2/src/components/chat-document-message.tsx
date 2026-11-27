import { Download, Eye, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@evoapi/design-system/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/queries/api";
import { useMediaSource } from "@/lib/queries/chat/useMediaSource";
import { Message } from "@/types/evolution.types";

type PdfMedia = { base64?: string };

async function pdfBlob(source: string | undefined, message: Message, instanceName?: string, token?: string): Promise<Blob> {
  let blob: Blob | undefined;
  if (source) {
    try {
      const response = await fetch(source);
      if (response.ok) blob = await response.blob();
    } catch {
      // A media URL may be blocked by CORS; the authenticated media endpoint is the fallback.
    }
  }
  if (!blob && instanceName) {
    const response = await api.post<PdfMedia>(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, { message }, token ? { headers: { apikey: token } } : undefined);
    if (!response.data?.base64) throw new Error("PDF indisponível.");
    const dataUrl = response.data.base64.startsWith("data:") ? response.data.base64 : `data:application/pdf;base64,${response.data.base64}`;
    blob = await (await fetch(dataUrl)).blob();
  }
  if (!blob) throw new Error("PDF indisponível.");
  const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") throw new Error("O arquivo recebido não é um PDF válido.");
  return new Blob([blob], { type: "application/pdf" });
}

export function ChatDocumentMessage({ message, instanceName, token }: { message: Message; instanceName?: string; token?: string }) {
  const document = message.message?.documentMessage || message.message?.documentWithCaptionMessage?.message?.documentMessage;
  const { source, isPending, isError, refetch } = useMediaSource(message, instanceName, token, document?.mimetype || "application/octet-stream");
  const fileName = document?.fileName || "Documento";
  const isPdf = /^application\/pdf(?:;|$)/i.test(document?.mimetype || "") || /\.pdf$/i.test(fileName);
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewError, setPreviewError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const messageRef = useRef(message);
  const sourceRef = useRef(source);

  useEffect(() => {
    messageRef.current = message;
    sourceRef.current = source;
  }, [message, source]);

  useEffect(() => {
    if (!open || !isPdf) return;
    let active = true;
    let objectUrl: string | undefined;
    setPreviewUrl(undefined);
    setPreviewError("");
    pdfBlob(sourceRef.current, messageRef.current, instanceName, token)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (active) setPreviewError(error instanceof Error ? error.message : "Não foi possível abrir o PDF.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, isPdf, message.key?.id, instanceName, token]);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const blob = await pdfBlob(previewUrl || source, message, instanceName, token);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = fileName;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Não foi possível baixar o PDF.");
      setOpen(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div className="flex w-full max-w-xs items-center gap-3 rounded-lg bg-muted p-3 text-foreground">
        <FileText className="h-6 w-6 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium" title={fileName}>
            {fileName}
          </span>
          {!source && <span className="text-xs text-muted-foreground">{isPending && instanceName ? "Carregando documento..." : "Documento indisponível"}</span>}
          {isError && (
            <button type="button" className="block text-xs text-primary underline" onClick={() => refetch()}>
              Tentar novamente
            </button>
          )}
          {isPdf ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
                <Eye className="mr-1 h-4 w-4" />
                Visualizar
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={downloading} onClick={downloadPdf}>
                <Download className="mr-1 h-4 w-4" />
                {downloading ? "Baixando..." : "Baixar"}
              </Button>
            </div>
          ) : source ? (
            <a href={source} download={fileName} className="mt-1 inline-block text-xs underline">
              Baixar documento
            </a>
          ) : null}
        </div>
      </div>
      {isPdf && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex h-[min(92dvh,900px)] w-[min(96vw,1100px)] max-w-none flex-col gap-3 overflow-hidden p-3 sm:p-5">
            <DialogHeader className="min-w-0 pr-8">
              <DialogTitle className="truncate" title={fileName}>
                {fileName}
              </DialogTitle>
              <DialogDescription>Visualização do PDF recebido na conversa.</DialogDescription>
            </DialogHeader>
            {previewUrl ? (
              <iframe title={`PDF: ${fileName}`} src={previewUrl} className="min-h-0 w-full flex-1 rounded border bg-white" />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">{previewError || "Carregando PDF..."}</div>
            )}
            <div className="flex justify-end">
              <Button type="button" disabled={downloading} onClick={downloadPdf}>
                <Download className="mr-2 h-4 w-4" />
                {downloading ? "Baixando..." : "Baixar PDF"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
