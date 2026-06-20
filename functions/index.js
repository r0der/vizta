const { onRequest } = require("firebase-functions/https");
const { setGlobalOptions } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const ACCESS_TOKEN = "APP_USR-338865051860202-061619-2201243418050a99e50475bb98a51d52-86530069";
const PLAN_ID = "f56ff0396a494f6ea4c566b45338c84c";
const BASE_URL = "https://r0der.github.io/PantaYA";

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