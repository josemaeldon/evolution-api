# CloudBR Chat

![Logo CloudBR Chat](public/assets/images/cloudbr-chat-logo.svg)

Painel web para gerenciar instâncias WhatsApp, conversas, contatos, integrações e solicitações de pagamento Pix.

## Desenvolvimento

Requisitos: Node.js 18 ou superior e npm 8 ou superior.

```bash
npm ci
npm run dev
```

O painel solicita a URL do servidor e a chave global na tela de login.

## Build independente

```bash
npm ci
npm run build
npm run preview
```

O build independente usa `/` como caminho base. Ao publicar o manager junto com a API deste repositório, execute `bash manager_install.sh` na raiz. O script gera o build para `/manager/` e copia os arquivos para `manager/dist`.

## Verificação

```bash
npm run lint:check
npm run build
```

## Origem e licenças

CloudBR Chat é uma interface personalizada construída a partir do Evolution Manager v2 e utiliza o servidor Evolution API. Consulte [a licença do manager](LICENSE), [a licença do servidor](../LICENSE) e [a política de marcas do projeto de origem](../TRADEMARKS.md) antes de distribuir a aplicação.
