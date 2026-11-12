// Supabase Edge Function: ponte segura (zero CORS) para Vertex AI usando créditos GCP (R$ 1.830,55).
// Segredo obrigatório no Supabase: GCP_SERVICE_ACCOUNT_JSON
// Segredos opcionais: VERTEX_LOCATION (padrão "us-central1"), VERTEX_CUTOFF_DATE (padrão "2027-02-05"), ALLOWED_OWNER_EMAIL

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const IMAGEN_PRICES_USD: Record<string, number> = {
  "imagen-4.0-fast-generate-001": 0.02,
  "imagen-4.0-generate-001": 0.04,
  "imagen-4.0-ultra-generate-001": 0.06,
  "imagen-3.0-fast-generate-002": 0.02,
  "imagen-3.0-generate-002": 0.04
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function getGoogleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 120 > now) {
    return cachedToken.token;
  }

  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned))
  );
  const jwt = `${unsigned}.${base64UrlEncode(sig)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(`Falha OAuth2 GCP (${tokenRes.status}): ${JSON.stringify(tokenJson).slice(0, 220)}`);
  }

  cachedToken = {
    token: tokenJson.access_token,
    expiresAt: now + (Number(tokenJson.expires_in) || 3600)
  };
  return cachedToken.token;
}

async function verifySupabaseCaller(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !supabaseUrl || !supabaseAnonKey) {
    return { ok: false, status: 401, error: "Sessão Supabase ausente." };
  }
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: supabaseAnonKey, Authorization: auth }
  });
  if (!res.ok) return { ok: false, status: 401, error: "Token Supabase inválido ou expirado." };
  const user = await res.json().catch(() => null);
  const allowedEmail = (Deno.env.get("ALLOWED_OWNER_EMAIL") || "").trim().toLowerCase();
  if (allowedEmail && String(user?.email || "").toLowerCase() !== allowedEmail) {
    return { ok: false, status: 403, error: "Conta sem permissão para usar a ponte Vertex AI." };
  }
  return { ok: true, user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authCheck = await verifySupabaseCaller(req);
  if (!authCheck.ok) return jsonResponse({ error: authCheck.error }, authCheck.status);

  const cutoff = (Deno.env.get("VERTEX_CUTOFF_DATE") || "2027-02-05").trim();
  const today = new Date().toISOString().slice(0, 10);
  if (cutoff && today > cutoff) {
    return jsonResponse(
      { error: `Trava de segurança ativa: Vertex AI pausada após ${cutoff} para evitar cobrança no cartão.` },
      403
    );
  }

  const saRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_JSON") || "";
  if (!saRaw) {
    return jsonResponse({ error: "Secret GCP_SERVICE_ACCOUNT_JSON não configurado no Supabase." }, 500);
  }

  let sa: { project_id: string; client_email: string; private_key: string };
  try {
    sa = JSON.parse(saRaw);
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error("Campos ausentes");
  } catch {
    return jsonResponse({ error: "GCP_SERVICE_ACCOUNT_JSON inválido." }, 500);
  }

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }

  const location = (Deno.env.get("VERTEX_LOCATION") || "us-central1").trim();
  const accessToken = await getGoogleAccessToken(sa);
  const action = String(body.action || "");

  if (action === "ping") {
    return jsonResponse({ ok: true, projectId: sa.project_id, location, cutoffDate: cutoff });
  }

  const vertexBase = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/locations/${encodeURIComponent(location)}/publishers/google/models`;

  if (action === "tts") {
    const requestedModel = String(body.model || "gemini-2.5-flash-tts");
    const tryModels = requestedModel === "gemini-2.5-flash-tts"
      ? ["gemini-2.5-flash-tts", "gemini-2.5-flash-preview-tts"]
      : [requestedModel];

    let lastStatus = 500;
    let lastErr = "";
    for (const model of tryModels) {
      const res = await fetch(`${vertexBase}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: String(body.promptText || "") }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: String(body.voiceName || "Charon") }
              }
            }
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const inlineData = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
        if (!inlineData?.data) return jsonResponse({ error: "Vertex TTS não retornou áudio." }, 502);
        return jsonResponse({ inlineData, usageMetadata: data.usageMetadata || null, model });
      }
      lastStatus = res.status;
      lastErr = await res.text().catch(() => "");
      if (res.status !== 404) break;
    }
    return jsonResponse({ error: `Vertex TTS (${lastStatus}): ${lastErr.slice(0, 240)}` }, lastStatus);
  }

  if (action === "generate") {
    const model = String(body.model || "gemini-2.5-flash");
    const res = await fetch(`${vertexBase}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body.payload || {})
    });
    const text = await res.text();
    if (!res.ok) return jsonResponse({ error: `Vertex (${res.status}): ${text.slice(0, 240)}` }, res.status);
    return new Response(text, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  if (action === "image") {
    const model = String(body.model || "imagen-4.0-fast-generate-001");
    const prompt = String(body.prompt || "").trim();
    const aspectRatio = String(body.aspectRatio || "9:16");
    if (!prompt) return jsonResponse({ error: "Prompt de imagem vazio." }, 400);

    if (model.startsWith("imagen-")) {
      const res = await fetch(`${vertexBase}/${encodeURIComponent(model)}:predict`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio,
            personGeneration: "allow_adult",
            addWatermark: true,
            outputOptions: { mimeType: "image/jpeg", compressionQuality: 90 }
          }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return jsonResponse({ error: `Vertex Imagen (${res.status}): ${JSON.stringify(data).slice(0, 240)}` }, res.status);
      }
      const pred = data?.predictions?.[0];
      if (!pred?.bytesBase64Encoded) {
        return jsonResponse({ error: "Imagen não retornou bytes de imagem (possível filtro de segurança)." }, 502);
      }
      const costUsd = IMAGEN_PRICES_USD[model] ?? 0.02;
      return jsonResponse({
        imageBase64: pred.bytesBase64Encoded,
        mimeType: pred.mimeType || "image/jpeg",
        costUsd,
        usageMetadata: null,
        model
      });
    }

    // gemini-2.5-flash-image via generateContent
    const res = await fetch(`${vertexBase}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          imageConfig: { aspectRatio }
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return jsonResponse({ error: `Vertex Gemini Image (${res.status}): ${JSON.stringify(data).slice(0, 240)}` }, res.status);
    }
    const imgPart = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
    if (!imgPart?.data) {
      return jsonResponse({ error: "Gemini Image não retornou imagem (possível filtro de segurança)." }, 502);
    }
    const um = data.usageMetadata || {};
    const costUsd = ((um.promptTokenCount || 0) * 0.3 + (um.candidatesTokenCount || 1290) * 2.5) / 1e6;
    return jsonResponse({
      imageBase64: imgPart.data,
      mimeType: imgPart.mimeType || "image/png",
      costUsd,
      usageMetadata: um,
      model
    });
  }

  return jsonResponse({ error: `Ação desconhecida: ${action}` }, 400);
});
