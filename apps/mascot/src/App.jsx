import { useEffect, useRef, useState } from "react";
import { EVENTS, MASCOT_STATES, createClientId } from "@assistant/shared";

const DEFAULT_HOST =
  typeof window !== "undefined" ? window.location.hostname : "localhost";
const DEFAULT_PORT =
  typeof window !== "undefined" ? window.location.port : "";
const DEFAULT_PROTOCOL =
  typeof window !== "undefined" && window.location.protocol === "https:"
    ? "https"
    : "http";
const DEFAULT_WS_PROTOCOL = DEFAULT_PROTOCOL === "https" ? "wss" : "ws";
const DEFAULT_ORIGIN =
  typeof window !== "undefined"
    ? window.location.origin
    : `${DEFAULT_PROTOCOL}://${DEFAULT_HOST}${DEFAULT_PORT ? `:${DEFAULT_PORT}` : ""}`;
const DEFAULT_API_BASE_URL =
  DEFAULT_PROTOCOL === "https" ? DEFAULT_ORIGIN : `${DEFAULT_PROTOCOL}://${DEFAULT_HOST}:8787`;
const DEFAULT_WS_URL =
  DEFAULT_PROTOCOL === "https"
    ? `${DEFAULT_WS_PROTOCOL}://${DEFAULT_HOST}${DEFAULT_PORT ? `:${DEFAULT_PORT}` : ""}/ws`
    : `${DEFAULT_WS_PROTOCOL}://${DEFAULT_HOST}:8787/ws`;

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;
const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
const IDLE_VIDEO_SOURCES = [
  "/video/Acnes.mp4",
  "/video/Remos.mp4",
  "/video/LipIce.mp4"
];
const LOOPING_STATES = new Set([
  MASCOT_STATES.LISTENING,
  MASCOT_STATES.THINKING,
  MASCOT_STATES.SPEAKING
]);

const VIDEO_SOURCES = {
  [MASCOT_STATES.IDLE]:
    IDLE_VIDEO_SOURCES[0],
  [MASCOT_STATES.LISTENING]:
    "/video/listening.mp4",
  [MASCOT_STATES.THINKING]:
    "/video/thinking.mp4",
  [MASCOT_STATES.I_GOT_IT]:
    "/video/i_got_it.mp4",
  [MASCOT_STATES.THANKS_FOR_LISTENING]:
    "/video/thanks_for_listening.mp4",
  [MASCOT_STATES.SPEAKING]:
    "/video/speaking.mp4"
};

