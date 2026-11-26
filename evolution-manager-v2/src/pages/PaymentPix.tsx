import axios from "axios";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { useParams } from "react-router-dom";

import { Button } from "@evoapi/design-system/button";
import { useTheme } from "@/components/theme-provider";
import { CLOUD_BR_CHAT_LOGO, CLOUD_BR_CHAT_LOGO_DARK } from "@/lib/branding";

type Charge = {
  key: string;
  code: string;
  amount: string;
  merchantName: string;
  merchantCity: string;
  description?: string;
  txid: string;
  provider?: string;
  status?: string;
  paidAt?: string;
  expiresAt?: string;
  receiptSent?: boolean;
};

export default function PaymentPix() {
  const { theme } = useTheme();
  const { token, instanceId, id } = useParams<{ token?: string; instanceId?: string; id?: string }>();
  const [charge, setCharge] = useState<Charge | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const path = instanceId && id ? `/pix/${encodeURIComponent(instanceId)}/${encodeURIComponent(id)}` : token ? `/pix/${encodeURIComponent(token)}` : null;
    if (!path) return;
    let active = true;
    const fetchCharge = () =>
      axios
        .get<Charge>(path)
        .then(({ data }) => {
          if (active) setCharge(data);
        })
        .catch(() => {
          if (active) setError("Este link de pagamento é inválido ou não está mais disponível.");
        });
    fetchCharge();
    const timer = window.setInterval(() => {
      fetchCharge();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token, instanceId, id]);

  const copy = async () => {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge.code);
      setCopied(true);
    } catch {
      codeRef.current?.focus();
      codeRef.current?.select();
      if (document.execCommand("copy")) {
        setCopied(true);
      } else {
        setError("Selecione o código abaixo para copiar.");
      }
    }
  };

  return (
    <main className="h-[100dvh] overflow-y-auto overscroll-y-contain bg-muted/30 px-3 py-5 text-foreground sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-sm sm:rounded-3xl">
        <div className="border-b px-5 py-5 sm:px-8">
          <img src={theme === "dark" ? CLOUD_BR_CHAT_LOGO_DARK : CLOUD_BR_CHAT_LOGO} alt="CloudBR Chat" className="h-9 max-w-full object-contain object-left" />
        </div>

        <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Cobrança Pix</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Detalhes do pagamento</h1>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {!charge && !error && <p className="text-sm text-muted-foreground">Carregando cobrança...</p>}

          {charge && (
            <>
              {charge.provider === "sicoob" && (
                <p role="status" className="rounded-lg border p-3 text-sm">
                  {charge.status === "paid"
                    ? charge.receiptSent
                      ? "Pagamento confirmado pelo Sicoob. O comprovante foi enviado na conversa."
                      : "Pagamento confirmado pelo Sicoob. O comprovante será enviado na conversa."
                    : charge.expiresAt && Date.now() > new Date(charge.expiresAt).getTime()
                      ? "Esta cobrança expirou. Solicite um novo link."
                      : "Aguardando pagamento. Esta página será atualizada automaticamente."}
                </p>
              )}
              <section className="rounded-2xl border bg-muted/40 p-5 sm:p-6" aria-label="Valor solicitado">
                <p className="text-sm text-muted-foreground">Valor solicitado</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{Number(charge.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                {charge.description && <p className="mt-3 break-words text-sm text-muted-foreground">{charge.description}</p>}
              </section>

              <section aria-label="QR Code Pix" className="text-center">
                <p className="text-sm font-medium">Escaneie com o aplicativo do seu banco</p>
                <div className="mx-auto mt-4 w-full max-w-[264px] rounded-2xl border bg-white p-4 shadow-sm">
                  <QRCode value={charge.code} size={232} style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
                </div>
              </section>

              <section className="min-w-0 space-y-3" aria-label="Pix copia e cola">
                <label htmlFor="pix-code" className="block text-sm font-medium">
                  Ou copie o código Pix
                </label>
                <textarea
                  ref={codeRef}
                  id="pix-code"
                  readOnly
                  value={charge.code}
                  onFocus={(event) => event.target.select()}
                  className="h-24 w-full min-w-0 resize-none rounded-xl border bg-background p-3 text-xs leading-relaxed break-all"
                />
                <Button type="button" className="w-full" onClick={copy}>
                  {copied ? "Código copiado" : "Copiar código Pix"}
                </Button>
              </section>

              <div className="min-w-0 border-t pt-5 text-sm">
                <p className="font-medium">Recebedor</p>
                <p className="mt-1 break-words text-muted-foreground">
                  {charge.merchantName} · {charge.merchantCity}
                </p>
                <p className="mt-1 break-all text-muted-foreground">Chave Pix: {charge.key}</p>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Confira os dados do recebedor no aplicativo do seu banco antes de pagar. {charge.provider !== "sicoob" && "Esta página não confirma o pagamento automaticamente."}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
