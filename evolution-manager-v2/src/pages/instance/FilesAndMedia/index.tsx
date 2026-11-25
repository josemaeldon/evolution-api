import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";

import { Input } from "@/components/ui/input";
import { saasApi } from "@/lib/queries/saas";

type ManagedMedia = {
  id: string;
  fileName: string;
  type: string;
  mimetype: string;
  sizeBytes: number;
  createdAt: string | null;
  Instance: { name: string };
};

type MediaPage = {
  items: ManagedMedia[];
  total: number;
  page: number;
  pageSize: number;
  usedBytes: number;
  fileCount: number;
};

type StorageInfo = { usedBytes: number; fileCount: number; storageQuotaMb: number; storageEnabled: boolean };

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export default function FilesAndMedia() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: storage } = useQuery<StorageInfo>({
    queryKey: ["saas", "storage"],
    queryFn: async () => (await saasApi.get("/saas/storage")).data,
  });
  const { data, isPending, isError } = useQuery<MediaPage>({
    queryKey: ["saas", "media", page, search, type],
    queryFn: async () =>
      (
        await saasApi.get("/saas/media", {
          params: { page, pageSize: 50, search: search || undefined, type: type || undefined },
        })
      ).data,
  });

  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));
  const allPageSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));
  const usedBytes = storage?.usedBytes ?? data?.usedBytes ?? 0;
  const quotaBytes = (storage?.storageQuotaMb ?? 0) * 1024 * 1024;
  const usagePercent = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : usedBytes > 0 ? 100 : 0;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["saas", "media"] }),
      queryClient.invalidateQueries({ queryKey: ["saas", "storage"] }),
      queryClient.invalidateQueries({ queryKey: ["saas", "companies"] }),
    ]);
  };

  const toggleAll = () => {
    setSelectedIds((current) =>
      allPageSelected ? current.filter((id) => !items.some((item) => item.id === id)) : Array.from(new Set([...current, ...items.map((item) => item.id)])),
    );
  };

  const deleteSelected = async () => {
    if (!selectedIds.length || busy) return;
    const confirmed = window.confirm(`Excluir ${selectedIds.length} arquivo(s) permanentemente?`);
    if (!confirmed) return;

    setBusy(true);
    try {
      let deleted = 0;
      for (let index = 0; index < selectedIds.length; index += 500) {
        const result = await saasApi.delete("/saas/media", { data: { ids: selectedIds.slice(index, index + 500) } });
        deleted += result.data.deleted;
      }
      setSelectedIds([]);
      await refresh();
      toast.success(`${deleted} arquivo(s) excluído(s)`);
    } catch (error) {
      const response = (error as { response?: { data?: { error?: string } } })?.response;
      toast.error(response?.data?.error || "Não foi possível excluir os arquivos selecionados.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const openMedia = async (mediaId: string) => {
    try {
      const { data: result } = await saasApi.get(`/saas/media/${mediaId}/url`);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Não foi possível abrir este arquivo.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Arquivos e Mídias</h1>
        <p className="text-sm text-muted-foreground">Gerencie os arquivos recebidos nas conversas de todas as instâncias da empresa.</p>
      </header>

      {storage?.storageEnabled === false && <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">O armazenamento MinIO/S3 não está habilitado neste servidor.</p>}

      <section className="space-y-3 rounded-lg border p-4" aria-label="Cota de armazenamento">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Uso de armazenamento</span>
          <span className="font-medium">{formatSize(usedBytes)} de {storage?.storageQuotaMb ?? 0} MB · {storage?.fileCount ?? data?.fileCount ?? 0} arquivos</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${usagePercent}%` }} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap gap-3">
          <label className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" aria-label="Buscar arquivos" placeholder="Buscar arquivo ou instância" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </label>
          <select aria-label="Filtrar por tipo" className="h-10 rounded-md border bg-background px-3 text-sm" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
            <option value="">Todos os tipos</option>
            <option value="image">Imagens</option>
            <option value="video">Vídeos</option>
            <option value="audio">Áudios</option>
            <option value="document">Documentos</option>
            <option value="sticker">Figurinhas</option>
          </select>
          <Button type="button" variant="destructive" disabled={!selectedIds.length || busy} onClick={deleteSelected}>
            <Trash2 className="mr-2 h-4 w-4" /> Excluir selecionados ({selectedIds.length})
          </Button>
        </div>

        {isPending ? <p className="py-10 text-center text-sm text-muted-foreground">Carregando arquivos...</p> : null}
        {isError ? <p className="py-10 text-center text-sm text-destructive">Não foi possível carregar os arquivos.</p> : null}
        {!isPending && !isError && items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhum arquivo encontrado.</p> : null}

        {items.length > 0 && (
          <>
            <div className="flex items-center gap-3 border-b pb-3 text-sm">
              <input aria-label="Selecionar todos desta página" type="checkbox" checked={allPageSelected} onChange={toggleAll} />
              <span>{data?.total ?? 0} arquivos</span>
            </div>
            <div className="divide-y">
              {items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                  <input
                    aria-label={`Selecionar ${item.fileName}`}
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}
                  />
                  <File className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <button className="block max-w-full truncate text-left font-medium hover:underline" type="button" onClick={() => openMedia(item.id)} title={item.fileName}>
                      {item.fileName.split("/").pop() || item.fileName}
                    </button>
                    <p className="text-xs text-muted-foreground">{item.Instance.name} · {item.type} · {item.mimetype}</p>
                  </div>
                  <span className="text-sm text-muted-foreground">{formatSize(item.sizeBytes)}</span>
                  <span className="w-28 text-right text-xs text-muted-foreground">{item.createdAt ? new Date(item.createdAt).toLocaleDateString("pt-BR") : "—"}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span>Página {page} de {totalPages}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
                <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