export default function App() {
  const [status, setStatus] = useState("Waiting for audio unlock");
  const [activeState, setActiveState] = useState(MASCOT_STATES.IDLE);
  const [idleVideoIndex, setIdleVideoIndex] = useState(0);
  const [lastText, setLastText] = useState("");
  const [messages, setMessages] = useState([]);
  const [showAudioUnlock, setShowAudioUnlock] = useState(true);
  const audioRef = useRef(null);
  const wsRef = useRef(null);
  const historyRef = useRef(null);
  const videoRefs = useRef({});
  const pendingSpeechRef = useRef("");
  const isAudioPrimedRef = useRef(false);
  const pendingAssistantMessageRef = useRef("");
  const preparedSpeechTextRef = useRef("");
  const speechPreparePromiseRef = useRef(null);

  useEffect(() => {
    const container = historyRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    syncVideoPlaybackState();
  }, [activeState, idleVideoIndex]);

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
                id: createClientId(),
                role: "user",
                text
              }
            ]);
          }
          return;
        }

        if (type === EVENTS.SET_LISTENING) {
          console.log("[mascot] set listening");
          pendingAssistantMessageRef.current = "";
          pendingSpeechRef.current = "";
          stopAudio();
          setStatus("Listening...");
          setActiveState(MASCOT_STATES.LISTENING);
          return;
        }

        if (type === EVENTS.SET_IDLE) {
          console.log("[mascot] set idle");
          pendingAssistantMessageRef.current = "";
          pendingSpeechRef.current = "";
          stopAudio();
          setStatus("Idle");
          setActiveState(MASCOT_STATES.IDLE);
          return;
        }

        if (type === EVENTS.SET_THINKING) {
          console.log("[mascot] set thinking");
          pendingAssistantMessageRef.current = "";
          pendingSpeechRef.current = "";
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
          setStatus("Preparing audio stream");
          void (async () => {
            await prepareSpeechAudio(text);

            if (pendingSpeechRef.current !== text || preparedSpeechTextRef.current !== text) {
              return;
            }

            setStatus("I got it");
            setActiveState(MASCOT_STATES.I_GOT_IT);
          })();
          return;
        }

        if (type === EVENTS.STOP_RESPONSE) {
          console.log("[mascot] stop response");
          pendingSpeechRef.current = "";
          pendingAssistantMessageRef.current = "";
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

  function stopAudio() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    console.log("[mascot] stop audio");

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    speechPreparePromiseRef.current = null;
    preparedSpeechTextRef.current = "";
  }

  function markAudioUnlocked() {
    isAudioPrimedRef.current = true;
    setShowAudioUnlock(false);
    syncVideoPlaybackState();
  }

  function syncVideoPlaybackState() {
    Object.entries(videoRefs.current).forEach(([state, video]) => {
      if (!video) {
        return;
      }

      const isActive = activeState === state;
      const shouldLoop = LOOPING_STATES.has(state);
      const shouldMute =
        state !== MASCOT_STATES.IDLE || !isActive || !isAudioPrimedRef.current;

      video.loop = shouldLoop;
      video.muted = shouldMute;

      if (!isActive) {
        video.pause();
        video.currentTime = 0;
        return;
      }

      video.currentTime = 0;
      video.play().catch((error) => {
        console.log(`[mascot] ${state} video play blocked`, error);
      });
    });
  }

  async function prepareSpeechAudio(text) {
    const audio = audioRef.current;
    if (!audio || !text) {
      return;
    }

    const streamUrl = `${API_BASE_URL}/api/tts/stream?text=${encodeURIComponent(text)}`;

    if (preparedSpeechTextRef.current === text && audio.src === streamUrl && audio.readyState >= 2) {
      return;
    }

    if (preparedSpeechTextRef.current === text && speechPreparePromiseRef.current) {
      await speechPreparePromiseRef.current;
      return;
    }

    console.log("[mascot] prepare speech audio", text);
    preparedSpeechTextRef.current = text;
    const preparePromise = (async () => {
      audio.pause();
      audio.muted = false;
      audio.src = streamUrl;

      await new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error("Timed out while preparing streaming audio."));
        }, 15000);

        const handleReady = () => {
          cleanup();
          console.log("[mascot] streaming audio ready");
          resolve();
        };

        const handleError = () => {
          cleanup();
          reject(new Error("Streaming audio failed to prepare."));
        };

        const cleanup = () => {
          window.clearTimeout(timeoutId);
          audio.removeEventListener("canplay", handleReady);
          audio.removeEventListener("loadeddata", handleReady);
          audio.removeEventListener("error", handleError);
        };

        audio.addEventListener("canplay", handleReady, { once: true });
        audio.addEventListener("loadeddata", handleReady, { once: true });
        audio.addEventListener("error", handleError, { once: true });
        audio.load();
      });
    })();

    speechPreparePromiseRef.current = preparePromise;

    try {
      await preparePromise;
    } catch (error) {
      console.log("[mascot] speech audio prepare failed", error);
      preparedSpeechTextRef.current = "";
    } finally {
      if (speechPreparePromiseRef.current === preparePromise) {
        speechPreparePromiseRef.current = null;
      }
    }
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
    setStatus("Preparing audio stream");

    if (preparedSpeechTextRef.current !== text || audio.readyState < 2) {
      await prepareSpeechAudio(text);
    }

    if (preparedSpeechTextRef.current !== text) {
      setStatus("Audio stream failed");
      setActiveState(MASCOT_STATES.IDLE);
      return;
    }

    audio.muted = false;

    try {
      await audio.play();
      markAudioUnlocked();
      pendingSpeechRef.current = "";
    } catch (error) {
      console.log("[mascot] pending speech blocked", error);
      setStatus("Audio waiting for browser permission");
      if (error.name === "NotAllowedError") {
        setShowAudioUnlock(true);
      }
    }
  }

  function showAssistantMessage(fullText) {
    if (!fullText) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: createClientId(),
        role: "assistant",
        text: fullText
      }
    ]);
  }

  async function handleAudioUnlock() {
    console.log("[mascot] manual audio unlock");

    const audio = audioRef.current;
    const text = pendingSpeechRef.current;
    if (!audio || !text) {
      markAudioUnlocked();
      setStatus("Audio ready");
      return;
    }

    setStatus("Preparing audio stream");
    if (preparedSpeechTextRef.current !== text || audio.readyState < 2) {
      await prepareSpeechAudio(text);
    }

    if (preparedSpeechTextRef.current !== text) {
      setStatus("Audio stream failed");
      if (pendingAssistantMessageRef.current) {
        showAssistantMessage(pendingAssistantMessageRef.current);
        pendingAssistantMessageRef.current = "";
      }
      return;
    }

    try {
      audio.muted = false;
      await audio.play();
      markAudioUnlocked();
      pendingSpeechRef.current = "";
    } catch (error) {
      console.log("[mascot] manual unlock play failed", error);
      setStatus("Audio waiting for browser permission");
      if (pendingAssistantMessageRef.current) {
        showAssistantMessage(pendingAssistantMessageRef.current);
        pendingAssistantMessageRef.current = "";
      }
    }
  }

  return (
    <main className="mascot-shell">
      <div className="video-stage">
        {Object.entries(VIDEO_SOURCES).map(([state, src]) => (
          <video
            key={state}
            ref={(node) => {
              if (node) {
                videoRefs.current[state] = node;
              }
            }}
            className={`mascot-video ${activeState === state ? "is-visible" : ""}`}
            src={state === MASCOT_STATES.IDLE ? IDLE_VIDEO_SOURCES[idleVideoIndex] : src}
            autoPlay
            loop={LOOPING_STATES.has(state)}
            muted={state !== MASCOT_STATES.IDLE}
            playsInline
            onEnded={() => {
              if (activeState !== state) {
                return;
              }

              if (state === MASCOT_STATES.I_GOT_IT) {
                console.log("[mascot] i_got_it ended, start speech");
                if (!pendingSpeechRef.current) {
                  setStatus("Idle");
                  setActiveState(MASCOT_STATES.IDLE);
                  return;
                }
                void tryPlayPendingSpeech();
                return;
              }

              if (state === MASCOT_STATES.IDLE) {
                console.log("[mascot] idle ended, switch to next idle video");
                setIdleVideoIndex((current) => (current + 1) % IDLE_VIDEO_SOURCES.length);
                return;
              }

              if (state === MASCOT_STATES.THANKS_FOR_LISTENING) {
                console.log("[mascot] thanks_for_listening ended, back to idle");
                setStatus("Idle");
                setActiveState(MASCOT_STATES.IDLE);
              }
            }}
          />
        ))}
      </div>
      <div className="logo">
        <img src="/image/logo metholatum.png" />
      </div>
      <div className="chat-history-container">
        <div className="chat-history" ref={historyRef}>
          {messages.map((message) => (
            <article key={message.id} className={`history-message ${message.role}`}>
              <p>{message.text}</p>
            </article>
          ))}
        </div>
      </div>
      {showAudioUnlock ? (
        <button type="button" className="audio-unlock-button" onClick={handleAudioUnlock}>
          Tap to enable voice
        </button>
      ) : null}
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => {
          console.log("[mascot] audio onPlay");
        }}
        onPlaying={() => {
          console.log("[mascot] audio onPlaying");
          if (pendingAssistantMessageRef.current) {
            showAssistantMessage(pendingAssistantMessageRef.current);
            pendingAssistantMessageRef.current = "";
          }
          setStatus("Speaking");
          setActiveState(MASCOT_STATES.SPEAKING);
        }}
        onEnded={() => {
          console.log("[mascot] audio onEnded");
          setStatus("Thanks for listening");
          setActiveState(MASCOT_STATES.THANKS_FOR_LISTENING);
        }}
        onError={(event) => {
          console.log("[mascot] audio onError", event);
          pendingAssistantMessageRef.current = "";
          pendingSpeechRef.current = "";
          setStatus("Audio stream failed");
          setActiveState(MASCOT_STATES.IDLE);
        }}
      />
    </main>
  );
}
