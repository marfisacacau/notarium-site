# Integração de pagamentos — Pagar.me (API v5) + Supabase

Como o checkout do site conversa com a Pagar.me sem nunca expor a chave secreta.

## Arquitetura

```
Navegador (checkout.html)                Supabase Edge Function            Pagar.me API v5
─────────────────────────                ──────────────────────            ───────────────
1. tokeniza o cartão  ───────────────────────────────────────────────────▶ POST /tokens?appId=PUBLIC_KEY
   (chave PÚBLICA, cartão não passa                                          ◀── card_token
    pelo nosso servidor)
2. envia {plano, ciclo, founder,  ──────▶ pagarme-checkout
   método, card_token, cliente}            • calcula o valor no servidor
                                           • COM desconto  -> POST /orders   (pedido único)
                                           • valor cheio   -> POST /subscriptions (mensal)
                                           • usa a chave SECRETA (env)  ────▶ Pagar.me
                                  ◀────────  retorna PIX/boleto/status
3. Pagar.me confirma o pagamento  ──────▶ pagarme-webhook  ──▶ libera acesso da serventia (Supabase)
```

**Regra de cobrança (definida pela Notarium):**
- **Com desconto** (anual antecipado 15% **ou** Sócio Fundador 40%) → **pagamento único** (`/orders`).
- **Valor cheio** → **assinatura recorrente mensal** (`/subscriptions`).

O valor é **recalculado no servidor** a partir da tabela em `pagarme-checkout/index.ts` — o cliente não consegue alterar o preço.

## Passo a passo (você executa — as chaves são suas)

### 1. Pegue suas chaves na Pagar.me
Painel → Configurações → Chaves. Comece em **sandbox**:
- `pk_test_...` (pública) e `sk_test_...` (secreta).

### 2. Configure o secret e faça deploy das functions
```bash
# na raiz do projeto (precisa do Supabase CLI e estar logado)
supabase login
supabase link --project-ref SEU_PROJECT_REF

# chave secreta fica só no servidor:
supabase secrets set PAGARME_SECRET_KEY=sk_test_xxxxxxxx

supabase functions deploy pagarme-checkout
supabase functions deploy pagarme-webhook
```
A URL da function fica: `https://SEU_PROJECT_REF.supabase.co/functions/v1/pagarme-checkout`

### 3. Ligue o cliente
No topo do `<script>` em `checkout.html`, preencha:
```js
const PAGARME={
  publicKey:'pk_test_xxxxxxxx',
  fnUrl:'https://SEU_PROJECT_REF.supabase.co/functions/v1/pagarme-checkout',
};
```
> Enquanto esses campos ficarem **vazios**, o checkout roda em **modo demonstração** (vai direto para a confirmação, sem cobrar). É o estado atual no ar.

### 4. Configure o webhook na Pagar.me
Painel → Webhooks → nova URL:
`https://SEU_PROJECT_REF.supabase.co/functions/v1/pagarme-webhook`
Eventos sugeridos: `order.paid`, `charge.paid`, `charge.payment_failed`,
`subscription.charged`, `invoice.paid`, `subscription.canceled`.
(Opcional) proteja com Basic Auth e rode `supabase secrets set PAGARME_WEBHOOK_BASIC="usuario:senha"`.

### 5. Teste em sandbox antes de produção
Use os [cartões de teste da Pagar.me](https://docs.pagar.me/docs/cart%C3%B5es-de-teste).
Valide: cartão aprovado, cartão recusado, PIX (QR), boleto, e a chegada do webhook.
Só depois troque `pk_test_`/`sk_test_` pelas chaves de **produção**.

## Provisionamento (próximo passo)
Em `pagarme-webhook/index.ts` há o esqueleto do `switch` por tipo de evento —
é onde, ao receber `order.paid`/`subscription.charged`, liberamos o acesso da
serventia no banco. Posso implementar isso quando a tabela de serventias/assinaturas
existir no Supabase.

## Segurança — checklist
- [x] Chave **secreta** só na Edge Function (env), nunca no site.
- [x] Cartão tokenizado no navegador (não passa pelo nosso servidor).
- [x] Valor recalculado no servidor (cliente não altera preço).
- [ ] Webhook protegido (Basic Auth) e idempotente ao liberar acesso.
- [ ] Trocar chaves de teste por produção só após validar em sandbox.
