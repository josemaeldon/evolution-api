import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/queries/api";
import { getToken, TOKEN_ID } from "@/lib/queries/token";
import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

type Presence = "composing" | "paused";

type PresenceEvent = {
  instance?: string;
  data?: {
    id?: string;
    idAlt?: string | null;
    presences?: Record<string, { lastKnownPresence?: string } | string>;
  };
};

const normalizeJid = (jid?: string | null) => jid?.replace(/:\d+/, "").trim().toLowerCase();

export function useChatPresence(instanceName?: string, token?: string, integration?: string, remoteJid?: string) {
  const [contactTyping, setContactTyping] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(0);
  const active = useRef(false);
  const requestQueue = useRef<Promise<unknown>>(Promise.resolve());
  const isDirectChat = ["@s.whatsapp.net", "@c.us", "@lid"].some((jidType) => remoteJid?.endsWith(jidType));
  const canSend = !!instanceName && !!token && isDirectChat && integration === "WHATSAPP-BAILEYS";

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
    if (!canSend) return;
    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) return;

    const socket = connectSocket(serverUrl, token, instanceName);
    const handlePresence = (event: PresenceEvent) => {
      const data = event.data;
      const selectedJid = normalizeJid(remoteJid);
      const presenceJids = [normalizeJid(data?.id), normalizeJid(data?.idAlt)];
      if (event.instance !== instanceName || !data || !selectedJid || !presenceJids.includes(selectedJid)) return;

      const active = Object.values(data.presences || {}).some((presence) => {
        const state = typeof presence === "string" ? presence : presence?.lastKnownPresence;
        return state === "composing" || state === "recording";
      });
      setContactTyping(active);
      if (incomingTimer.current) clearTimeout(incomingTimer.current);
      if (active) incomingTimer.current = setTimeout(() => setContactTyping(false), 8000);
    };

    const subscribe = () => {
      api.post(`/chat/subscribePresence/${instanceName}`, { number: remoteJid }, { headers: { apikey: token } })
        .catch((error) => console.error("Failed to subscribe to typing presence:", error));
    };

    socket.on("presence.update", handlePresence);
    socket.on("connect", subscribe);
    socket.connect();
    const refresh = setInterval(subscribe, 60_000);
    return () => {
      clearInterval(refresh);
      socket.off("presence.update");
      socket.off("connect");
      disconnectSocket(socket);
      if (incomingTimer.current) clearTimeout(incomingTimer.current);
    };
  }, [canSend, instanceName, token, remoteJid]);

  return { contactTyping, updateTyping, stopTyping };
}
