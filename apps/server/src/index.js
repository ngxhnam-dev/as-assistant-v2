import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { EVENTS } from "@assistant/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");

dotenv.config({ path: path.join(workspaceRoot, ".env") });

const app = express();
const port = Number(process.env.PORT || 8787);
const wsPath = process.env.WS_PATH || "/ws";

const requiredEnv = [
  "DIFY_BASE_URL",
  "DIFY_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`[config] Missing environment variable: ${key}`);
  }
}

const activeRequests = new Map();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: wsPath });
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

app.use(
  cors({
    origin: [
      process.env.MASCOT_ORIGIN || "http://localhost:5173",
      process.env.CONTROLLER_ORIGIN || "http://localhost:5174"
    ]
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, wsPath, clients: wss.clients.size });
});

app.post("/api/realtime/publish", async (req, res) => {
  const { name, data } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: "Event name is required." });
  }

  try {
    console.log("[realtime] publish", name, data);
    await publishEvent(name, data || {});
    res.json({ ok: true });
  } catch (error) {
    console.error("[realtime/publish]", error);
    res.status(500).json({ error: "Unable to publish event." });
  }
});

app.post("/api/stop", async (req, res) => {
  const { sessionId, silent } = req.body || {};
  console.log("[stop] requested", {
    sessionId: sessionId || null,
    silent: Boolean(silent)
  });

  if (sessionId && activeRequests.has(sessionId)) {
    activeRequests.get(sessionId).abort();
    activeRequests.delete(sessionId);
  }

  try {
    if (!silent) {
      await publishEvent(EVENTS.STOP_RESPONSE, { sessionId: sessionId || null });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("[stop]", error);
    res.status(500).json({ error: "Unable to stop current response." });
  }
});

app.post("/api/chat", async (req, res) => {
  const { message, sessionId, conversationId } = req.body || {};
  console.log("[chat] incoming", {
    sessionId: sessionId || null,
    conversationId: conversationId || null,
    message
  });

  if (!message?.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }

  if (sessionId && activeRequests.has(sessionId)) {
    activeRequests.get(sessionId).abort();
    activeRequests.delete(sessionId);
  }

  const controller = new AbortController();
  if (sessionId) {
    activeRequests.set(sessionId, controller);
  }

  try {
    await publishEvent(EVENTS.USER_MESSAGE, {
      sessionId,
      text: message.trim(),
      createdAt: new Date().toISOString()
    });

    await publishEvent(EVENTS.SET_THINKING, {
      sessionId,
      createdAt: new Date().toISOString()
    });

    const difyResponse = await callDify({
      message,
      conversationId,
      signal: controller.signal
    });

    if (sessionId) {
      activeRequests.delete(sessionId);
    }

    const answer = difyResponse.answer?.trim();
    if (!answer) {
      throw new Error("Dify returned an empty answer.");
    }

    console.log("[chat] dify response", {
      sessionId: sessionId || null,
      conversationId: difyResponse.conversation_id || null,
      answer
    });

    await publishEvent(EVENTS.SEND_RESPONSE, {
      sessionId,
      text: answer,
      conversationId: difyResponse.conversation_id || null,
      createdAt: new Date().toISOString()
    });

    res.json({
      answer,
      conversationId: difyResponse.conversation_id || null
    });
  } catch (error) {
    if (sessionId) {
      activeRequests.delete(sessionId);
    }

    if (error.name === "AbortError") {
      return res.status(499).json({ error: "Request aborted." });
    }

    console.error("[chat]", error);
    res.status(500).json({
      error: "Unable to get answer from Dify.",
      details: error.message
    });
  }
});

app.get("/api/tts/stream", async (req, res) => {
  const text = req.query.text?.toString();
  console.log("[tts] stream request", {
    textLength: text?.length || 0
  });

  if (!text?.trim()) {
    return res.status(400).json({ error: "Text query is required." });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const dictionaryId = process.env.ELEVENLABS_DICTIONARY_ID;
  const dictionaryVersionId = process.env.ELEVENLABS_DICTIONARY_VERSION_ID;

  try {
    const pronunciationDictionaryLocators =
      dictionaryId && dictionaryVersionId
        ? [
            {
              pronunciationDictionaryId: dictionaryId,
              versionId: dictionaryVersionId
            }
          ]
        : undefined;

    const { data, rawResponse } = await elevenlabs.textToSpeech
      .convert(voiceId, {
        text,
        modelId,
        outputFormat: "mp3_44100_128",
        pronunciationDictionaryLocators
      })
      .withRawResponse();

    console.log("[tts] elevenlabs metadata", {
      requestId: rawResponse.headers.get("request-id"),
      dictionaryId: dictionaryId || null,
      dictionaryVersionId: dictionaryVersionId || null
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    await pipeElevenLabsAudio(data, res);
  } catch (error) {
    console.error("[tts/stream]", error);
    res.status(500).json({
      error: "Unable to stream audio.",
      details: error.message
    });
  }
});

async function pipeElevenLabsAudio(data, res) {
  if (!data) {
    throw new Error("ElevenLabs returned empty audio data.");
  }

  if (typeof data.pipe === "function") {
    data.pipe(res);
    return;
  }

  if (typeof data.getReader === "function") {
    Readable.fromWeb(data).pipe(res);
    return;
  }

  if (data instanceof Uint8Array) {
    res.end(Buffer.from(data));
    return;
  }

  if (data instanceof ArrayBuffer) {
    res.end(Buffer.from(data));
    return;
  }

  if (typeof data.arrayBuffer === "function") {
    const buffer = Buffer.from(await data.arrayBuffer());
    res.end(buffer);
    return;
  }

  throw new Error(`Unsupported ElevenLabs audio payload type: ${typeof data}`);
}

function publishEvent(name, data) {
  console.log("[ws] broadcast", {
    type: name,
    clients: wss.clients.size,
    data
  });

  const payload = JSON.stringify({
    type: name,
    data
  });

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

async function callDify({ message, conversationId, signal }) {
  const baseUrl = process.env.DIFY_BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat-messages`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`
    },
    body: JSON.stringify({
      inputs: {},
      query: message,
      response_mode: "blocking",
      conversation_id: conversationId || undefined,
      user: process.env.DIFY_USER || "mascot-controller"
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Dify error ${response.status}: ${details}`);
  }

  return response.json();
}

wss.on("connection", (socket) => {
  console.log("[ws] client connected", { clients: wss.clients.size });

  socket.send(
    JSON.stringify({
      type: EVENTS.HEARTBEAT,
      data: {
        connectedAt: new Date().toISOString()
      }
    })
  );

  socket.on("close", () => {
    console.log("[ws] client disconnected", {
      clients: wss.clients.size
    });
  });
});

server.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  console.log(`[server] websocket available at ws://localhost:${port}${wsPath}`);
});
