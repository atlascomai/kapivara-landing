# Plano de Implementacao: Mensageria Plugavel do Kapivara

Status: pronto para abrir branch e implementar.

## Contexto Atual

Este repositorio hoje e uma landing estatica publicada no Render como Static Site (`render.yaml`). Nao existe backend versionado aqui ainda.

Pontos relevantes:

- `index.html`, `qr.html` e o QR do rodape apontam para `https://wa.me/5511936236342`.
- `qr.html` tenta enviar `POST /api/qr-open`, mas esse endpoint nao existe neste repo.
- O bloqueio atual da Meta/WhatsApp precisa ser isolado por provider, sender, WABA e Business Portfolio.

## Decisao de Arquitetura

Criar uma camada de mensageria propria do Kapivara, com contrato unico e providers plugaveis:

```text
Kapivara app
  -> MessagingService
    -> ProviderRouter
      -> ZavuProvider
      -> SentProvider
      -> MetaProvider
```

Ordem inicial de providers:

```text
zavu,sent,meta
```

Motivo:

- Zavu entra primeiro para destravar rapido e testar fallback automatico WhatsApp/SMS.
- Sent entra como caminho alternativo com WABA/sender separado.
- Meta direto fica como controle/diagnostico, porque pode reproduzir o erro da WABA atual.

## Mudanca de Estrutura no Git

Adicionar um backend Node/TypeScript ao repo, transformando o projeto em monorepo simples:

```text
/
  index.html
  qr.html
  assets/
  render.yaml
  apps/
    api/
      package.json
      src/
        server.ts
        config/env.ts
        messaging/
          types.ts
          router.ts
          providers/
            zavu.ts
            sent.ts
            meta.ts
        routes/
          messages.ts
          webhooks.ts
          qr-open.ts
        persistence/
          message-deliveries.ts
```

A landing continua estatica. A API entra como segundo servico no Render.

## Render

Alterar `render.yaml` para dois servicos:

1. `kapivara-landing`
   - continua `runtime: static`
   - publica `.` como hoje

2. `kapivara-api`
   - `runtime: node`
   - `rootDir: apps/api`
   - `buildCommand: npm ci && npm run build`
   - `startCommand: npm run start`

Variaveis esperadas no `kapivara-api`:

```bash
MESSAGING_PROVIDER_ORDER=zavu,sent,meta
MESSAGING_DEFAULT_CHANNEL=auto
MESSAGING_TIMEOUT_MS=10000

ZAVU_API_KEY=
ZAVU_SENDER_ID=
ZAVU_API_BASE_URL=https://api.zavu.dev/v1

SENT_API_KEY=
SENT_API_BASE_URL=https://api.sent.dm/v3
SENT_SANDBOX=false

META_WHATSAPP_TOKEN=
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_API_VERSION=v20.0

DATABASE_URL=
WEBHOOK_SECRET=
```

## Contrato Unico

O produto nunca chama Zavu/Sent/Meta diretamente. Ele chama:

```ts
await messaging.send({
  to: "+5511999999999",
  intent: "utility",
  channel: "auto",
  text: "Kapivara encontrou uma promocao para sua busca.",
  idempotencyKey: "deal-alert:user_123:deal_456",
  metadata: {
    userId: "user_123",
    workflow: "deal-alert",
    dealId: "deal_456"
  }
});
```

Para template:

```ts
await messaging.send({
  to: "+5511999999999",
  intent: "utility",
  channel: "auto",
  template: {
    key: "deal_alert",
    language: "pt_BR",
    variables: {
      "1": "Ana",
      "2": "Tenis Nike",
      "3": "R$ 199"
    },
    providerTemplateIds: {
      zavu: "tmpl_zavu_deal_alert",
      sent: "tmpl_sent_deal_alert",
      meta: "deal_alert"
    }
  },
  idempotencyKey: "template:deal-alert:user_123:deal_456"
});
```

## Endpoints da API

### `POST /api/messages/send`

