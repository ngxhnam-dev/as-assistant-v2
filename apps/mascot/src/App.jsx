import { useEffect, useRef, useState } from "react";
import { EVENTS, MASCOT_STATES } from "@assistant/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8787/ws";

const VIDEO_SOURCES = {
  [MASCOT_STATES.IDLE]:
    "/video/idle.mp4",
  [MASCOT_STATES.THINKING]:
    "/video/thinking.mp4",
  [MASCOT_STATES.SPEAKING]:
    "/video/speaking.mp4"
};

export default function App() {
  const [status, setStatus] = useState("Waiting for audio unlock");
  const [activeState, setActiveState] = useState(MASCOT_STATES.IDLE);
  const [lastText, setLastText] = useState("");
  const [messages, setMessages] = useState([]);
  const audioRef = useRef(null);
  const wsRef = useRef(null);
  const historyRef = useRef(null);
  const pendingSpeechRef = useRef("");
  const isAudioPrimedRef = useRef(false);
  const pendingAssistantMessageRef = useRef("");
  const typingTimerRef = useRef(null);

  useEffect(() => {
    const container = historyRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    attemptAudioPrime();

    const activateAudio = () => {
      attemptAudioPrime();
      void tryPlayPendingSpeech();
    };

    window.addEventListener("pointerdown", activateAudio, { passive: true });
    window.addEventListener("keydown", activateAudio);
    window.addEventListener("touchstart", activateAudio, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", activateAudio);
      window.removeEventListener("keydown", activateAudio);
      window.removeEventListener("touchstart", activateAudio);
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      console.log("[mascot] websocket connected");
      setStatus("Listening for events");
    });

    ws.addEventListener("error", (event) => {
      console.log("[mascot] websocket error", event);
      setStatus("Realtime connection failed");
    });

    ws.addEventListener("close", () => {
      console.log("[mascot] websocket closed");
      setStatus("Realtime connection closed");
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { type, data } = payload || {};
        console.log("[mascot] websocket message", { type, data });

        if (type === EVENTS.USER_MESSAGE) {
          const text = data?.text || "";
          if (text) {
            setMessages((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                role: "user",
                text
              }
            ]);
          }
          return;
        }

        if (type === EVENTS.SET_THINKING) {
          console.log("[mascot] set thinking");
          stopAudio();
          setStatus("Thinking...");
          setActiveState(MASCOT_STATES.THINKING);
          return;
        }

        if (type === EVENTS.SEND_RESPONSE) {
          const text = data?.text || "";
          setLastText(text);
          console.log("[mascot] response received", text);
          pendingAssistantMessageRef.current = text;
          pendingSpeechRef.current = text;
          void tryPlayPendingSpeech();
          return;
        }

        if (type === EVENTS.STOP_RESPONSE) {
          console.log("[mascot] stop response");
          pendingSpeechRef.current = "";
          pendingAssistantMessageRef.current = "";
          if (typingTimerRef.current) {
            clearInterval(typingTimerRef.current);
            typingTimerRef.current = null;
          }
          stopAudio();
          setStatus("Interrupted");
          setActiveState(MASCOT_STATES.IDLE);
        }
      } catch (parseError) {
        console.log("[mascot] websocket parse error", parseError);
        setStatus("Invalid realtime payload");
      }
    });

    return () => {
      ws.close();
    };
  }, [WS_URL]);

  async function attemptAudioPrime() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (isAudioPrimedRef.current) {
      return;
    }

    console.log("[mascot] attempt audio prime");

    audio.muted = true;
    try {
      await audio.play();
      isAudioPrimedRef.current = true;
      console.log("[mascot] audio primed");
      setStatus("Audio ready");
    } catch (error) {
      console.log("[mascot] audio prime blocked", error);
      setStatus("Audio waiting for browser permission");
    } finally {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    }
  }

  function stopAudio() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    console.log("[mascot] stop audio");

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  async function tryPlayPendingSpeech() {
    if (!pendingSpeechRef.current) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const text = pendingSpeechRef.current;
    console.log("[mascot] try play pending speech", text);
    stopAudio();
    setStatus("Preparing audio stream");
    audio.src = `${API_BASE_URL}/api/tts/stream?text=${encodeURIComponent(text)}`;

    try {
      await audio.play();
      pendingSpeechRef.current = "";
    } catch (error) {
      console.log("[mascot] pending speech blocked", error);
      setStatus("Audio waiting for browser permission");
    }
  }

  function playSpeech(text) {
    if (!text) {
      setActiveState(MASCOT_STATES.IDLE);
      return;
    }
    pendingSpeechRef.current = text;
    void tryPlayPendingSpeech();
  }

  function startAssistantTyping(fullText) {
    if (!fullText) {
      return;
    }

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
    }

    const messageId = crypto.randomUUID();
    let visibleLength = 0;

    setMessages((current) => [
      ...current,
      {
        id: messageId,
        role: "assistant",
        text: ""
      }
    ]);

    typingTimerRef.current = setInterval(() => {
      visibleLength += 1;
      const nextText = fullText.slice(0, visibleLength);

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, text: nextText } : message
        )
      );

      if (visibleLength >= fullText.length) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }, 28);
  }

  return (
    <main className="mascot-shell">
      <div className="video-stage">
        {Object.entries(VIDEO_SOURCES).map(([state, src]) => (
          <video
            key={state}
            className={`mascot-video ${activeState === state ? "is-visible" : ""}`}
            src={src}
            autoPlay
            loop
            muted
            playsInline
          />
        ))}
      </div>
      <div className="logo">
        <img src="/image/logo metholatum.png" />
      </div>
      <div className="chat-history" ref={historyRef}>
        {messages.map((message) => (
          <article key={message.id} className={`history-message ${message.role}`}>
            <p>{message.text}</p>
          </article>
        ))}
      </div>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => {
          console.log("[mascot] audio onPlay");
        }}
        onPlaying={() => {
          console.log("[mascot] audio onPlaying");
          if (pendingAssistantMessageRef.current) {
            startAssistantTyping(pendingAssistantMessageRef.current);
            pendingAssistantMessageRef.current = "";
          }
          setStatus("Speaking");
          setActiveState(MASCOT_STATES.SPEAKING);
        }}
        onEnded={() => {
          console.log("[mascot] audio onEnded");
          setStatus("Idle");
          setActiveState(MASCOT_STATES.IDLE);
        }}
        onError={(event) => {
          console.log("[mascot] audio onError", event);
          setStatus("Audio stream failed");
          setActiveState(MASCOT_STATES.IDLE);
        }}
      />
    </main>
  );
}
