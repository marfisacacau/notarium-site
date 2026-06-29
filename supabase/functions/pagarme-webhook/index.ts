// ============================================================
// Notarium Academy · Edge Function — Webhook Pagar.me
// ------------------------------------------------------------
// Recebe os eventos da Pagar.me (pagamento confirmado, assinatura
// cobrada, etc.) e libera/atualiza o acesso da serventia.
//
// Configurar no painel da Pagar.me:
//   URL do webhook -> https://<PROJECT>.supabase.co/functions/v1/pagarme-webhook
//   (opcional) proteger com Basic Auth na URL e definir o secret abaixo.
//
// Secrets:
//   PAGARME_WEBHOOK_BASIC  = "usuario:senha"   (opcional, se usar Basic Auth)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (para gravar no banco)
// ============================================================

const WEBHOOK_BASIC = Deno.env.get("PAGARME_WEBHOOK_BASIC") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("método não suportado", { status: 405 });

  // (opcional) validação por Basic Auth configurado na URL do webhook
  if (WEBHOOK_BASIC) {
    const got = req.headers.get("authorization") ?? "";
    if (got !== "Basic " + btoa(WEBHOOK_BASIC)) {
      return new Response("unauthorized", { status: 401 });
    }
  }

  let event: any;
  try { event = await req.json(); } catch { return new Response("payload inválido", { status: 400 }); }

  const type = event?.type;          // ex.: order.paid, charge.paid, subscription.charged, invoice.paid, charge.payment_failed
  const data = event?.data ?? {};
  const ref = data?.id;
  const customer = data?.customer?.email;

  // ------------------------------------------------------------
  // TODO (provisionamento): conforme o evento, liberar/atualizar
  // o acesso da serventia no Supabase. Esqueleto:
  //
  // switch (type) {
  //   case "order.paid":          // pagamento único (com desconto) confirmado
  //   case "subscription.charged":// assinatura recorrente cobrada
  //   case "invoice.paid":
  //     await ativarAcesso(customer, data);
  //     break;
  //   case "charge.payment_failed":
  //   case "subscription.canceled":
  //     await suspenderAcesso(customer, data);
  //     break;
  // }
  // ------------------------------------------------------------

  console.log("[pagarme webhook]", type, "ref:", ref, "cliente:", customer);

  // Sempre responder 200 rapidamente para a Pagar.me não reenviar.
  return new Response("ok", { status: 200 });
});
