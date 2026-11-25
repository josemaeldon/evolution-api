import axios from "axios";
import { useEffect, useState } from "react";
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
};

export default function PaymentPix() {
  const { theme } = useTheme();
  const { token } = useParams<{ token: string }>();
  const [charge, setCharge] = useState<Charge | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    axios.get<Charge>(`/pix/${encodeURIComponent(token)}`).then(({ data }) => {
      if (active) setCharge(data);
    }).catch(() => {
      if (active) setError("Este link de pagamento é inválido ou não está mais disponível.");
    });
    return () => { active = false; };
  }, [token]);

  const copy = async () => {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge.code);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o código abaixo para copiar.");
    }
  };

  return <main className="min-h-screen bg-background px-4 py-10 text-foreground">
    <div className="mx-auto max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
      <img src={theme === "dark" ? CLOUD_BR_CHAT_LOGO_DARK : CLOUD_BR_CHAT_LOGO} alt="CloudBR Chat" className="mb-6 h-11 w-auto" />
      <h1 className="text-2xl font-semibold">Pagamento via Pix</h1>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {!charge && !error && <p className="mt-5 text-muted-foreground">Carregando cobrança...</p>}
      {charge && <div className="mt-6 space-y-5">
        <div>
          <p className="text-sm text-muted-foreground">Valor solicitado</p>
          <p className="text-3xl font-semibold">{Number(charge.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          <p className="mt-2 text-sm">Recebedor: {charge.merchantName} · {charge.merchantCity}</p>
          <p className="mt-1 break-all text-sm">Chave Pix: {charge.key}</p>
          {charge.description && <p className="mt-1 text-sm text-muted-foreground">{charge.description}</p>}
        </div>
        <div className="mx-auto w-fit rounded-xl bg-white p-4"><QRCode value={charge.code} size={220} /></div>
        <div>
          <label htmlFor="pix-code" className="text-sm font-medium">Pix copia e cola</label>
          <textarea id="pix-code" readOnly value={charge.code} onFocus={(event) => event.target.select()} className="mt-2 h-28 w-full resize-none rounded-lg border bg-background p-3 text-xs break-all" />
          <Button type="button" className="mt-3 w-full" onClick={copy}>{copied ? "Código copiado" : "Copiar código Pix"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">Confira os dados do recebedor no aplicativo do seu banco antes de pagar. Esta página não confirma o pagamento automaticamente.</p>
      </div>}
    </div>
  </main>;
}
