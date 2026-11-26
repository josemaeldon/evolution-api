import { io, Socket } from "socket.io-client";
import { getToken, TOKEN_ID } from "@/lib/queries/token";

type SocketEntry = { socket: Socket; users: number };
const activeSockets = new Map<string, SocketEntry>();
const unavailableSockets = new Set<string>();

export interface WebSocketConnection {
  _socket?: Socket;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string) => void;
  connect: () => void;
  disconnect: () => void;
}

export const connectSocket = (serverUrl: string, token?: string, instanceName?: string): WebSocketConnection => {
  const apiKey = token || getToken(TOKEN_ID.INSTANCE_TOKEN) || getToken(TOKEN_ID.TOKEN) || "";
  const companyMode = localStorage.getItem("managerSaas") === "company";
  const key = `${serverUrl}\0${apiKey}\0${instanceName || ""}`;
  const existing = activeSockets.get(key);
  if (existing) {
    existing.users += 1;
    return createSocketWrapper(existing.socket, key);
  }

  // Create new socket connection
  const socket = io(serverUrl, {
    // HTTP long polling also works behind proxies that do not forward WebSocket upgrades.
    transports: ["polling"],
    query: companyMode ? { instanceName } : { apikey: apiKey },
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 2,
    reconnectionDelay: 1000,
    timeout: 20000,
  });

  // Store socket
  activeSockets.set(key, { socket, users: 1 });

  // Set up connection event handlers
  socket.on("connect", () => {
    console.log(`✅ WebSocket connected to ${serverUrl}`);
  });

  socket.on("disconnect", (reason) => {
    console.log(`❌ WebSocket disconnected from ${serverUrl}:`, reason);
  });

  socket.on("connect_error", (error) => {
    const context = (error as Error & { context?: { status?: number; target?: { status?: number } } }).context;
    const status = context?.status ?? context?.target?.status;
    if (status === 404 || status === 403 || status === 401) {
      // A disabled Socket.IO endpoint or rejected key will not recover by retrying.
      unavailableSockets.add(key);
      socket.io.opts.reconnection = false;
      socket.disconnect();
      console.warn(`Socket.IO indisponível em ${serverUrl} (HTTP ${status}); usando atualização periódica.`);
      return;
    }
    console.error(`🚫 WebSocket connection error to ${serverUrl}:`, error);
  });

  socket.on("reconnect", (attemptNumber) => {
    console.log(`🔄 WebSocket reconnected to ${serverUrl} after ${attemptNumber} attempts`);
  });

  socket.on("reconnect_error", (error) => {
    console.error(`🔄❌ WebSocket reconnection error to ${serverUrl}:`, error);
  });

  return createSocketWrapper(socket, key);
};

export const disconnectSocket = (connection: WebSocketConnection | Socket): void => {
  for (const [key, entry] of activeSockets.entries()) {
    if (entry.socket === connection || (connection as WebSocketConnection & { _socket?: Socket })._socket === entry.socket) {
      entry.users -= 1;
      if (entry.users === 0) {
        entry.socket.disconnect();
        activeSockets.delete(key);
      }
      break;
    }
  }
};

// Create a wrapper that provides a consistent interface
const createSocketWrapper = (socket: Socket, key: string): WebSocketConnection => {
  const listeners = new Map<string, Set<(data: any) => void>>();
  return {
    _socket: socket,
    on: (event: string, callback: (data: any) => void) => {
      socket.on(event, callback);
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
    },
    off: (event: string) => {
      listeners.get(event)?.forEach((callback) => socket.off(event, callback));
      listeners.delete(event);
    },
    connect: () => {
      if (!unavailableSockets.has(key) && activeSockets.get(key)?.socket === socket && !socket.connected) socket.connect();
    },
    disconnect: () => {
      socket.disconnect();
    },
  };
};

// Cleanup function to disconnect all sockets
export const disconnectAllSockets = (): void => {
  console.log("🧹 Disconnecting all websockets...");
  for (const [, entry] of activeSockets.entries()) {
    entry.socket.disconnect();
  }
  activeSockets.clear();
};

// Export for debugging
export const getActiveSockets = () => activeSockets;
