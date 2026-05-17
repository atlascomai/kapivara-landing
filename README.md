# Detetive Kapi Landing

Landing page da Detetive Kapi, a Detetive Kapi de cupons, promocoes e achadinhos no WhatsApp.

## Deploy

Este projeto foi preparado para Render Web Service em Node.js.

- Build command: `npm ci`
- Start command: `npm start`
- Custom domain: `kapivara.co`

Os arquivos principais de SEO estao na raiz: `robots.txt`, `sitemap.xml`, `llms.txt`, `site.webmanifest`, `termos.html` e `privacidade.html`.

## Contador de estatisticas

O contador de pessoas e economia usa `GET /api/stats`, implementado em `server.js`.

No Render, o endpoint grava checkpoints em Render Postgres usando `DATABASE_URL`.
Por padrao, ele so atualiza o banco a cada 3 horas (`STATS_CHECKPOINT_INTERVAL_MS=10800000`) para manter o historico medio sem gravar a cada animacao do contador.

O Blueprint usa Render Postgres `free` para evitar custo automatico. Esse plano persiste entre deploys, mas expira apos 30 dias no Render. Para historico permanente, altere o plano do banco em `render.yaml` para um plano pago, por exemplo `basic-256mb`, ou faca o upgrade no Dashboard.

Localmente, sem `DATABASE_URL`, o servidor usa `data/.kapi-stats-runtime.json` como fallback ignorado pelo Git.

## Mensageria

O plano para plugar Zavu agora, manter Sent como alternativa e preservar Meta direto como caminho de diagnostico esta em `docs/messaging-provider-implementation-plan.md`.

## QR Code

O QR Code do rodape aponta para `qr.html?src=footer_qr`, que redireciona para o WhatsApp `+5511989419928`.

A pagina `qr.html` tambem dispara o evento `qr_code_open` no `dataLayer` e tenta enviar o payload para `POST /api/qr-open`. Para contabilizar leituras e incluir o total no e-mail de resumo diario, esse endpoint precisa ser implementado em um backend seguro ou ferramenta de analytics conectada ao e-mail diario.
