import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { Button } from "@evoapi/design-system/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/queries/api";

type Settings = {
  clientId: string;
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  tokenUrl: string;
  apiUrl: string;
  sandboxMode: boolean;
  expiresIn: number;
  hasCert?: boolean;
  hasKey?: boolean;
  hasCa?: boolean;
  hasClientSecret?: boolean;
};

const defaults: Settings = {
  clientId: "",
  pixKey: "",
  merchantName: "",
  merchantCity: "",
  tokenUrl: "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token",
  apiUrl: "https://api.sicoob.com.br",
  sandboxMode: false,
  expiresIn: 900,
};

export function SicoobSettings({ instanceName }: { instanceName: string }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [secret, setSecret] = useState("");
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<Settings | null>(`/pix/sicoob-settings/${encodeURIComponent(instanceName)}`)
      .then(({ data }) => {
        if (active && data) setSettings(data);
      })
      .catch(() => {
        if (active) toast.error("Não foi possível carregar a configuração Sicoob.");
      });
    return () => {
      active = false;
    };
  }, [instanceName]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const form = new FormData();
      for (const key of ["clientId", "pixKey", "merchantName", "merchantCity", "tokenUrl", "apiUrl", "sandboxMode", "expiresIn"] as const) {
        form.set(key, String(settings[key]));
      }
      if (secret) form.set("clientSecret", secret);
      for (const key of ["cert", "key", "ca"]) if (files[key]) form.set(key, files[key]!);
      const { data } = await api.post(`/pix/sicoob-settings/${encodeURIComponent(instanceName)}`, form);
      setSettings((current) => ({ ...current, hasCert: true, hasKey: true, hasCa: current.hasCa || Boolean(files.ca), hasClientSecret: current.hasClientSecret || Boolean(secret) }));
      setSecret("");
      setFiles({});
      toast.success(data.webhookRegistered ? "Sicoob salvo e webhook registrado." : "Sicoob salvo. Pagamentos serão verificados automaticamente.");
    } catch (error: any) {
      toast.error(error?.response?.data?.response?.message || error?.response?.data?.message || "Não foi possível salvar o Sicoob.");
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Pick<Settings, "clientId" | "pixKey" | "merchantName" | "merchantCity" | "tokenUrl" | "apiUrl">, label: string) => (
    <label className="grid min-w-0 gap-1 text-sm font-medium" key={key}>
      {label}
      <Input required value={settings[key]} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value }))} />
    </label>
  );
  const file = (key: "cert" | "key" | "ca", label: string, saved?: boolean) => (
    <label className="grid min-w-0 gap-1 text-sm font-medium" key={key}>
      {label} {saved && <span className="text-xs font-normal text-muted-foreground">(salvo)</span>}
      <Input type="file" accept=".pem,.crt,.key,text/plain" required={key !== "ca" && !saved} onChange={(event) => setFiles((current) => ({ ...current, [key]: event.target.files?.[0] }))} />
    </label>
  );

  const testConnection = async () => {
    setTesting(true);
    try {
      await api.post(`/pix/sicoob-settings/${encodeURIComponent(instanceName)}/test`);
      toast.success("Autenticação Sicoob validada.");
    } catch (error: any) {
      toast.error(error?.response?.data?.response?.message || "Falha ao conectar ao Sicoob.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5 rounded-xl border p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-medium">Cobranças</h1>
        <p className="text-sm text-muted-foreground">Configure o Pix Sicoob para enviar cobranças no chat com confirmação automática e comprovante PDF.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.sandboxMode}
          onChange={(event) =>
            setSettings((current) => ({ ...current, sandboxMode: event.target.checked, apiUrl: event.target.checked ? "https://sandbox.sicoob.com.br/sicoob/sandbox" : "https://api.sicoob.com.br" }))
          }
        />
        Modo sandbox
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("clientId", "Client ID")}
        <label className="grid gap-1 text-sm font-medium">
          Client Secret {settings.hasClientSecret && <span className="text-xs font-normal text-muted-foreground">(salvo; deixe vazio para manter)</span>}
          <Input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
        </label>
        {field("pixKey", "Chave Pix")}
        {field("merchantName", "Nome do recebedor")}
        {field("merchantCity", "Cidade do recebedor")}
        <label className="grid gap-1 text-sm font-medium">
          Expiração da cobrança (segundos)
          <Input type="number" min={60} max={86400} required value={settings.expiresIn} onChange={(event) => setSettings((current) => ({ ...current, expiresIn: Number(event.target.value) }))} />
        </label>
      </div>
      {field("tokenUrl", "URL de autenticação")}
      {field("apiUrl", "URL base da API")}
      <div className="grid gap-4 sm:grid-cols-3">
        {file("cert", "Certificado cliente PEM", settings.hasCert)}
        {file("key", "Chave privada PEM", settings.hasKey)}
        {file("ca", "Cadeia/CA PEM (opcional)", settings.hasCa)}
      </div>
      <p className="text-xs text-muted-foreground">
        Os certificados são persistidos de forma criptografada para esta instância. Configure SICOOB_CREDENTIALS_KEY no servidor e mantenha a chave nos backups.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar Sicoob"}
        </Button>
        <Button type="button" variant="outline" disabled={saving || testing || !settings.hasCert} onClick={testConnection}>
          {testing ? "Testando..." : "Testar conexão"}
        </Button>
      </div>
    </form>
  );
}
