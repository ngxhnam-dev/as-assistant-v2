import { useEffect, useMemo, useRef, useState } from "react";
import { EVENTS, createSessionId } from "@assistant/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8787/ws";
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

const initialMessages = [
  {
    id: "intro",
    role: "assistant",
    text: "Mascot controller ready. Send a message or use voice input."
  }
];

export default function App() {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const wsRef = useRef(null);
  const autoSendTimerRef = useRef(null);
  const transcriptRef = useRef("");
  const voiceSendLockedRef = useRef(false);
  const lastSentVoiceTranscriptRef = useRef("");
  const sessionId = useMemo(() => createSessionId(), []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      console.log("[controller] websocket connected");
    });

    ws.addEventListener("close", () => {
      console.log("[controller] websocket closed");
    });

    ws.addEventListener("error", (event) => {
      console.log("[controller] websocket error", event);
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { type, data } = payload || {};
        console.log("[controller] websocket message", { type, data });

        if (data?.sessionId && data.sessionId !== sessionId) {
          return;
        }

        if (type === EVENTS.USER_MESSAGE) {
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "user",
              text: data?.text || ""
            }
          ]);
          return;
        }

        if (type === EVENTS.SEND_RESPONSE) {
          setConversationId(data?.conversationId || null);
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: data?.text || ""
            }
          ]);
          return;
        }

        if (type === EVENTS.STOP_RESPONSE) {
          setMessages((current) => current.filter((message) => message.role !== "typing"));
        }
      } catch (parseError) {
        console.log("[controller] websocket parse error", parseError);
      }
    });

    return () => {
      clearAutoSendTimer();
      recognitionRef.current?.stop();
      ws.close();
    };
  }, [sessionId]);

  async function sendMessage(rawText) {
    const message = rawText.trim();
    if (!message || isSending) {
      return;
    }

    console.log("[controller] sendMessage", {
      sessionId,
      conversationId,
      message
    });

    setError("");
    setIsSending(true);
    setInput("");
    transcriptRef.current = "";
    clearAutoSendTimer();

    try {
      console.log("[controller] optimistic thinking", { sessionId });
      await fetch(`${API_BASE_URL}/api/realtime/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: EVENTS.SET_THINKING,
          data: {
            sessionId,
            createdAt: new Date().toISOString(),
            optimistic: true
          }
        })
      });

      console.log("[controller] requesting stop", { sessionId });
      await fetch(`${API_BASE_URL}/api/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          silent: true
        })
      });

      console.log("[controller] requesting chat", {
        sessionId,
        conversationId,
        message
      });
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          sessionId,
          conversationId
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Request failed.");
      }

      console.log("[controller] chat success", payload);
    } catch (requestError) {
      console.log("[controller] chat error", requestError);
      setError(requestError.message);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: `Error: ${requestError.message}`
        }
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function toggleVoiceInput() {
    if (!SpeechRecognition) {
      console.log("[controller] speech recognition unavailable");
      setError("This browser does not support Web Speech API.");
      return;
    }

    if (isListening) {
      console.log("[controller] stop voice input");
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "vi-VN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    voiceSendLockedRef.current = false;
    transcriptRef.current = "";
    lastSentVoiceTranscriptRef.current = "";

    recognition.onstart = () => {
      console.log("[controller] voice input started");
      setError("");
      setIsListening(true);
    };

    recognition.onend = () => {
      console.log("[controller] voice input ended");
      clearAutoSendTimer();
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      console.log("[controller] voice input error", event.error);
      setError(`Voice input failed: ${event.error}`);
      setIsListening(false);
    };

    recognition.onresult = (event) => {
      if (voiceSendLockedRef.current) {
        console.log("[controller] ignore transcript because voice send is locked");
        return;
      }

      const latestTranscript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      if (!latestTranscript) {
        return;
      }

      console.log("[controller] voice transcript", latestTranscript);
      transcriptRef.current = latestTranscript;
      setInput(latestTranscript);
      scheduleAutoSend();
    };

    recognitionRef.current = recognition;
    console.log("[controller] start voice input");
    recognition.start();
  }

  function clearAutoSendTimer() {
    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
  }

  function scheduleAutoSend() {
    clearAutoSendTimer();
    autoSendTimerRef.current = setTimeout(() => {
      const transcript = transcriptRef.current.trim();
      if (!transcript || voiceSendLockedRef.current) {
        return;
      }

      if (lastSentVoiceTranscriptRef.current === transcript) {
        console.log("[controller] skip duplicate voice transcript", transcript);
        return;
      }

      console.log("[controller] auto send transcript after silence", transcript);
      voiceSendLockedRef.current = true;
      lastSentVoiceTranscriptRef.current = transcript;
      recognitionRef.current?.stop();
      sendMessage(transcript);
    }, 2000);
  }

  return (
    <main className="controller-shell">
      <section className="controller-panel">

        <div className="chat-log">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <span>{message.role}</span>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage(input);
          }}
        >
          <div className="voice-button-wrap">
            <button
              type="button"
              className={`voice-button ${isListening ? "is-live" : ""}`}
              onClick={toggleVoiceInput}
              aria-label={isListening ? "Dang nghe" : "Voice chat"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 1 0 10 0Z" />
              </svg>
            </button>
          </div>
          <div className="composer-input">
            <textarea
              rows="3"
              value={input}
              placeholder="Nhap cau hoi..."
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(input);
                }
              }}
            />
            <button type="submit" className="send-button" disabled={isSending}>
              {isSending ? "Dang gui..." : "Gui"}
            </button>
          </div>
        </form>

        {error ? <p className="error-banner">{error}</p> : null}
      </section>
    </main>
  );
}
