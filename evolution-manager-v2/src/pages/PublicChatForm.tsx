import axios from "axios";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@evoapi/design-system/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/components/theme-provider";
import { CLOUD_BR_CHAT_LOGO, CLOUD_BR_CHAT_LOGO_DARK } from "@/lib/branding";
import { FormField } from "@/types/chat-form";

type PublicForm = { title: string; description: string | null; fields: FormField[]; submitted: boolean };

export default function PublicChatForm() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const { theme } = useTheme();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!inviteId) return;
    let active = true;
    axios
      .get<PublicForm>(`/forms/public/${encodeURIComponent(inviteId)}`)
      .then(({ data }) => {
        if (active) setForm(data);
      })
      .catch(() => {
        if (active) setError("Este formulário não está disponível.");
      });
    return () => {
      active = false;
    };
  }, [inviteId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inviteId || sending) return;
    const missingDate = form?.fields.find((field) => field.type === "date" && field.required && !String(answers[field.id] || ""));
    if (missingDate) {
      setError(`Selecione uma data para “${missingDate.label}”.`);
      return;
    }
    setSending(true);
    setError("");
    try {
      await axios.post(`/forms/public/${encodeURIComponent(inviteId)}`, { answers });
      setSubmitted(true);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Não foi possível enviar as respostas. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="h-[100dvh] overflow-y-auto bg-muted/30 px-3 py-5 text-foreground sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-sm sm:rounded-3xl">
        <div className="border-b px-5 py-5 sm:px-8">
          <img src={theme === "dark" ? CLOUD_BR_CHAT_LOGO_DARK : CLOUD_BR_CHAT_LOGO} alt="CloudBR Chat" className="h-9 max-w-full object-contain object-left" />
        </div>
        <div className="space-y-5 px-5 py-6 sm:px-8 sm:py-8">
          {!form && !error && <p>Carregando formulário...</p>}
          {form && (
            <>
              <div>
                <h1 className="text-2xl font-semibold sm:text-3xl">{form.title}</h1>
                {form.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{form.description}</p>}
              </div>
              {form.submitted || submitted ? (
                <p role="status" className="rounded-xl bg-primary/10 p-4 text-sm font-medium text-primary">
                  Respostas enviadas. Obrigado!
                </p>
              ) : (
                <form onSubmit={submit} className="space-y-5">
                  {form.fields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <label htmlFor={field.id} className="block text-sm font-medium">
                        {field.label}
                        {field.required && (
                          <span aria-hidden="true" className="ml-1 text-destructive">
                            *
                          </span>
                        )}
                      </label>
                      {field.type === "date" ? (
                        <DatePicker
                          id={field.id}
                          required={field.required}
                          value={String(answers[field.id] || "")}
                          onChange={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
                        />
                      ) : field.type === "textarea" ? (
                        <Textarea
                          id={field.id}
                          required={field.required}
                          maxLength={4000}
                          value={String(answers[field.id] || "")}
                          onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
                        />
                      ) : field.type === "select" ? (
                        <select
                          id={field.id}
                          required={field.required}
                          value={String(answers[field.id] || "")}
                          onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                          <option value="">Selecione</option>
                          {field.options?.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "checkbox" ? (
                        <input
                          id={field.id}
                          type="checkbox"
                          required={field.required}
                          checked={answers[field.id] === true}
                          onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.checked }))}
                          className="h-5 w-5"
                        />
                      ) : (
                        <Input
                          id={field.id}
                          type={field.type === "phone" ? "tel" : field.type}
                          required={field.required}
                          maxLength={field.type === "phone" ? 30 : 4000}
                          value={String(answers[field.id] || "")}
                          onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                  <Button type="submit" disabled={sending} className="w-full">
                    {sending ? "Enviando..." : "Enviar respostas"}
                  </Button>
                </form>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
