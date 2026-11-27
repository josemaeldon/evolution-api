import axios from "axios";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { useParams } from "react-router-dom";

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
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (!charge?.expiresAt || charge.status === "paid") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [charge?.expiresAt, charge?.status]);

  const expiresAt = charge?.expiresAt ? new Date(charge.expiresAt).getTime() : null;
  const secondsRemaining = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null;
  const isPaid = charge?.status === "paid";
  const isExpired = !isPaid && secondsRemaining === 0;
  const countdown = secondsRemaining === null
    ? null
    : [Math.floor(secondsRemaining / 3600), Math.floor((secondsRemaining % 3600) / 60), secondsRemaining % 60]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");

  const copyPixCode = async () => {
    if (!charge?.code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(charge.code);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = charge.code;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Clipboard unavailable");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
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
                <div
                  role="status"
                  className={`rounded-lg border p-4 text-sm ${
                    isPaid ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300" : isExpired ? "border-destructive/30 bg-destructive/10 text-destructive" : "bg-muted/40"
                  }`}>
                  {isPaid ? (
                    <>
                      <p className="font-semibold">Pagamento confirmado!</p>
                      <p className="mt-1">{charge.receiptSent ? "O comprovante foi enviado na conversa." : "O comprovante será enviado na conversa."}</p>
                    </>
                  ) : isExpired ? (
                    <p className="font-semibold">Esta cobrança expirou. Solicite um novo link.</p>
                  ) : (
                    <>
                      <p className="font-medium">Aguardando pagamento. Esta página é atualizada automaticamente.</p>
                      {countdown && <p className="mt-2">QR Code expira em <span className="font-semibold tabular-nums">{countdown}</span></p>}
                    </>
                  )}
                </div>
              )}
              <section className="rounded-2xl border bg-muted/40 p-5 sm:p-6" aria-label="Valor solicitado">
                <p className="text-sm text-muted-foreground">Valor solicitado</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{Number(charge.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                {charge.description && <p className="mt-3 break-words text-sm text-muted-foreground">{charge.description}</p>}
              </section>

              {!isPaid && !isExpired && (
                <>
                  <section aria-label="QR Code Pix" className="text-center">
                    <p className="text-sm font-medium">Escaneie com o aplicativo do seu banco</p>
                    <div className="mx-auto mt-4 w-full max-w-[264px] rounded-2xl border bg-white p-4 shadow-sm">
                      <QRCode value={charge.code} size={232} style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
                    </div>
                  </section>

                  <section aria-label="Código Pix copia e cola" className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Pix copia e cola</p>
                      <button type="button" onClick={copyPixCode} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                        {copied ? "Copiado!" : "Copiar código"}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      aria-label="Código Pix para copiar e colar no aplicativo do banco"
                      value={charge.code}
                      onFocus={(event) => event.currentTarget.select()}
                      className="h-24 w-full resize-y rounded-lg border bg-background p-3 text-xs leading-relaxed break-all"
                    />
                    <p className="text-xs text-muted-foreground">Copie o código e cole na opção Pix copia e cola do aplicativo do seu banco.</p>
                  </section>
                </>
              )}

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
