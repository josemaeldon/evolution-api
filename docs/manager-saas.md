# Manager multiempresa

O manager usa a chave global da API para entrar como superadministrador. Empresas usam login com e-mail e senha na mesma tela. O manager e a API devem ser publicados na mesma origem (domínio e porta) para que as sessões de empresa funcionem. A imagem da API já inclui o manager; a imagem separada do frontend encaminha as rotas da API para o serviço `api:8080`. Em outras topologias, configure um proxy equivalente e inclua a origem pública em `CORS_ORIGIN`.

## Implantação

1. Faça backup do banco.
2. Configure `DATABASE_PROVIDER=postgresql` (ou `psql_bouncer` ao usar PgBouncer).
3. Execute `npm run db:deploy` e `npm run db:generate`.
4. Compile a API e o manager com `npm run build` em cada projeto.
5. Entre no manager com a chave global, selecione **Superadministrador** e abra **Empresas e usuários**.
6. Crie uma empresa, defina seu limite de instâncias e adicione pelo menos um administrador. Adicione usuários com perfil **Chat** conforme necessário.
7. Atribua as instâncias existentes, que permanecem sem empresa após a migração.

O campo `instanceCount` é atualizado quando uma instância é criada, atribuída, desvinculada ou excluída pelo manager/API. O limite é verificado no servidor, inclusive em requisições diretas. A chave global continua com acesso total à API e deve permanecer sob controle do operador do SaaS.

## Perfis

| Perfil | Acesso |
| --- | --- |
| Superadministrador | Todas as instâncias, empresas, usuários e limites |
| Administrador da empresa | Instâncias da própria empresa, configurações e usuários da própria empresa |
| Usuário da empresa | Chat das instâncias da própria empresa |

Usuários de chat recebem apenas um identificador de sessão no lugar do token da instância. O servidor confere empresa e perfil em cada requisição. Sessões de empresa ficam em cookie HttpOnly com validade de sete dias e são invalidadas ao desativar o usuário, trocar sua senha ou mudar seu perfil. A desativação da empresa bloqueia todas as suas sessões.

O chat usa Socket.IO quando o WebSocket da API está habilitado e atualização periódica quando indisponível. Eventos das sessões de empresa são enviados apenas para a instância autorizada.

## Identificação do atendente

Mensagens enviadas por usuários e administradores da empresa registram o nome do atendente no histórico e o mostram acima da bolha no manager. O controle **Assinar textos e legendas** no chat adiciona o nome ao início do texto ou da legenda que o contato recebe no WhatsApp. A preferência fica salva no navegador para cada usuário. Mensagens de áudio e outros formatos sem legenda continuam identificadas no histórico do manager, mas não recebem uma assinatura no conteúdo enviado ao contato. Execute a migração `20261125020000_manager_message_sender` antes de usar esse recurso.
