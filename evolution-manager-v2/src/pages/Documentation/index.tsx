import { ArrowLeft, BookOpen, MessageCircle, Settings2, Users } from "lucide-react";
import { Link } from "react-router-dom";

const sections = [
  {
    title: "Conversas",
    icon: MessageCircle,
    description: "Selecione uma instância e abra Chat para conversar, enviar mídias, responder e encaminhar mensagens.",
  },
  {
    title: "Instâncias",
    icon: Settings2,
    description: "Administradores podem criar e configurar instâncias na página inicial. A conexão com o WhatsApp é feita na instância.",
  },
  {
    title: "Empresas e usuários",
    icon: Users,
    description: "O superadministrador atribui instâncias às empresas. Administradores gerenciam usuários; usuários acessam o chat.",
  },
];

function Documentation() {
  return (
    <main className="min-h-screen overflow-y-auto bg-background px-5 py-10 text-foreground sm:px-8">
      <div className="mx-auto max-w-4xl space-y-8 pb-10">
        <header className="space-y-3">
          <div className="flex items-center gap-3 text-primary">
            <BookOpen className="h-7 w-7" />
            <h1 className="text-3xl font-semibold text-foreground">Documentação CloudBR Chat</h1>
          </div>
          <p className="text-muted-foreground">Guia local para as principais funções do manager. Esta página funciona no mesmo endereço da aplicação.</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {sections.map(({ title, icon: Icon, description }) => (
            <section key={title} className="rounded-xl border border-border bg-card p-5">
              <Icon className="mb-3 h-6 w-6 text-primary" />
              <h2 className="mb-2 text-lg font-semibold">{title}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </section>
          ))}
        </div>

        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Acesso à API</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            A API usa o cabeçalho <code className="rounded bg-muted px-1 py-0.5">apikey</code>. Para operações em uma instância, informe o nome dela na rota e use uma chave autorizada. Exemplos de
            rotas disponíveis:
          </p>
          <ul className="space-y-2 text-sm">
            <li className="break-all rounded-md bg-muted px-3 py-2 font-mono">GET /instance/fetchInstances</li>
            <li className="break-all rounded-md bg-muted px-3 py-2 font-mono">POST /message/sendText/&#123;instanceName&#125;</li>
          </ul>
          <Link to="/manager" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" /> Voltar às instâncias
          </Link>
        </section>
      </div>
    </main>
  );
}

export default Documentation;
