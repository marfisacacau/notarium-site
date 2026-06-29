// ============================================================
// Notarium Academy · Edge Function — Checkout Pagar.me (API v5)
// ------------------------------------------------------------
// Regra de cobrança:
//   • COM desconto (anual antecipado OU Sócio Fundador) -> PEDIDO único (Order)
//   • Valor cheio mensal -> ASSINATURA recorrente (Subscription)
//
// A chave SECRETA fica só aqui (Deno.env). O cartão é tokenizado no
// navegador (public key) e chega aqui apenas como card_token.
//
// Secrets necessários (supabase secrets set ...):
//   PAGARME_SECRET_KEY   = sk_test_xxx | sk_xxx
// ============================================================

const PAGARME_API = "https://api.pagar.me/core/v5";
const SECRET = Deno.env.get("PAGARME_SECRET_KEY") ?? "";

// Tabela de preços no SERVIDOR (centavos/mês). Nunca confiar no valor do cliente.
const PRICES_MONTHLY: Record<string, number> = {
  social: 19900, iniciante: 49900, pequeno: 84900,
  medio: 134900, grande: 199900, mega: 279900,
};
const NAMES: Record<string, string> = {
  social: "Plano Social", iniciante: "Plano Iniciante", pequeno: "Plano Pequeno",
  medio: "Plano Médio", grande: "Plano Grande", mega: "Plano Mega",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const auth = () => "Basic " + btoa(SECRET + ":");
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não suportado" }, 405);
  if (!SECRET) return json({ error: "PAGARME_SECRET_KEY não configurada" }, 500);

  try {
    const body = await req.json();
    const { plan, cycle, founder, method, card_token, customer } = body ?? {};

    const monthly = PRICES_MONTHLY[plan];
    if (!monthly) return json({ error: "plano inválido" }, 400);
    if (!customer?.name || !customer?.email) return json({ error: "dados do cliente incompletos" }, 400);

    // ---- valor calculado no servidor ----
    const annual = cycle === "anual";
    const base = annual ? monthly * 12 : monthly;
    let discount = 0;
    if (annual) discount += 0.15;   // anual antecipado
    if (founder) discount += 0.40;  // Sócio Fundador
    const amount = Math.round(base * (1 - discount));
    const oneTime = annual || founder; // com desconto => pagamento único

    const cust = {
      name: customer.name,
      email: customer.email,
      document: String(customer.document ?? "").replace(/\D/g, ""),
      type: customer.type === "individual" ? "individual" : "company",
    };

    // ============ PEDIDO ÚNICO (com desconto) ============
    if (oneTime) {
      const payments: unknown[] = [];
      if (method === "credit_card") {
        if (!card_token) return json({ error: "card_token ausente" }, 400);
        payments.push({ payment_method: "credit_card", credit_card: { card_token, installments: 1 } });
      } else if (method === "pix") {
        payments.push({ payment_method: "pix", pix: { expires_in: 3600 } });
      } else {
        payments.push({ payment_method: "boleto" });
      }
      const order = {
        items: [{
          amount,
          description: `${NAMES[plan]} — ${annual ? "anual" : "mensal"}${founder ? " · Sócio Fundador" : ""}`,
          quantity: 1,
        }],
        customer: cust,
        payments,
      };
      const r = await fetch(`${PAGARME_API}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth() },
        body: JSON.stringify(order),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: data?.message ?? "falha ao criar pedido", details: data }, r.status);

      const charge = data?.charges?.[0];
      const tx = charge?.last_transaction ?? {};
      return json({
        kind: "order",
        id: data?.id,
        status: data?.status ?? charge?.status,
        amount,
        pix: tx?.qr_code ? { qr_code: tx.qr_code, qr_code_url: tx.qr_code_url, expires_at: tx.expires_at } : undefined,
        boleto: tx?.url ? { url: tx.url, line: tx.line, pdf: tx.pdf, barcode: tx.barcode } : undefined,
      });
    }

    // ============ ASSINATURA RECORRENTE (valor cheio mensal) ============
    if (method !== "credit_card" || !card_token) {
      return json({ error: "assinatura recorrente exige cartão (card_token)" }, 400);
    }
    const sub = {
      payment_method: "credit_card",
      customer: cust,
      card: { card_token },
      billing_type: "prepaid",
      interval: "month",
      interval_count: 1,
      items: [{
        description: NAMES[plan],
        quantity: 1,
        pricing_scheme: { scheme_type: "unit", price: amount },
      }],
    };
    const r = await fetch(`${PAGARME_API}/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth() },
      body: JSON.stringify(sub),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message ?? "falha ao criar assinatura", details: data }, r.status);
    return json({ kind: "subscription", id: data?.id, status: data?.status, amount });

  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
