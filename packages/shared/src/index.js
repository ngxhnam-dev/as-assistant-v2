export const MASCOT_STATES = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  I_GOT_IT: "i_got_it",
  SPEAKING: "speaking",
  THANKS_FOR_LISTENING: "thanks_for_listening"
};

export const EVENTS = {
  USER_MESSAGE: "USER_MESSAGE",
  SET_LISTENING: "SET_LISTENING",
  SET_IDLE: "SET_IDLE",
  SET_THINKING: "SET_THINKING",
  SEND_RESPONSE: "SEND_RESPONSE",
  STOP_RESPONSE: "STOP_RESPONSE",
  HEARTBEAT: "HEARTBEAT"
};

export function createSessionId() {
  return `session-${createClientId()}`;
}

export function createClientId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10)
  ].join("-");
}
