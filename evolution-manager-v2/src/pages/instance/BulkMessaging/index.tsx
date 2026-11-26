import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/contexts/InstanceContext";
import { saasApi } from "@/lib/queries/saas";

type Label = { id: string; name: string; color: string };
type Campaign = { id: string; status: string; message: string; createdAt: string; counts: Record<string, number> };
type Organization = { labels: Label[] };

const statusLabel: Record<string, string> = { queued: "Na fila", processing: "Em andamento", paused: "Pausada", completed: "Concluída" };

export default function BulkMessaging() {
  const { instance } = useInstance();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [randomCount, setRandomCount] = useState("");
  const [mode, setMode] = useState<"labels" | "random">("labels");
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const organization = useQuery<Organization>({
    queryKey: ["contactOrganization", instance?.id],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instance?.id}/organization`)).data,
    enabled: !!instance?.id,
  });
  const campaigns = useQuery<Campaign[]>({
    queryKey: ["bulkCampaigns", instance?.id],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instance?.id}/campaigns`)).data,
    enabled: !!instance?.id,
    refetchInterval: 15000,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bulkCampaigns", instance?.id] });
    queryClient.invalidateQueries({ queryKey: ["contactOrganization", instance?.id] });
  };
  const createCampaign = async () => {
    if (!instance || !message.trim() || !confirmedConsent) return;
    try {
      await saasApi.post(`/saas/instance/${instance.id}/campaigns`, {
        message: message.trim(),
        labelIds: mode === "labels" ? selectedLabels : [],
        randomCount: mode === "random" ? Number(randomCount) : 0,
      });
      setMessage("");
      setConfirmedConsent(false);
      setSelectedLabels([]);
      setRandomCount("");
      invalidate();
      toast.success("Campanha adicionada à fila");
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Não foi possível criar a campanha");
    }
  };
  const setCampaignStatus = async (campaignId: string, status: "queued" | "paused") => {
    if (!instance) return;
    try {
      await saasApi.patch(`/saas/instance/${instance.id}/campaigns/${campaignId}`, { status });
      invalidate();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Não foi possível atualizar a campanha");
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Envio em Massa</h1>
        <p className="mt-1 text-sm text-muted-foreground">Envie uma mensagem por vez para contatos que autorizaram receber comunicações.</p>
      </header>
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="font-semibold">Nova campanha</h2>
          <p className="mt-1 text-xs text-muted-foreground">O sistema envia um destinatário a cada 30 segundos. Esse limite organiza a fila e não garante que o WhatsApp não aplique restrições.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant={mode === "labels" ? "default" : "outline"} onClick={() => setMode("labels")}>
            Por etiquetas
          </Button>
          <Button type="button" variant={mode === "random" ? "default" : "outline"} onClick={() => setMode("random")}>
            Seleção aleatória
          </Button>
        </div>
        {mode === "labels" ? (
          <div className="flex flex-wrap gap-3">
            {(organization.data?.labels || []).map((label) => (
              <label key={label.id} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedLabels.includes(label.id)}
                  onChange={(event) => setSelectedLabels(event.target.checked ? [...selectedLabels, label.id] : selectedLabels.filter((id) => id !== label.id))}
                />
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                {label.name}
              </label>
            ))}
            {!organization.data?.labels.length && <p className="text-sm text-muted-foreground">Crie etiquetas no menu Etiquetas.</p>}
          </div>
        ) : (
          <div className="max-w-xs">
            <label htmlFor="randomCount" className="mb-1 block text-sm font-medium">
              Quantidade aleatória (máximo 500)
            </label>
            <Input id="randomCount" type="number" min={1} max={500} value={randomCount} onChange={(event) => setRandomCount(event.target.value)} placeholder="Ex.: 50" />
          </div>
        )}
        <div>
          <label htmlFor="bulkMessage" className="mb-1 block text-sm font-medium">
            Mensagem
          </label>
          <Textarea id="bulkMessage" rows={5} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escreva a mensagem da campanha" />
          <div className="mt-1 text-right text-xs text-muted-foreground">{message.length}/4000</div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmedConsent} onChange={(event) => setConfirmedConsent(event.target.checked)} className="mt-1" />
          <span>Confirmo que os contatos selecionados autorizaram receber esta mensagem. Contatos sem autorização são excluídos automaticamente.</span>
        </label>
        <Button onClick={createCampaign} disabled={!message.trim() || !confirmedConsent || (mode === "labels" ? !selectedLabels.length : !Number(randomCount) || Number(randomCount) > 500)}>
          <Send className="mr-2 h-4 w-4" />
          Adicionar à fila
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 font-semibold">Campanhas recentes</h2>
        <div className="space-y-3">
          {(campaigns.data || []).map((campaign) => {
            const total = Object.values(campaign.counts || {}).reduce((sum, count) => sum + count, 0);
            const canToggle = campaign.status === "queued" || campaign.status === "processing" || campaign.status === "paused";
            return (
              <article key={campaign.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{statusLabel[campaign.status] || campaign.status}</span>
                    <span className="text-xs text-muted-foreground">
                      {campaign.counts?.sent || 0}/{total} enviados · {campaign.counts?.failed || 0} falhas
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{campaign.message}</p>
                  <time className="text-xs text-muted-foreground">{new Date(campaign.createdAt).toLocaleString("pt-BR")}</time>
                </div>
                {canToggle && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setCampaignStatus(campaign.id, campaign.status === "paused" ? "queued" : "paused")}>
                    {campaign.status === "paused" ? <Play className="mr-1.5 h-4 w-4" /> : <Pause className="mr-1.5 h-4 w-4" />}
                    {campaign.status === "paused" ? "Retomar" : "Pausar"}
                  </Button>
                )}
              </article>
            );
          })}
          {!campaigns.data?.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma campanha criada.</p>}
        </div>
      </div>
    </section>
  );
}
