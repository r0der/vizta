const { onRequest } = require("firebase-functions/https");
const { setGlobalOptions } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const ACCESS_TOKEN = "APP_USR-338865051860202-061619-2201243418050a99e50475bb98a51d52-86530069";
const PLAN_ID = "f56ff0396a494f6ea4c566b45338c84c";
const BASE_URL = "https://r0der.github.io/vizta";

// ── 1. CREAR SUSCRIPCIÓN ──────────────────────────────────────
exports.crearSuscripcion = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  console.log("Body recibido:", JSON.stringify(req.body));

  try {
    const { userId, userEmail } = req.body;
    if (!userId || !userEmail) {
      res.status(400).json({ error: "Faltan datos" });
      return;
    }

    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [{
          title: "PantaYA Premium — 1 mes",
          quantity: 1,
          unit_price: 2000,
          currency_id: "ARS"
        }],
        payer: { email: userEmail },
        back_urls: {
          success: `${BASE_URL}?premium=success`,
          failure: `${BASE_URL}?premium=failure`,
          pending: `${BASE_URL}?premium=pending`
        },
        auto_return: "approved",
        external_reference: userId,
        notification_url: "https://webhookmp-wc66vjizpq-uc.a.run.app"
      })
    });

    const data = await response.json();
    console.log("Respuesta MP:", JSON.stringify(data));

    if (!response.ok) {
      res.status(500).json({ error: data });
      return;
    }

    res.json({ init_point: data.init_point });
  } catch (e) {
    console.error("ERROR:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
    res.status(500).json({ error: e.message });
  }
});

// ── 2. WEBHOOK DE MP ─────────────────────────────────────────
exports.webhookMP = onRequest(async (req, res) => {
  try {
    console.log("Webhook recibido:", JSON.stringify(req.body));
    
    const topic = req.body.topic || req.body.type;
    const resourceUrl = req.body.resource;
    const resourceId  = req.body.id || req.body.data?.id;

    // ─── Cancelación de suscripción ───
    if (topic === "subscription_preapproval" && resourceId) {
      const subRes = await fetch(`https://api.mercadopago.com/preapproval/${resourceId}`, {
        headers: { "Authorization": `Bearer ${ACCESS_TOKEN}` }
      });
      const sub = await subRes.json();
      console.log("Suscripcion MP:", JSON.stringify(sub));

      const userId = sub.external_reference;
      if (userId && sub.status === "cancelled") {
        await admin.firestore()
          .collection("users")
          .doc(userId)
          .update({ plan: "free", updatedAt: new Date().toISOString() });
        console.log("Premium cancelado para:", userId);
      }
      res.sendStatus(200);
      return;
    }

    // ─── Pago aprobado ───
    if (topic === "merchant_order" && resourceUrl) {
      // Obtener la orden
      const orderRes = await fetch(resourceUrl, {
        headers: { "Authorization": `Bearer ${ACCESS_TOKEN}` }
      });
      const order = await orderRes.json();
      console.log("Orden MP:", JSON.stringify(order));

      // Verificar si hay pagos aprobados
      const pagoAprobado = (order.payments || []).find(p => p.status === "approved");
      if(!pagoAprobado) { res.sendStatus(200); return; }

      const userId = order.external_reference;
      console.log("userId:", userId, "estado pago:", pagoAprobado.status);

      if(userId) {
        await admin.firestore()
          .collection("users")
          .doc(userId)
          .update({
            plan: "premium",
            paymentId: pagoAprobado.id,
            updatedAt: new Date().toISOString()
          });
        console.log("Premium activado para:", userId);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Error webhook:", e.message);
    res.sendStatus(500);
  }
});

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_PRICE_ID = "pri_01kvm5ptn32fpca8jrc5fm7c0e";

// ── 3. CREAR SUSCRIPCIÓN PADDLE ──────────────────────────────
exports.crearSuscripcionPaddle = onRequest({ secrets: ["PADDLE_API_KEY"] }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  try {
    const { userId, userEmail } = req.body;
    if (!userId || !userEmail) {
      res.status(400).json({ error: "Faltan datos" });
      return;
    }

    const response = await fetch("https://api.paddle.com/transactions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PADDLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [{ price_id: PADDLE_PRICE_ID, quantity: 1 }],
        customer: { email: userEmail },
        custom_data: { userId },
        checkout: {
          url: "https://r0der.github.io/PantaYA?premium=success"
        }
      })
    });

    const data = await response.json();
    console.log("Paddle response:", JSON.stringify(data));

    if(!response.ok) {
      res.status(500).json({ error: data });
      return;
    }

    const checkoutUrl = data.data?.checkout?.url;
    res.json({ checkout_url: checkoutUrl });
  } catch(e) {
    console.error("Paddle error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 4. WEBHOOK PADDLE ────────────────────────────────────────
exports.webhookPaddle = onRequest({ secrets: ["PADDLE_API_KEY"] }, async (req, res) => {
  try {
    console.log("Paddle webhook:", JSON.stringify(req.body));
    const { event_type, data } = req.body;

    if(event_type === "subscription.activated" || event_type === "transaction.completed") {
      const userId = data?.custom_data?.userId;
      if(userId) {
        await admin.firestore()
          .collection("users")
          .doc(userId)
          .update({
            plan: "premium",
            paddleSubscriptionId: data.id,
            updatedAt: new Date().toISOString()
          });
        console.log("Premium activado via Paddle para:", userId);
      }
    }

    if(event_type === "subscription.canceled") {
      const userId = data?.custom_data?.userId;
      if(userId) {
        await admin.firestore()
          .collection("users")
          .doc(userId)
          .update({ plan: "free", updatedAt: new Date().toISOString() });
      }
    }

    res.sendStatus(200);
  } catch(e) {
    console.error("Paddle webhook error:", e.message);
    res.sendStatus(500);
  }
});