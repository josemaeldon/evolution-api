# Pix Sicoob no chat

Esta integração usa a API Pix de cobrança imediata do Sicoob. A configuração é por instância WhatsApp Baileys e segue os campos usados em `sorteios_worker`: modo sandbox, Client ID, Client Secret opcional, chave Pix, URL de autenticação, URL base, expiração e arquivos PEM de certificado, chave privada e CA opcional.

## Preparação

1. Aplique a migração PostgreSQL com `DATABASE_PROVIDER=postgresql npm run db:deploy` (ou `psql_bouncer`, conforme o ambiente) e gere o Prisma Client com `npm run db:generate`.
2. Defina `SICOOB_CREDENTIALS_KEY` como 32 bytes aleatórios em base64 em todas as réplicas da API. Por exemplo, gere a chave com `openssl rand -base64 32`. Guarde a chave junto ao processo de backup; sem ela, certificados e segredo salvos não podem ser usados.
3. Configure `SERVER_URL` com a URL pública HTTPS da API. O link de cobrança e o webhook usam essa URL.
4. Em **Instância → Integrações → Cobranças**, salve as credenciais e os certificados PEM. Use **Testar conexão** para validar a autenticação. O upload é persistido no PostgreSQL de forma criptografada e isolada por instância.

O padrão de produção para a URL base é `https://api.sicoob.com.br`; o sandbox usa `https://sandbox.sicoob.com.br/sicoob/sandbox`. A integração acrescenta `/pix/api/v2` à URL base. A URL de autenticação padrão é `https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token`.

## Fluxo

No chat individual, selecione **Cobrança Sicoob**, informe valor e descrição e envie. A API cria a cobrança no Sicoob, salva o `txid` e envia um botão **Abrir e Pagar**. Uma mensagem adicional com o link permite pagar nos clientes WhatsApp que não exibem botões interativos. A página pública mostra QR Code e código Pix. O webhook aciona uma nova consulta à API Sicoob; a reconciliação periódica também consulta cobranças pendentes a cada 30 segundos. Somente uma cobrança confirmada pela API do banco, com valor e identificador compatíveis, gera a mensagem com PDF na conversa. O PDF é gerado pelo CloudBR Chat a partir dos dados confirmados pelo Sicoob; não é um documento emitido pelo banco.

O cadastro do webhook é tentado ao salvar a configuração. Se não for possível registrá-lo, a consulta periódica continua ativa. O teste de autenticação não cria uma cobrança. Para validar o fluxo completo, crie uma cobrança de baixo valor em sandbox e confirme o retorno do banco e o envio do documento no WhatsApp.
