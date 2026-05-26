import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
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
const allowedOrigins = new Set(
  [
    process.env.MASCOT_ORIGIN,
    process.env.CONTROLLER_ORIGIN,
    "http://localhost:5173",
    "http://localhost:5174"
  ].filter(Boolean)
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin) || isAllowedLanOrigin(origin)) {
      return callback(null, true);
    }

    console.warn("[cors] blocked origin", origin);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
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
    const activeRequest = activeRequests.get(sessionId);
    activeRequest.controller.abort();
    if (activeRequest.taskId) {
      void stopDifyTask(activeRequest.taskId).catch((error) => {
        console.error("[stop] unable to stop dify task", error);
      });
    }
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
    const activeRequest = activeRequests.get(sessionId);
    activeRequest.controller.abort();
    if (activeRequest.taskId) {
      void stopDifyTask(activeRequest.taskId).catch((error) => {
        console.error("[chat] unable to stop previous dify task", error);
      });
    }
    activeRequests.delete(sessionId);
  }

  const controller = new AbortController();
  if (sessionId) {
    activeRequests.set(sessionId, {
      controller,
      taskId: null
    });
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

    const difyResponse = await callDifyBlocking({
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
              pronunciation_dictionary_id: dictionaryId,
              version_id: dictionaryVersionId
            }
          ]
        : undefined;

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          pronunciation_dictionary_locators: pronunciationDictionaryLocators
        })
      }
    );

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`ElevenLabs error ${response.status}: ${details}`);
    }

    console.log("[tts] elevenlabs metadata", {
      requestId: response.headers.get("request-id"),
      dictionaryId: dictionaryId || null,
      dictionaryVersionId: dictionaryVersionId || null
    });

    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    await pipeElevenLabsAudio(response.body, res);
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

async function callDifyBlocking({ message, conversationId, signal }) {
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
      conversation_id: conversationId || "",
      user: process.env.DIFY_USER || ""
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Dify error ${response.status}: ${details}`);
  }

  const payload = await response.json();

  return {
    answer: typeof payload?.answer === "string" ? payload.answer.trim() : "",
    conversation_id: payload?.conversation_id || conversationId || null,
    task_id: payload?.task_id || null,
    message_id: payload?.message_id || null
  };
}

async function stopDifyTask(taskId) {
  if (!taskId) {
    return;
  }

  const baseUrl = process.env.DIFY_BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat-messages/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`
    },
    body: JSON.stringify({
      user: process.env.DIFY_USER || "mascot-controller"
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Dify stop error ${response.status}: ${details}`);
  }
}

function isAllowedLanOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    const isHttp = protocol === "http:" || protocol === "https:";
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    const isPrivateIpv4 =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

    return isHttp && (isLocalhost || isPrivateIpv4);
  } catch {
    return false;
  }
}

function getServerHosts() {
  const networkInterfaces = os.networkInterfaces();
  const preferredHosts = new Set();
  const fallbackHosts = new Set();

  for (const [interfaceName, addresses] of Object.entries(networkInterfaces)) {
    if (!addresses) {
      continue;
    }

    for (const address of addresses) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      const isVirtualInterface =
        /docker|wsl|hyper-v|vethernet|vmware|virtualbox|loopback|teredo/i.test(interfaceName);

      if (isVirtualInterface) {
        fallbackHosts.add(address.address);
        continue;
      }

      preferredHosts.add(address.address);
    }
  }

  if (preferredHosts.size) {
    return Array.from(preferredHosts);
  }

  if (fallbackHosts.size) {
    return Array.from(fallbackHosts);
  }

  return ["localhost"];
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
  const hosts = getServerHosts();

  for (const host of hosts) {
    console.log(`[server] listening on http://${host}:${port}`);
    console.log(`[server] websocket available at ws://${host}:${port}${wsPath}`);
  }
});
