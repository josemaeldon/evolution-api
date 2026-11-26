import { Button } from "@evoapi/design-system/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/contexts/InstanceContext";
import { api } from "@/lib/queries/api";
import { ChatForm, FormField, FormFieldType, FormSubmission } from "@/types/chat-form";

const fieldTypes: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Texto curto" },
  { value: "textarea", label: "Texto longo" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Escolha única" },
  { value: "checkbox", label: "Confirmação" },
];

const newField = (): FormField => ({ id: crypto.randomUUID(), label: "", type: "text", required: true });
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export default function ChatForms() {
  const { instance } = useInstance();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>(() => [newField()]);
  const [page, setPage] = useState(0);
  const [editingSubmissionId, setEditingSubmissionId] = useState<string | null>(null);
  const [editingAnswers, setEditingAnswers] = useState<Record<string, string | boolean>>({});
  const [savingSubmission, setSavingSubmission] = useState(false);
  const { data: forms = [], isLoading } = useQuery<ChatForm[]>({
    queryKey: ["chatForms", instance?.name],
    queryFn: async () => (await api.get(`/forms/${instance?.name}`)).data,
    enabled: !!instance?.name,
  });
  const selected = forms.find((form) => form.id === selectedId);
  const { data: submissionPage, isLoading: loadingSubmissions } = useQuery<{ items: FormSubmission[]; hasMore: boolean }>({
    queryKey: ["chatFormSubmissions", instance?.name, selectedId, page],
    queryFn: async () => (await api.get(`/forms/${instance?.name}/${selectedId}/submissions`, { params: { page } })).data,
    enabled: !!instance?.name && !!selectedId,
  });
  const submissions = submissionPage?.items || [];

  const exportSubmissions = async () => {
    if (!instance || !selected) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Permita janelas pop-up para exportar o PDF");
      return;
    }
    printWindow.opener = null;
    try {
      const allSubmissions: FormSubmission[] = [];
      let currentPage = 0;
      let hasMore = true;
      while (hasMore) {
        const { data } = await api.get<{ items: FormSubmission[]; hasMore: boolean }>(`/forms/${instance.name}/${selected.id}/submissions`, { params: { page: currentPage } });
        allSubmissions.push(...data.items);
        hasMore = data.hasMore;
        currentPage += 1;
      }
      const headers = ["Contato", "WhatsApp", "Data", ...selected.fields.map((field) => field.label)];
      const rows = allSubmissions.map((submission) => [
        submission.contactName,
        submission.remoteJid.split("@")[0],
        new Date(submission.createdAt).toLocaleString("pt-BR"),
        ...selected.fields.map((field) => {
          const answer = submission.answers[field.id];
          return answer === true ? "Sim" : answer === false ? "Não" : String(answer ?? "—");
        }),
      ]);
      const table = `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
      printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(selected.title)} - Respostas</title><style>
        @page{size:A4 landscape;margin:9mm}*{box-sizing:border-box}body{font:9px Arial,sans-serif;color:#202936;margin:0}h1{font-size:16px;margin:0 0 3px}p{font-size:9px;color:#596579;margin:0 0 10px}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #cbd3df;padding:4px 5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#edf2f8;font-weight:700}tbody tr:nth-child(even){background:#f7f9fc}th:nth-child(1),td:nth-child(1){width:13%}th:nth-child(2),td:nth-child(2){width:12%}th:nth-child(3),td:nth-child(3){width:14%}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
        </style></head><body><h1>${escapeHtml(selected.title)}</h1><p>${allSubmissions.length} respostas · Exportado em ${escapeHtml(new Date().toLocaleString("pt-BR"))}</p>${table}<script>window.onload=()=>window.print()</script></body></html>`);
      printWindow.document.close();
    } catch (cause: any) {
      printWindow.close();
      toast.error(cause?.response?.data?.error || "Não foi possível exportar as respostas");
    }
  };

  const startCreate = () => {
    setEditingFormId(null);
    setTitle("");
    setDescription("");
    setFields([newField()]);
    setCreating(true);
  };

  const startEdit = (form: ChatForm) => {
    setEditingFormId(form.id);
    setTitle(form.title);
    setDescription(form.description || "");
    setFields(form.fields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })));
    setCreating(true);
  };

  const deleteForm = async (form: ChatForm) => {
    if (!instance || !window.confirm(`Excluir o formulário “${form.title}” e os links e respostas associados?`)) return;
    try {
      await api.delete(`/forms/${instance.name}/${form.id}`);
      await queryClient.invalidateQueries({ queryKey: ["chatForms", instance.name] });
      await queryClient.removeQueries({ queryKey: ["chatFormSubmissions", instance.name, form.id] });
      if (selectedId === form.id) setSelectedId(null);
      toast.success("Formulário excluído");
    } catch (cause: any) {
      toast.error(cause?.response?.data?.error || "Não foi possível excluir o formulário");
    }
  };

  const saveSubmission = async (submissionId: string) => {
    if (!instance || !selected || savingSubmission) return;
    setSavingSubmission(true);
    try {
      await api.put(`/forms/${instance.name}/${selected.id}/submissions/${submissionId}`, { answers: editingAnswers });
      await queryClient.invalidateQueries({ queryKey: ["chatFormSubmissions", instance.name, selected.id] });
      setEditingSubmissionId(null);
      toast.success("Resposta atualizada");
    } catch (cause: any) {
      toast.error(cause?.response?.data?.error || "Não foi possível atualizar a resposta");
    } finally {
      setSavingSubmission(false);
    }
  };

  const deleteSubmission = async (submissionId: string) => {
    if (!instance || !selected || !window.confirm("Excluir esta resposta do formulário?")) return;
    try {
      await api.delete(`/forms/${instance.name}/${selected.id}/submissions/${submissionId}`);
      await queryClient.invalidateQueries({ queryKey: ["chatFormSubmissions", instance.name, selected.id] });
      toast.success("Resposta excluída");
    } catch (cause: any) {
      toast.error(cause?.response?.data?.error || "Não foi possível excluir a resposta");
    }
  };

  const updateField = (id: string, update: Partial<FormField>) => setFields((current) => current.map((field) => (field.id === id ? { ...field, ...update } : field)));

  const save = async () => {
    if (!instance || saving) return;
    const clean = fields.map((field) => ({
      ...field,
      label: field.label.trim(),
      ...(field.type === "select" ? { options: (field.options || []).map((option) => option.trim()).filter(Boolean) } : { options: undefined }),
    }));
    if (!title.trim() || clean.some((field) => !field.label || (field.type === "select" && (field.options?.length || 0) < 2))) {
      toast.error("Informe o título e preencha todos os campos do formulário");
      return;
    }
    setSaving(true);
    try {
      const response = editingFormId
        ? await api.put<ChatForm>(`/forms/${instance.name}/${editingFormId}`, { title: title.trim(), description: description.trim(), fields: clean })
        : await api.post<ChatForm>(`/forms/${instance.name}`, { title: title.trim(), description: description.trim(), fields: clean });
      await queryClient.invalidateQueries({ queryKey: ["chatForms", instance.name] });
      setSelectedId(response.data.id);
      setPage(0);
      setCreating(false);
      setTitle("");
      setDescription("");
      setFields([newField()]);
      setEditingFormId(null);
      toast.success(editingFormId ? "Formulário atualizado" : "Formulário criado");
    } catch (cause: any) {
      toast.error(cause?.response?.data?.error || "Não foi possível criar o formulário");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Formulários</h1>
          <p className="mt-1 text-sm text-muted-foreground">Crie formulários e acompanhe as respostas recebidas dos contatos.</p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="mr-2 h-4 w-4" /> Criar formulário
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <aside className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando formulários...</p>}
          {!isLoading && !forms.length && <p className="rounded-xl border p-5 text-sm text-muted-foreground">Nenhum formulário criado.</p>}
          {forms.map((form) => (
            <button
              key={form.id}
              type="button"
              onClick={() => {
                setSelectedId(form.id);
                setPage(0);
              }}
              className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${selectedId === form.id ? "border-primary bg-primary/5" : "bg-card"}`}>
              <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{form.title}</span>
                <span className="text-xs text-muted-foreground">
                  {form.fields.length} campos · {new Date(form.createdAt).toLocaleDateString("pt-BR")}
                </span>
              </span>
            </button>
          ))}
        </aside>

        <section className="min-w-0 rounded-xl border bg-card p-5 sm:p-6">
          {!selected && (
            <p className="text-sm text-muted-foreground">
              Selecione um formulário para consultar as respostas. Para enviá-lo, abra uma conversa e escolha “Formulário” em “Enviar mensagem interativa”.
            </p>
          )}
          {selected && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{selected.title}</h2>
                  {selected.description && <p className="mt-2 text-sm text-muted-foreground">{selected.description}</p>}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={exportSubmissions}><Download className="mr-1 h-4 w-4" /> Exportar PDF</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => startEdit(selected)}><Pencil className="mr-1 h-4 w-4" /> Editar</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => deleteForm(selected)}><Trash2 className="mr-1 h-4 w-4" /> Excluir</Button>
                </div>
              </div>
              <div className="mt-5 border-t pt-5">
                <h3 className="font-medium">Respostas por contato</h3>
                {loadingSubmissions && <p className="mt-3 text-sm text-muted-foreground">Carregando respostas...</p>}
                {!loadingSubmissions && !submissions.length && <p className="mt-3 text-sm text-muted-foreground">Ainda não há respostas.</p>}
                <div className="mt-3 space-y-3">
                  {submissions.map((submission) => (
                    <article key={submission.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-1">
                        <strong>{submission.contactName}</strong>
                        <time className="text-xs text-muted-foreground">{new Date(submission.createdAt).toLocaleString("pt-BR")}</time>
                      </div>
                      <p className="text-xs text-muted-foreground">{submission.remoteJid.split("@")[0]}</p>
                      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                        {submission.fields.map((field) => (
                          <div key={field.id} className="min-w-0">
                            <dt className="text-xs text-muted-foreground">{field.label}</dt>
                            {editingSubmissionId === submission.id ? (
                              field.type === "checkbox" ? (
                                <label className="mt-1 flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={editingAnswers[field.id] === true} onChange={(event) => setEditingAnswers((current) => ({ ...current, [field.id]: event.target.checked }))} /> Sim
                                </label>
                              ) : field.type === "date" ? (
                                <div className="mt-1"><DatePicker value={String(editingAnswers[field.id] || "")} onChange={(value) => setEditingAnswers((current) => ({ ...current, [field.id]: value }))} required={field.required} /></div>
                              ) : field.type === "textarea" ? (
                                <Textarea className="mt-1" value={String(editingAnswers[field.id] || "")} onChange={(event) => setEditingAnswers((current) => ({ ...current, [field.id]: event.target.value }))} />
                              ) : field.type === "select" ? (
                                <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={String(editingAnswers[field.id] || "")} onChange={(event) => setEditingAnswers((current) => ({ ...current, [field.id]: event.target.value }))}>
                                  <option value="">Selecione</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                              ) : (
                                <Input className="mt-1" type={field.type === "phone" ? "tel" : field.type === "number" ? "number" : field.type === "email" ? "email" : "text"} value={String(editingAnswers[field.id] || "")} onChange={(event) => setEditingAnswers((current) => ({ ...current, [field.id]: event.target.value }))} />
                              )
                            ) : (
                              <dd className="break-words text-sm">
                                {submission.answers[field.id] === true ? "Sim" : submission.answers[field.id] === false ? "Não" : submission.answers[field.id] || "—"}
                              </dd>
                            )}
                          </div>
                        ))}
                      </dl>
                      <div className="mt-3 flex justify-end gap-2">
                        {editingSubmissionId === submission.id ? (
                          <>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingSubmissionId(null)}><X className="mr-1 h-4 w-4" /> Cancelar</Button>
                            <Button type="button" size="sm" disabled={savingSubmission} onClick={() => saveSubmission(submission.id)}><Save className="mr-1 h-4 w-4" /> Salvar</Button>
                          </>
                        ) : (
                          <>
                            <Button type="button" variant="outline" size="sm" onClick={() => { setEditingSubmissionId(submission.id); setEditingAnswers({ ...submission.answers }); }}><Pencil className="mr-1 h-4 w-4" /> Editar</Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => deleteSubmission(submission.id)}><Trash2 className="mr-1 h-4 w-4" /> Excluir</Button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {(page > 0 || submissionPage?.hasMore) && (
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Button type="button" variant="outline" disabled={page === 0 || loadingSubmissions} onClick={() => setPage((current) => current - 1)}>
                      Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground">Página {page + 1}</span>
                    <Button type="button" variant="outline" disabled={!submissionPage?.hasMore || loadingSubmissions} onClick={() => setPage((current) => current + 1)}>
                      Próxima
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <Dialog open={creating} onOpenChange={(open) => { setCreating(open); if (!open) setEditingFormId(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingFormId ? "Editar formulário" : "Criar formulário"}</DialogTitle>
            <DialogDescription>{editingFormId ? "Atualize as informações e os campos do formulário." : "Defina as perguntas que o contato deverá responder."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input aria-label="Título do formulário" placeholder="Título do formulário" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
            <Textarea aria-label="Descrição do formulário" placeholder="Descrição (opcional)" maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
            {fields.map((field, index) => (
              <div key={field.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <strong className="text-sm">Campo {index + 1}</strong>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover campo"
                    disabled={fields.length === 1}
                    onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  aria-label={`Pergunta ${index + 1}`}
                  placeholder="Pergunta ou nome do campo"
                  maxLength={120}
                  value={field.label}
                  onChange={(event) => updateField(field.id, { label: event.target.value })}
                />
                <div className="flex flex-wrap gap-3">
                  <select
                    aria-label={`Tipo do campo ${index + 1}`}
                    className="h-10 min-w-40 flex-1 rounded-md border bg-background px-3 text-sm"
                    value={field.type}
                    onChange={(event) => updateField(field.id, { type: event.target.value as FormFieldType, options: event.target.value === "select" ? ["", ""] : undefined })}>
                    {fieldTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /> Obrigatório
                  </label>
                </div>
                {field.type === "select" && (
                  <Textarea
                    aria-label={`Opções do campo ${index + 1}`}
                    placeholder="Uma opção por linha"
                    value={(field.options || []).join("\n")}
                    onChange={(event) => updateField(field.id, { options: event.target.value.split("\n") })}
                  />
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={fields.length >= 20} onClick={() => setFields((current) => [...current, newField()])}>
                <Plus className="mr-2 h-4 w-4" /> Adicionar campo
              </Button>
              <Button type="button" disabled={saving} onClick={save}>
                {saving ? "Salvando..." : editingFormId ? "Salvar alterações" : "Salvar formulário"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
