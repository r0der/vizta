const { onRequest } = require("firebase-functions/https");
const { setGlobalOptions } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const ACCESS_TOKEN = "TEST-4f7c3568-7f31-430e-b4e9-be4645adc642";
const PLAN_ID = "f56ff0396a494f6ea4c566b45338c84c";
const BASE_URL = "https://r0der.github.io/pantaya";

// ── 1. CREAR SUSCRIPCIÓN ──────────────────────────────────────
exports.crearSuscripcion = onRequest(async (req, res) => {
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

    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        preapproval_plan_id: PLAN_ID,
        payer_email: userEmail,
        back_url: `${BASE_URL}?premium=success`,
        external_reference: userId,
        status: "pending"
      })
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(500).json({ error: data });
      return;
    }

    res.json({ init_point: data.init_point });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── 2. WEBHOOK DE MP ─────────────────────────────────────────
exports.webhookMP = onRequest(async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "subscription_preapproval") {
      const response = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
        headers: { "Authorization": `Bearer ${ACCESS_TOKEN}` }
      });
      const sub = await response.json();
      const userId = sub.external_reference;
      const plan = sub.status === "authorized" ? "premium" : "free";

      if (userId) {
        await admin.firestore()
          .collection("users")
          .doc(userId)
          .update({ 
            plan, 
            subscriptionId: data.id, 
            updatedAt: new Date().toISOString() 
          });
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});