import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/queries/api";
import { getToken, TOKEN_ID } from "@/lib/queries/token";
import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

type Presence = "composing" | "paused";

type PresenceEvent = {
  instance?: string;
  data?: {
    id?: string;
    presences?: Record<string, { lastKnownPresence?: string }>;
  };
};

export function useChatPresence(instanceName?: string, token?: string, integration?: string, remoteJid?: string) {
  const [contactTyping, setContactTyping] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(0);
  const active = useRef(false);
  const requestQueue = useRef<Promise<unknown>>(Promise.resolve());
  const canSend = !!instanceName && !!token && !!remoteJid?.endsWith("@s.whatsapp.net") && integration === "WHATSAPP-BAILEYS";

  const sendPresence = useCallback(
    (presence: Presence) => {
      if (!canSend) return;
      requestQueue.current = requestQueue.current
        .catch(() => undefined)
        .then(() => api.post(`/chat/sendPresence/${instanceName}`, { number: remoteJid, presence, delay: 0 }, { headers: { apikey: token } }))
        .catch((error) => console.error("Failed to update typing presence:", error));
    },
    [canSend, instanceName, remoteJid, token],
  );

  const stopTyping = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    lastSent.current = 0;
    if (active.current) {
      active.current = false;
      sendPresence("paused");
    }
  }, [sendPresence]);

  const updateTyping = useCallback(
    (text: string) => {
      if (!canSend || !text.trim()) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (!active.current || now - lastSent.current >= 4000) {
        active.current = true;
        lastSent.current = now;
        sendPresence("composing");
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(stopTyping, 3000);
    },
    [canSend, sendPresence, stopTyping],
  );

  useEffect(() => () => stopTyping(), [stopTyping]);

  useEffect(() => {
    setContactTyping(false);
    if (incomingTimer.current) clearTimeout(incomingTimer.current);
    if (!instanceName || !token || !remoteJid?.endsWith("@s.whatsapp.net")) return;
    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) return;

    const socket = connectSocket(serverUrl, token, instanceName);
    const handlePresence = (event: PresenceEvent) => {
      if (event.instance !== instanceName || event.data?.id !== remoteJid) return;
      const composing = Object.values(event.data.presences || {}).some((presence) => presence.lastKnownPresence === "composing");
      setContactTyping(composing);
      if (incomingTimer.current) clearTimeout(incomingTimer.current);
      if (composing) incomingTimer.current = setTimeout(() => setContactTyping(false), 8000);
    };

    socket.on("presence.update", handlePresence);
    socket.connect();
    return () => {
      socket.off("presence.update");
      disconnectSocket(socket);
      if (incomingTimer.current) clearTimeout(incomingTimer.current);
    };
  }, [instanceName, token, remoteJid]);

  return { contactTyping, updateTyping, stopTyping };
}
