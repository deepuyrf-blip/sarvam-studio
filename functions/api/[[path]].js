const SARVAM_API = "https://api.sarvam.ai";
const DUBBING_API = "https://studio.sarvam.ai/api/dubbing";

function cors(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors(request)
    }
  });
}

function withCors(request, response) {
  const h = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors(request))) h.set(k, v);
  return new Response(response.body, { status: response.status, headers: h });
}

function keyOrError(request, env) {
  if (!env.SARVAM_API_KEY) {
    return json(request, {
      ok: false,
      error: "SARVAM_API_KEY secret is not configured in Cloudflare Pages."
    }, 500);
  }
  return null;
}

async function sarvamFetch(url, env, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("api-subscription-key", env.SARVAM_API_KEY);
  return fetch(url, { ...init, headers });
}

async function proxyJson(request, env, url, body) {
  const response = await sarvamFetch(url, env, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return withCors(request, response);
}

async function readUpstream(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { return { raw: text }; }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(request) });
  }

  // Basic Pages/API health check.
  if (path === "/api/health" && request.method === "GET") {
    return json(request, {
      ok: true,
      service: "sarvam-pages-function",
      apiKeyConfigured: Boolean(env.SARVAM_API_KEY)
    });
  }

  const keyError = keyOrError(request, env);
  if (keyError) return keyError;

  // ---------- TEXT TO SPEECH ----------
  if (path === "/api/tts" && request.method === "POST") {
    try {
      const input = await request.json();

      // The UI uses target_language_code; Sarvam REST expects language_code.
      const body = {
        text: input.text,
        language_code: input.language_code || input.target_language_code || "hi-IN",
        speaker: input.speaker || "shubh",
        model: input.model || "bulbul:v3",
        pace: Number(input.pace ?? 1),
        speech_sample_rate: Number(input.speech_sample_rate ?? 22050)
      };

      if (!body.text) return json(request, { error: "Text is required." }, 400);

      return await proxyJson(
        request,
        env,
        `${SARVAM_API}/text-to-speech`,
        body
      );
    } catch (e) {
      return json(request, { error: e.message || "TTS request failed." }, 400);
    }
  }

  // ---------- SPEECH TO TEXT ----------
  if (path === "/api/stt" && request.method === "POST") {
    try {
      const incoming = await request.formData();
      const file = incoming.get("file");

      if (!(file instanceof File)) {
        return json(request, { error: "Audio file is required." }, 400);
      }

      const form = new FormData();
      form.append("file", file, file.name || "audio.wav");
      form.append("model", incoming.get("model") || "saaras:v4");
      form.append("mode", incoming.get("mode") || "transcribe");

      const language = incoming.get("language_code");
      if (language) form.append("language_code", language);

      const sampleRate = incoming.get("sample_rate");
      if (sampleRate) form.append("sample_rate", sampleRate);

      const response = await sarvamFetch(`${SARVAM_API}/speech-to-text`, env, {
        method: "POST",
        body: form
      });

      return withCors(request, response);
    } catch (e) {
      return json(request, { error: e.message || "STT request failed." }, 400);
    }
  }

  // ---------- VOICE CLONE ----------
  // Keeps the UI's simple /api/clone contract:
  // 1) create a saved voice from ref_audio
  // 2) immediately generate speech with that voice_id
  if (path === "/api/clone" && request.method === "POST") {
    try {
      const incoming = await request.formData();
      const file = incoming.get("ref_audio");
      const text = String(incoming.get("text") || "");
      const language = String(incoming.get("language_code") || "hi-IN");

      if (!(file instanceof File)) {
        return json(request, { error: "Reference audio is required." }, 400);
      }
      if (!text.trim()) {
        return json(request, { error: "Text is required." }, 400);
      }

      // Current Sarvam Voice Cloning API requires /voices/create first.
      const createForm = new FormData();
      createForm.append("name", `sarvam-web-${Date.now()}`);
      createForm.append("language", language);
      createForm.append("file", file, file.name || "reference.wav");

      const createResponse = await sarvamFetch(`${SARVAM_API}/voices/create`, env, {
        method: "POST",
        body: createForm
      });

      const createData = await readUpstream(createResponse);
      if (!createResponse.ok) {
        return json(request, {
          error: "Voice creation failed.",
          details: createData
        }, createResponse.status);
      }

      const voiceId =
        createData?.voice_id ||
        createData?.data?.voice_id ||
        createData?.id ||
        createData?.data?.id;

      if (!voiceId) {
        return json(request, {
          error: "Sarvam did not return a voice_id.",
          details: createData
        }, 502);
      }

      const cloneForm = new FormData();
      cloneForm.append("voice_id", voiceId);
      cloneForm.append("text", text);
      cloneForm.append("language_code", language);

      const cloneResponse = await sarvamFetch(`${SARVAM_API}/voices/clone`, env, {
        method: "POST",
        body: cloneForm
      });

      return withCors(request, cloneResponse);
    } catch (e) {
      return json(request, { error: e.message || "Voice clone failed." }, 500);
    }
  }

  // ---------- TRANSLATION ----------
  if (path === "/api/translate" && request.method === "POST") {
    try {
      const input = await request.json();

      const body = {
        input: input.input || "",
        source_language_code: input.source_language_code || "en-IN",
        target_language_code: input.target_language_code || "hi-IN"
      };

      if (!body.input) return json(request, { error: "Input text is required." }, 400);

      return await proxyJson(
        request,
        env,
        `${SARVAM_API}/translate`,
        body
      );
    } catch (e) {
      return json(request, { error: e.message || "Translation failed." }, 400);
    }
  }

  // ---------- CHAT ----------
  if (path === "/api/chat" && request.method === "POST") {
    try {
      const input = await request.json();

      const body = {
        model: input.model || "sarvam-105b",
        messages: Array.isArray(input.messages) ? input.messages : []
      };

      if (!body.messages.length) {
        return json(request, { error: "messages array is required." }, 400);
      }

      return await proxyJson(
        request,
        env,
        `${SARVAM_API}/v1/chat/completions`,
        body
      );
    } catch (e) {
      return json(request, { error: e.message || "Chat request failed." }, 400);
    }
  }

  // ---------- VIDEO DUBBING ----------
  if (path === "/api/dub/jobs" && request.method === "POST") {
    try {
      const body = await request.json();

      const response = await sarvamFetch(`${DUBBING_API}/jobs`, env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      return withCors(request, response);
    } catch (e) {
      return json(request, { error: e.message || "Dubbing job creation failed." }, 400);
    }
  }

  const startMatch = path.match(/^\/api\/dub\/jobs\/([^/]+)\/start$/);
  if (startMatch && request.method === "POST") {
    const jobId = startMatch[1];

    const response = await sarvamFetch(
      `${DUBBING_API}/jobs/${encodeURIComponent(jobId)}/start`,
      env,
      { method: "POST" }
    );

    return withCors(request, response);
  }

  const statusMatch = path.match(/^\/api\/dub\/jobs\/([^/]+)\/live-status$/);
  if (statusMatch && request.method === "GET") {
    const jobId = statusMatch[1];

    const response = await sarvamFetch(
      `${DUBBING_API}/jobs/${encodeURIComponent(jobId)}/live-status`,
      env,
      { method: "GET" }
    );

    return withCors(request, response);
  }

  return json(request, {
    ok: false,
    error: `Unknown API route: ${request.method} ${path}`
  }, 404);
}
