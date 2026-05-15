export const MASCOT_STATES = {
  IDLE: "idle",
  THINKING: "thinking",
  SPEAKING: "speaking"
};

export const EVENTS = {
  USER_MESSAGE: "USER_MESSAGE",
  SET_THINKING: "SET_THINKING",
  SEND_RESPONSE: "SEND_RESPONSE",
  STOP_RESPONSE: "STOP_RESPONSE",
  HEARTBEAT: "HEARTBEAT"
};

export function createSessionId() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}