Uso interno/admin para smoke test e disparos do app.

Payload:

```json
{
  "to": "+5511999999999",
  "intent": "utility",
  "channel": "auto",
  "text": "Mensagem de teste do Kapivara",
  "idempotencyKey": "manual-test-001"
}
```

### `POST /api/webhooks/messaging/:provider`

Recebe webhooks de Zavu, Sent e Meta, normaliza status e atualiza a entrega.

### `POST /api/qr-open`

Implementa o endpoint que `qr.html` ja tenta chamar. Registra origem do QR e user-agent/IP anonimizados.

### `GET /healthz`

Healthcheck do Render.

## Persistencia

Criar tabela `message_deliveries`:

```sql
create table message_deliveries (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_message_id text,
  recipient text not null,
  channel text,
  intent text not null,
  status text not null default 'queued',
  idempotency_key text not null unique,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}',
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Se nao houver banco definido, usar Render Postgres ou Supabase Postgres. Para MVP, Postgres simples e suficiente.

## Fallback

Classificar falhas assim:

- `RATE_LIMIT`: tentar proximo provider.
- `PROVIDER_UNAVAILABLE`: tentar proximo provider.
- `TEMPLATE`: tentar proximo provider se existir template equivalente.
- `POLICY_OR_ACCOUNT_BLOCKED`: tentar proximo provider imediatamente.
- `VALIDATION`: parar.
- `AUTHENTICATION`: parar para o provider atual e alertar.

Mapear como `POLICY_OR_ACCOUNT_BLOCKED`:

```text
134760
130497
country restriction
restricted from messaging users in this country
not allowed to send
```

## Plano de Branch

Branch:

```bash
git checkout -b feat/messaging-provider-router
```

Commits sugeridos:

1. `docs: add messaging provider implementation plan`
2. `feat(api): add kapivara api service scaffold`
3. `feat(messaging): add provider router and zavu adapter`
4. `feat(messaging): add sent and meta adapters`
5. `feat(api): add messaging send and webhook endpoints`
6. `feat(render): deploy api service alongside static landing`
7. `feat(landing): make whatsapp number configurable for cutover`

## Ordem de Implementacao

1. Criar `apps/api` com TypeScript, `tsx` para dev e build com `tsc`.
2. Adicionar `GET /healthz`.
3. Implementar `src/messaging/types.ts`.
4. Implementar `ProviderRouter`.
5. Implementar `ZavuProvider` usando `POST https://api.zavu.dev/v1/messages`.
6. Adicionar `POST /api/messages/send`.
7. Criar tabela `message_deliveries`.
8. Persistir cada tentativa de envio com `idempotencyKey`.
9. Configurar Render API com variaveis Zavu.
10. Rodar smoke test com 3 numeros brasileiros internos.
11. Implementar `SentProvider`.
12. Implementar `MetaProvider` somente como controle.
13. Implementar webhooks.
14. Atualizar `qr.html` e CTAs da landing para o numero aprovado quando o sender novo estiver funcionando.

## Criterios de Aceite

- `npm run typecheck` passa em `apps/api`.
- `GET /healthz` responde 200 em producao.
- `POST /api/messages/send` envia via Zavu com `channel: auto`.
- Falha de policy/country nao derruba o fluxo sem registrar erro.
- `message_deliveries` registra provider, status, erro e raw response.
- Webhook atualiza status para `sent`, `delivered`, `read` ou `failed`.
- Tres numeros +55 recebem smoke test via caminho novo.
- Landing so troca o numero de WhatsApp depois de confirmar envio real.

## Risco Principal

Se Zavu e Sent forem configurados usando o mesmo Business Portfolio/WABA bloqueado, o erro pode se repetir. O teste precisa usar sender/WABA novo ou confirmar explicitamente com o provider que a rota nao depende da WABA atual.

## Proxima Acao

Implementar o commit 2 em diante na branch `feat/messaging-provider-router`, com Zavu como primeiro provider funcional.
