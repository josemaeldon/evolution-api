import { io, Socket } from "socket.io-client";
import { getToken, TOKEN_ID } from "@/lib/queries/token";

type SocketEntry = { socket: Socket; users: number };
const activeSockets = new Map<string, SocketEntry>();
const unavailableSockets = new Set<string>();
const managerTicketRequests = new Map<string, Promise<string>>();
const managerTicketRetries = new Set<string>();

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
  const managerSessionOnly = companyMode && apiKey === "manager-session";
  // Company manager sessions authenticate with an HttpOnly cookie scoped to
  // the manager origin. Use that origin so the browser includes the cookie.
  const socketUrl = companyMode ? window.location.origin : serverUrl;
  const key = `${socketUrl}\0${apiKey}\0${instanceName || ""}`;
  let socket: Socket;
  const prepareConnection = managerSessionOnly ? async () => {
    let request = managerTicketRequests.get(key);
    if (!request) {
      request = fetch(`${socketUrl}/saas/socket-ticket?instanceName=${encodeURIComponent(instanceName || "")}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Manager socket ticket request failed (${response.status})`);
          const body = (await response.json()) as { ticket?: string };
          if (!body.ticket) throw new Error("Manager socket ticket missing");
          return body.ticket;
        })
        .finally(() => managerTicketRequests.delete(key));
      managerTicketRequests.set(key, request);
    }
    const ticket = await request;
    socket.io.opts.query = { instanceName, ticket };
  } : undefined;
  const existing = activeSockets.get(key);
  if (existing) {
    existing.users += 1;
    socket = existing.socket;
    return createSocketWrapper(socket, key, prepareConnection);
  }

  // Create new socket connection
  socket = io(socketUrl, {
    // HTTP long polling also works behind proxies that do not forward WebSocket upgrades.
    transports: ["polling"],
    // Keep the manager session as the primary auth, and include the scoped
    // instance key as a fallback when a reverse proxy drops session cookies.
    query: companyMode
      ? { instanceName, ...(!managerSessionOnly && apiKey ? { apikey: apiKey } : {}) }
      : { apikey: apiKey },
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
    console.log(`✅ WebSocket connected to ${socketUrl}`);
    if (prepareConnection) void prepareConnection().catch((error) => console.error("Could not refresh manager socket ticket:", error));
  });

  socket.on("disconnect", (reason) => {
    console.log(`❌ WebSocket disconnected from ${socketUrl}:`, reason);
  });

  socket.on("connect_error", (error) => {
    const context = (error as Error & { context?: { status?: number; target?: { status?: number } } }).context;
    const status = context?.status ?? context?.target?.status;
    if (status === 404 || status === 403 || status === 401) {
      if (managerSessionOnly && status === 403 && !managerTicketRetries.has(key)) {
        managerTicketRetries.add(key);
        socket.io.opts.reconnection = false;
        socket.disconnect();
        void prepareConnection!()
          .then(() => {
            managerTicketRetries.delete(key);
            if (activeSockets.get(key)?.socket === socket) {
              socket.io.opts.reconnection = true;
              socket.connect();
            }
          })
          .catch((ticketError) => {
            managerTicketRetries.delete(key);
            unavailableSockets.add(key);
            console.error("Could not refresh manager socket ticket after rejection:", ticketError);
          });
        return;
      }
      // A disabled Socket.IO endpoint or rejected key will not recover by retrying.
      unavailableSockets.add(key);
      socket.io.opts.reconnection = false;
      socket.disconnect();
      console.warn(`Socket.IO indisponível em ${socketUrl} (HTTP ${status}); usando atualização periódica.`);
      return;
    }
    console.error(`🚫 WebSocket connection error to ${socketUrl}:`, error);
  });

  socket.on("reconnect", (attemptNumber) => {
    console.log(`🔄 WebSocket reconnected to ${socketUrl} after ${attemptNumber} attempts`);
  });

  socket.on("reconnect_error", (error) => {
    console.error(`🔄❌ WebSocket reconnection error to ${socketUrl}:`, error);
  });

  return createSocketWrapper(socket, key, prepareConnection);
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
const createSocketWrapper = (socket: Socket, key: string, prepareConnection?: () => Promise<void>): WebSocketConnection => {
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
      if (unavailableSockets.has(key) || activeSockets.get(key)?.socket !== socket || socket.connected) return;
      if (prepareConnection) {
        void prepareConnection()
          .then(() => {
            if (!unavailableSockets.has(key) && activeSockets.get(key)?.socket === socket && !socket.connected) socket.connect();
          })
          .catch((error) => {
            console.error("Could not authorize manager Socket.IO connection:", error);
          });
        return;
      }
      socket.connect();
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
