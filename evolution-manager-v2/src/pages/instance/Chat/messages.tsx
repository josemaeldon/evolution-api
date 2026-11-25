import { Copy, Forward, MoreHorizontal, Reply, Send, Trash2, User, X } from "lucide-react";
import { ReactNode, RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "react-toastify";

import { Avatar, AvatarFallback, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@evoapi/design-system/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChatImageGallery, ChatMessageImage } from "@/components/chat-image-lightbox";
import { ChatAudioMessage } from "@/components/chat-audio-message";
import { ChatDocumentMessage } from "@/components/chat-document-message";
import { ChatVideoMessage } from "@/components/chat-video-message";
import { ChatVoiceRecorder } from "@/components/chat-voice-recorder";
import { ChatInteractiveComposer } from "@/components/chat-interactive-composer";
import { ChatInteractiveMessage } from "@/components/chat-interactive-message";

import { useInstance } from "@/contexts/InstanceContext";

import { useFindChat } from "@/lib/queries/chat/findChat";
import { fetchMessagesPage } from "@/lib/queries/chat/findMessages";
import { useSendMessage, useSendMedia, useSendAudio } from "@/lib/queries/chat/sendMessage";
import { api } from "@/lib/queries/api";
import { getToken, TOKEN_ID } from "@/lib/queries/token";

import { Message, QuotedMessage } from "@/types/evolution.types";

import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

// Import components from EmbedChatMessage for attachment functionality
import { MediaOptions } from "../EmbedChatMessage/InputMessage/media-options";
import { SelectedMedia } from "../EmbedChatMessage/InputMessage/selected-media";

type MessagesProps = {
  contacts?: { remoteJid: string; pushName?: string; profilePicUrl?: string }[];
  headerNameOverride?: string;
  headerActions?: ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  handleTextareaChange: () => void;
  textareaHeight: string;
  lastMessageRef: RefObject<HTMLDivElement>;
  scrollToBottom: () => void;
};

// Utility function to format dates like WhatsApp
type TFn = (key: string, opts?: Record<string, unknown>) => string;

const formatDateSeparator = (date: Date, t: TFn, locale: string): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const messageDate = new Date(date);

  if (messageDate.toDateString() === today.toDateString()) {
    return t("chat.date.today", { defaultValue: "Hoje" });
  }

  if (messageDate.toDateString() === yesterday.toDateString()) {
    return t("chat.date.yesterday", { defaultValue: "Ontem" });
  }

  const daysDiff = Math.floor((today.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff < 7) {
    return messageDate.toLocaleDateString(locale, { weekday: "long" });
  }

  return messageDate.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

// Utility function to get timestamp from message
const getMessageTimestamp = (message: Message): Date => {
  try {
    if (!message.messageTimestamp) {
      return new Date();
    }

    // Handle case where timestamp is an object
    if (typeof message.messageTimestamp === "object") {
      const possibleTimestamps = [
        (message.messageTimestamp as any).low,
        (message.messageTimestamp as any).seconds,
        (message.messageTimestamp as any).timestamp,
        (message.messageTimestamp as any).time,
        (message.messageTimestamp as any).value,
      ];

      const timestamp = possibleTimestamps.find((val) => typeof val === "number" && !isNaN(val)) || Date.now() / 1000;

      return new Date(timestamp * 1000);
    }
    // Handle number or numeric string
    else if (!isNaN(Number(message.messageTimestamp))) {
      const timestamp = Number(message.messageTimestamp);

      // Check if it's milliseconds format (13 digits) or seconds format (10 digits)
      if (timestamp > 1000000000000) {
        return new Date(timestamp);
      } else {
        return new Date(timestamp * 1000);
      }
    }
    // If it's an ISO date string format
    else if (typeof message.messageTimestamp === "string" && message.messageTimestamp.includes("T")) {
      return new Date(message.messageTimestamp);
    }

    return new Date();
  } catch (error) {
    return new Date();
  }
};

// Component for date separator
const DateSeparator = ({ date }: { date: string }) => (
  <div className="flex items-center justify-center py-3">
    <div className="rounded-full bg-muted/50 px-3 py-1">
      <span className="text-xs font-medium text-muted-foreground">{date}</span>
    </div>
  </div>
);

const formatMessageTime = (date: Date, locale: string): string => date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

// WhatsApp-like deterministic color palette per sender
const SENDER_COLORS = ["#e91e63", "#9c27b0", "#3f51b5", "#2196f3", "#00bcd4", "#009688", "#4caf50", "#ff9800", "#f44336", "#795548"];

const getSenderColor = (key: string): string => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
};

// Helper function to extract text content from message
const getMessageText = (messageObj: any): string => {
  if (!messageObj) return "";

  // Try to parse if it's a string
  if (typeof messageObj === "string") {
    try {
      const parsed = JSON.parse(messageObj);
      return parsed.conversation || parsed.text || messageObj;
    } catch {
      return messageObj;
    }
  }

  // If it's already an object, extract conversation or text
  if (typeof messageObj === "object") {
    return messageObj.conversation || messageObj.text || "";
  }

  return String(messageObj);
};

const messageContent = (message: Message): Record<string, any> => {
  if (typeof message.message !== "string") return message.message || {};
  try { return JSON.parse(message.message); } catch { return { conversation: message.message }; }
};

const copyableMessageText = (message: Message): string => {
  const content = messageContent(message);
  const nested = content.viewOnceMessage?.message || content.viewOnceMessageV2?.message || content.ephemeralMessage?.message || content;
  const candidates = [
    getMessageText(nested), nested.extendedTextMessage?.text, nested.imageMessage?.caption,
    nested.videoMessage?.caption, nested.documentMessage?.caption, nested.documentMessage?.fileName,
    nested.documentWithCaptionMessage?.message?.documentMessage?.caption,
    nested.buttonsResponseMessage?.selectedDisplayText, nested.listResponseMessage?.title,
    nested.interactiveMessage?.body?.text, nested.listMessage?.description,
    nested.pollCreationMessage?.name, nested.pollCreationMessageV3?.name,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
};

const messagePreview = (message: Message): string => copyableMessageText(message) || ({
  imageMessage: "Imagem", videoMessage: "Vídeo", audioMessage: "Áudio",
  documentMessage: "Documento", stickerMessage: "Figurinha",
}[message.messageType] || "Mensagem");

const quotedMessage = (message: Message): QuotedMessage => ({ key: message.key, message: messageContent(message) });
const PAGE_SIZE = 30;

const quotedContentPreview = (message: Message): string | null => {
  const content = messageContent(message);
  const body = content.extendedTextMessage || content.imageMessage || content.videoMessage ||
    content.audioMessage || content.documentMessage || content.documentWithCaptionMessage?.message?.documentMessage;
  const quoted = message.contextInfo?.quotedMessage || content.contextInfo?.quotedMessage || body?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  const text = quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption || quoted.documentMessage?.caption || quoted.documentMessage?.fileName;
  return text || (quoted.imageMessage ? "Imagem" : quoted.videoMessage ? "Vídeo" :
    quoted.audioMessage ? "Áudio" : quoted.documentMessage ? "Documento" : "Mensagem");
};

const QuotedContent = ({ message }: { message: Message }) => {
  const preview = quotedContentPreview(message);
  if (!preview) return null;
  return <div className="mb-2 max-w-full truncate rounded border-l-2 border-current bg-black/10 px-2 py-1 text-xs opacity-80">{preview}</div>;
};

// Component to render different message types based on messageType
const MessageContent = ({ message, instanceName, token }: { message: Message; instanceName?: string; token?: string }) => {
  const messageType = message.messageType as string;

  switch (messageType) {
    case "conversation":
      if (message.message?.buttonsResponseMessage || message.message?.listResponseMessage || message.message?.pollCreationMessage || message.message?.pollCreationMessageV3 || message.message?.interactiveMessage || message.message?.listMessage) {
        return <ChatInteractiveMessage message={message} />;
      }
      if (message.message.contactMessage) {
        const contactMsg = message.message.contactMessage;
        return (
          <div className="p-3 bg-muted rounded-lg max-w-xs">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xl">👤</div>
              <span className="font-medium">Contact</span>
            </div>
            {contactMsg.displayName && <p className="text-sm font-medium">{contactMsg.displayName}</p>}
            {contactMsg.vcard && <p className="text-xs text-muted-foreground">Contact card</p>}
          </div>
        );
      }

      if (message.message.locationMessage) {
        const locationMsg = message.message.locationMessage;
        return (
          <div className="p-3 bg-muted rounded-lg max-w-xs">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xl">📍</div>
              <span className="font-medium">Location</span>
            </div>
            {locationMsg.name && <p className="text-sm font-medium">{locationMsg.name}</p>}
            {locationMsg.address && <p className="text-xs text-muted-foreground">{locationMsg.address}</p>}
            {locationMsg.degreesLatitude && locationMsg.degreesLongitude && (
              <a
                href={`https://maps.google.com/?q=${locationMsg.degreesLatitude},${locationMsg.degreesLongitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm mt-1 inline-block">
                View on Maps
              </a>
            )}
          </div>
        );
      }

      return <span>{getMessageText(message.message)}</span>;

    case "extendedTextMessage":
      return <span>{message.message.conversation ?? message.message.extendedTextMessage?.text}</span>;

    case "interactiveMessage":
    case "viewOnceMessage":
    case "viewOnceMessageV2":
    case "ephemeralMessage":
    case "deviceSentMessage":
    case "buttonsMessage":
    case "buttonsResponseMessage":
    case "templateButtonReplyMessage":
    case "listMessage":
    case "listResponseMessage":
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
    case "pollUpdateMessage":
    case "interactiveResponseMessage":
      return <ChatInteractiveMessage message={message} />;

    case "imageMessage":
      return (
        <div className="flex flex-col gap-2">
          <ChatMessageImage
            message={message}
            instanceName={instanceName}
            token={token}
            className="rounded-lg max-w-full h-auto"
            style={{ maxWidth: "400px", maxHeight: "400px", objectFit: "contain" }}
          />
          {message.message.imageMessage?.caption && <p className="text-sm">{message.message.imageMessage.caption}</p>}
        </div>
      );

    case "videoMessage":
      return (
        <div className="flex flex-col gap-2">
          <ChatVideoMessage message={message} instanceName={instanceName} token={token} />
          {message.message.videoMessage?.caption && <p className="text-sm">{message.message.videoMessage.caption}</p>}
        </div>
      );

    case "audioMessage":
      return <ChatAudioMessage message={message} instanceName={instanceName} token={token} />;

    case "documentMessage":
    case "documentWithCaptionMessage":
      return (
        <div className="flex flex-col gap-2">
          <ChatDocumentMessage message={message} instanceName={instanceName} token={token} />
          {message.message.documentWithCaptionMessage?.message?.documentMessage?.caption && <p className="text-sm">{message.message.documentWithCaptionMessage.message.documentMessage.caption}</p>}
        </div>
      );

    case "stickerMessage":
      return <ChatMessageImage message={message} instanceName={instanceName} token={token} className="max-w-32 max-h-32 object-contain" />;

    default:
      // Fallback for unknown message types
      return (
        <div className="text-xs text-muted-foreground bg-muted p-2 rounded max-w-xs">
          <details>
            <summary>Unknown message type: {messageType}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(message.message, null, 2)}</pre>
          </details>
        </div>
      );
  }
};

const DeferredMessageContent = ({ message, instanceName, token }: { message: Message; instanceName?: string; token?: string }) => {
  const mediaTypes = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "documentWithCaptionMessage", "stickerMessage"];
  const isMedia = mediaTypes.includes(message.messageType);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isMedia || visible) return;
    const element = containerRef.current;
    if (!element || !window.IntersectionObserver) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isMedia, visible]);

  if (!isMedia) return <MessageContent message={message} instanceName={instanceName} token={token} />;
  return <div ref={containerRef} className={visible ? undefined : "min-h-20 min-w-32"}>
    {visible ? <MessageContent message={message} instanceName={instanceName} token={token} /> :
      <span className="text-xs text-muted-foreground">{messagePreview(message)}</span>}
  </div>;
};

function Messages({ contacts = [], headerNameOverride, headerActions, textareaRef, handleTextareaChange, textareaHeight, lastMessageRef, scrollToBottom }: MessagesProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = i18n.language;
  const { instance } = useInstance();
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [recordingActive, setRecordingActive] = useState(false);
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardSource, setForwardSource] = useState<Message | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardSelectedJid, setForwardSelectedJid] = useState("");
  const [forwarding, setForwarding] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [olderPages, setOlderPages] = useState<Message[][]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef<{ height: number; top: number; expectedPages: number } | null>(null);
  const initialScrollDoneRef = useRef(false);
  const nearBottomRef = useRef(true);
  const { sendText: sendTextMutation } = useSendMessage();
  const { sendMedia: sendMediaMutation } = useSendMedia();
  const { sendAudio: sendAudioMutation } = useSendAudio();

  const { remoteJid } = useParams<{ remoteJid: string }>();

  useEffect(() => setRecordingActive(false), [remoteJid]);

  const sendRecording = async (audio: Blob) => {
    if (!remoteJid || !instance?.name || !instance?.token) throw new Error("Instância indisponível");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(audio);
    });
    await sendAudioMutation({ instanceName: instance.name, token: instance.token, data: { number: remoteJid, audio: base64, ...(replyTo && { quoted: quotedMessage(replyTo) }) } });
    setReplyTo(null);
  };

  // Handle sending text messages
  const sendTextMessage = async () => {
    if (!messageText.trim() || !remoteJid || !instance?.name || !instance?.token || isSending) return;

    try {
      setIsSending(true);
      await sendTextMutation({
        instanceName: instance.name,
        token: instance.token,
        data: {
          number: remoteJid,
          text: messageText.trim(),
          ...(replyTo && { quoted: quotedMessage(replyTo) }),
        },
      });

      // Clear the input after sending
      setMessageText("");
      setReplyTo(null);
      if (textareaRef.current) {
        textareaRef.current.value = "";
        handleTextareaChange(); // Reset height
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsSending(false);
    }
  };

  // Handle sending media messages
  const sendMediaMessage = async () => {
    if (!selectedMedia || !remoteJid || !instance?.name || !instance?.token || isSending) return;

    try {
      setIsSending(true);

      // Convert media to base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(selectedMedia);
        reader.onload = () => {
          const base64 = reader.result as string;
          // Strip the data URI prefix (data:image/xyz;base64,)
          const base64Data = base64.split(",")[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
      });

      await sendMediaMutation({
        instanceName: instance.name,
        token: instance.token,
        data: {
          number: remoteJid,
          ...(replyTo && { quoted: quotedMessage(replyTo) }),
          mediaMessage: {
            mediatype: selectedMedia.type.split("/")[0] === "application" ? "document" : (selectedMedia.type.split("/")[0] as "audio" | "video" | "image" | "document"),
            mimetype: selectedMedia.type,
            caption: messageText.trim(),
            media: base64Data,
            fileName: selectedMedia.name,
          },
        },
      });

      // Clear the input and media after sending
      setSelectedMedia(null);
      setMessageText("");
      setReplyTo(null);
      if (textareaRef.current) {
        textareaRef.current.value = "";
        handleTextareaChange(); // Reset height
      }
    } catch (error) {
      console.error("Error sending media:", error);
    } finally {
      setIsSending(false);
    }
  };

  // Handle message sending (decides between text or media)
  const sendMessage = async () => {
    if (selectedMedia) {
      await sendMediaMessage();
    } else {
      await sendTextMessage();
    }
  };

  // Handle Enter key press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
    handleTextareaChange();
  };
  const { data: chat } = useFindChat({
    remoteJid,
    instanceName: instance?.name,
  });

  const { data: messagePage } = useQuery<{ records: Message[]; pages: number }>({
    queryKey: ["chats", "findMessages", instance?.name, remoteJid, PAGE_SIZE],
    queryFn: () => fetchMessagesPage({ instanceName: instance!.name, remoteJid: remoteJid!, offset: PAGE_SIZE, page: 1 }),
    enabled: !!instance?.name && !!remoteJid,
    refetchInterval: 5000,
  });
  const messages = messagePage?.records;
  const hasOlder = (messagePage?.pages || 0) > olderPages.length + 1;

  const loadOlder = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container || !hasOlder || loadingOlderRef.current || !instance?.name || !remoteJid) return;
    loadingOlderRef.current = true;
    restoreScrollRef.current = { height: container.scrollHeight, top: container.scrollTop, expectedPages: olderPages.length + 1 };
    setLoadingOlder(true);
    try {
      const page = await fetchMessagesPage({ instanceName: instance.name, remoteJid, offset: PAGE_SIZE, page: olderPages.length + 2 });
      setOlderPages((current) => [...current, page.records]);
    } catch (error) {
      restoreScrollRef.current = null;
      toast.error("Não foi possível carregar mensagens anteriores");
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasOlder, instance?.name, remoteJid, olderPages.length]);

  const handleHistoryScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    nearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (container.scrollTop < 250) loadOlder();
  };

  // Combine React Query messages with real-time updates
  const allMessages = useMemo(() => {
    if (!messages) return realtimeMessages;

    // Merge messages from React Query with real-time updates
    const messageMap = new Map();

    // First add all messages from React Query
    olderPages.flat().forEach((message) => messageMap.set(message.key.id, message));
    messages.forEach((message) => messageMap.set(message.key.id, message));

    // Then add/update with real-time messages
    realtimeMessages.forEach((message) => {
      messageMap.set(message.key.id, message);
    });

    return Array.from(messageMap.values()).filter((message: Message) =>
      !removedIds.has(message.key.id) && !message.key.deleted && message.status !== "DELETED");
  }, [messages, olderPages, realtimeMessages, removedIds]);

  // Add websocket functionality for real-time message updates
  useEffect(() => {
    if (!instance?.name || !remoteJid) return;

    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) {
      console.error("API URL not found in localStorage");
      return;
    }

    const socket = connectSocket(serverUrl, instance.token, instance.name);

    // Function to update messages from websocket events
    const updateMessagesFromWebsocket = (_eventType: string, data: any) => {
      if (!instance) return;

      if (data.instance !== instance.name) {
        return;
      }

      if (data?.data?.key?.remoteJid !== remoteJid) {
        return;
      }

      const message = data.data;

      setRealtimeMessages((prevMessages) => {
        // Check if message already exists
        const existingIndex = prevMessages.findIndex((msg) => msg.key.id === message.key.id);

        if (existingIndex !== -1) {
          // Update existing message
          const updatedMessages = [...prevMessages];
          updatedMessages[existingIndex] = message;
          return updatedMessages;
        } else {
          // Add new message
          return [...prevMessages, message];
        }
      });
    };

    // Function to update message status (simplified - just log for now)
    const updateMessageStatus = (data: any) => {
      if (!instance) return;
      if (data.instance !== instance.name) return;

      console.log("Received message status update:", data);
      // TODO: Implement proper message status updates when Message type supports it
    };

    // Set up event listeners
    socket.on("messages.upsert", (data: any) => {
      updateMessagesFromWebsocket("messages.upsert", data);
    });

    socket.on("send.message", (data: any) => {
      updateMessagesFromWebsocket("send.message", data);
    });

    socket.on("messages.update", (data: any) => {
      updateMessageStatus(data);
    });

    socket.connect();

    // Cleanup function
    return () => {
      socket.off("messages.upsert");
      socket.off("send.message");
      socket.off("messages.update");
      disconnectSocket(socket);
    };
  }, [instance?.name, remoteJid]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    if (!allMessages) return [];

    // Sort messages by timestamp first
    const sortedMessages = [...allMessages].sort((a, b) => {
      const aTime = getMessageTimestamp(a).getTime();
      const bTime = getMessageTimestamp(b).getTime();
      return aTime - bTime;
    });

    const grouped: { date: string; messages: Message[] }[] = [];
    let currentDate = "";
    let currentGroup: Message[] = [];

    sortedMessages.forEach((message) => {
      const messageDate = getMessageTimestamp(message);
      const dateString = messageDate.toDateString();

      if (dateString !== currentDate) {
        if (currentGroup.length > 0) {
          grouped.push({
            date: formatDateSeparator(new Date(currentDate), t, locale),
            messages: currentGroup,
          });
        }
        currentDate = dateString;
        currentGroup = [message];
      } else {
        currentGroup.push(message);
      }
    });

    if (currentGroup.length > 0) {
      grouped.push({
        date: formatDateSeparator(new Date(currentDate), t, locale),
        messages: currentGroup,
      });
    }

    return grouped;
  }, [allMessages, t, locale]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !messages) return;
    if (restoreScrollRef.current) {
      const { height, top, expectedPages } = restoreScrollRef.current;
      if (olderPages.length < expectedPages) return;
      container.scrollTop = top + container.scrollHeight - height;
      restoreScrollRef.current = null;
    } else if (!initialScrollDoneRef.current || nearBottomRef.current) {
      scrollToBottom();
      initialScrollDoneRef.current = true;
    }
    if (container.scrollHeight <= container.clientHeight + 100 && hasOlder && !loadingOlder) loadOlder();
  }, [allMessages, messages, scrollToBottom, hasOlder, loadingOlder, loadOlder, olderPages.length]);

  // Clear selected media and real-time messages when switching chats
  useEffect(() => {
    setSelectedMedia(null);
    setMessageText("");
    setReplyTo(null);
    setForwardSource(null);
    setRemovedIds(new Set());
    setRealtimeMessages([]); // Clear real-time messages when switching chats
    setOlderPages([]);
    loadingOlderRef.current = false;
    restoreScrollRef.current = null;
    initialScrollDoneRef.current = false;
    nearBottomRef.current = true;
    if (textareaRef.current) {
      textareaRef.current.value = "";
      handleTextareaChange();
    }
  }, [remoteJid]);

  const copyMessage = async (message: Message) => {
    const text = copyableMessageText(message);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) { toast.error("Não foi possível copiar a mensagem"); return; }
    }
    toast.success("Mensagem copiada");
  };

  const deleteForEveryone = async (message: Message) => {
    if (!instance?.name || !instance?.token || !remoteJid || deletingId || !message.key.fromMe || instance.integration !== "WHATSAPP-BAILEYS") return;
    if (!window.confirm("Excluir esta mensagem para todos?")) return;
    try {
      setDeletingId(message.key.id);
      await api.delete(`/chat/deleteMessageForEveryone/${instance.name}`, {
        data: { id: message.key.id, fromMe: true, remoteJid, ...(message.key.participant && { participant: message.key.participant }) },
        headers: { apikey: instance.token },
      });
      setRemovedIds((current) => new Set(current).add(message.key.id));
      await queryClient.invalidateQueries({ queryKey: ["chats", "findMessages"] });
      toast.success("Mensagem excluída para todos");
    } catch (error) {
      console.error("Error deleting message:", error);
      toast.error("Não foi possível excluir a mensagem para todos");
    } finally {
      setDeletingId("");
    }
  };

  const sendForward = async () => {
    if (!forwardSource || !instance?.name || !instance?.token || forwarding) return;
    const number = (forwardSelectedJid || forwardSearch).replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(number)) return;
    try {
      setForwarding(true);
      await api.post(`/chat/forwardMessage/${instance.name}`, {
        id: forwardSource.key.id,
        remoteJid: forwardSource.key.remoteJid,
        number,
      }, { headers: { apikey: instance.token } });
      setForwardSource(null);
      await queryClient.invalidateQueries({ queryKey: ["chats", "findChats"] });
      toast.success("Mensagem encaminhada");
    } catch (error) {
      console.error("Error forwarding message:", error);
      toast.error("Não foi possível encaminhar a mensagem");
    } finally {
      setForwarding(false);
    }
  };

  const messageActions = (message: Message) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Ações da mensagem">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={message.key.fromMe ? "end" : "start"}>
        <DropdownMenuItem onClick={() => { setReplyTo(message); textareaRef.current?.focus(); }}>
          <Reply className="mr-2 h-4 w-4" /> Responder
        </DropdownMenuItem>
        <DropdownMenuItem disabled={instance?.integration !== "WHATSAPP-BAILEYS"} onClick={() => {
          setForwardSearch("");
          setForwardSelectedJid("");
          setForwardSource(message);
        }}>
          <Forward className="mr-2 h-4 w-4" /> Encaminhar
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!copyableMessageText(message)} onClick={() => copyMessage(message)}>
          <Copy className="mr-2 h-4 w-4" /> Copiar
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!message.key.fromMe || instance?.integration !== "WHATSAPP-BAILEYS" || !!deletingId}
          className="text-destructive"
          onClick={() => deleteForEveryone(message)}>
          <Trash2 className="mr-2 h-4 w-4" /> Excluir para todos
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderBubbleRight = (message: Message) => (
    <div key={message.key.id} className="mb-4 flex justify-end">
      <div className="flex max-w-[85%] items-start gap-1">
        {messageActions(message)}
        <div className="min-w-0">
          <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
            <QuotedContent message={message} />
            <DeferredMessageContent message={message} instanceName={instance?.name} token={instance?.token} />
          </div>
          <span className="mt-0.5 block px-1 text-right text-[11px] text-muted-foreground">{formatMessageTime(getMessageTimestamp(message), locale)}</span>
        </div>
      </div>
    </div>
  );

  const renderBubbleLeft = (message: Message) => {
    const isGroup = !!remoteJid?.endsWith("@g.us");
    const participant = message.key.participant;
    const senderKey = participant || message.pushName || "";
    const senderName = message.pushName || (participant ? participant.split("@")[0] : "");

    return (
      <div key={message.key.id} className="mb-4 flex justify-start">
        <div className="flex max-w-[85%] items-start gap-1">
          <div className="min-w-0">
          {isGroup && senderName && (
            <div className="mb-1 text-xs font-semibold" style={{ color: getSenderColor(senderKey) }}>
              {senderName}
            </div>
          )}
          <div className="rounded-lg border bg-muted px-3 py-2 text-sm text-foreground">
            <QuotedContent message={message} />
            <DeferredMessageContent message={message} instanceName={instance?.name} token={instance?.token} />
          </div>
          <span className="mt-0.5 block px-1 text-[11px] text-muted-foreground">{formatMessageTime(getMessageTimestamp(message), locale)}</span>
          </div>
          {messageActions(message)}
        </div>
      </div>
    );
  };

  const headerName = headerNameOverride || chat?.pushName || chat?.remoteJid?.split("@")[0] || remoteJid?.split("@")[0];
  const headerSub = chat?.remoteJid?.split("@")[0];
  const forwardQuery = forwardSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const forwardDigits = forwardSearch.replace(/\D/g, "");
  const forwardContacts = contacts.filter((contact) => contact.remoteJid.endsWith("@s.whatsapp.net") &&
    (!forwardQuery ||
      (contact.pushName || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(forwardQuery) ||
      (forwardDigits.length > 0 && contact.remoteJid.includes(forwardDigits))));
  const selectedForwardNumber = (forwardSelectedJid || forwardSearch).replace(/\D/g, "");

  return (
    <ChatImageGallery key={remoteJid} messages={groupedMessages.flatMap((group) => group.messages)}>
      <div className="flex h-full flex-col bg-muted/10">
        <div className="flex-shrink-0 border-b bg-background/95 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={chat?.profilePicUrl} alt={headerName} />
              <AvatarFallback className="bg-muted text-muted-foreground">
                <User className="h-5 w-5" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold">{headerName}</h3>
              <p className="truncate text-xs text-muted-foreground">{headerSub}</p>
            </div>
            {headerActions}
          </div>
        </div>
        <div ref={scrollContainerRef} onScroll={handleHistoryScroll} className="flex w-full flex-1 flex-col overflow-y-auto px-4 py-4">
          {loadingOlder && <p className="py-2 text-center text-xs text-muted-foreground">Carregando mensagens anteriores...</p>}
          {hasOlder && !loadingOlder && <button type="button" className="py-2 text-center text-xs text-primary hover:underline" onClick={loadOlder}>Carregar mensagens anteriores</button>}
          {groupedMessages.map((group, groupIndex) => (
            <div key={groupIndex}>
              <DateSeparator date={group.date} />
              {group.messages.map((message) => (message.key.fromMe ? renderBubbleRight(message) : renderBubbleLeft(message)))}
            </div>
          ))}
          <div ref={lastMessageRef as never} />
        </div>
        <div className="flex-shrink-0 border-t bg-background p-3">
          <div className="rounded-lg border border-border bg-card shadow-sm">
            {replyTo && <div className="flex items-start gap-2 border-b border-border bg-muted/30 px-3 py-2">
              <Reply className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">Respondendo a {replyTo.key.fromMe ? "você" : replyTo.pushName || headerName}</p>
                <p className="truncate text-xs text-muted-foreground">{messagePreview(replyTo)}</p>
              </div>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Cancelar resposta" onClick={() => setReplyTo(null)}><X className="h-4 w-4" /></Button>
            </div>}
            {selectedMedia && (
              <div className="border-b border-border bg-muted/30 px-3 py-2">
                <SelectedMedia selectedMedia={selectedMedia} setSelectedMedia={setSelectedMedia} />
              </div>
            )}
            <div className="flex items-center gap-2 px-2 py-1.5">
              {!recordingActive && <div className="flex flex-shrink-0 items-center">{instance && <MediaOptions instance={instance} setSelectedMedia={setSelectedMedia} />}</div>}
              {!recordingActive && instance?.token && remoteJid && <ChatInteractiveComposer key={remoteJid} instanceName={instance.name} token={instance.token} integration={instance.integration} remoteJid={remoteJid} recipientName={instance.profileName} />}
              {!recordingActive && <Textarea
                placeholder={t("chat.input.placeholder", { defaultValue: "Digite uma mensagem..." })}
                name="message"
                id="message"
                rows={1}
                ref={textareaRef}
                value={messageText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isSending}
                style={{ height: textareaHeight }}
                className="min-h-9 flex-1 resize-none border-none bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />}
              {!messageText.trim() && !selectedMedia && (
                <ChatVoiceRecorder key={remoteJid} disabled={isSending || !instance?.token || !remoteJid} onActiveChange={setRecordingActive} onSend={sendRecording} />
              )}
              {!recordingActive && (messageText.trim() || selectedMedia) && <Button
                type="button"
                size="icon"
                onClick={sendMessage}
                disabled={(!messageText.trim() && !selectedMedia) || isSending}
                className="h-9 w-9 flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-50">
                <Send className="h-4 w-4" />
                <span className="sr-only">{t("chat.input.send")}</span>
              </Button>}
            </div>
          </div>
        </div>
      </div>
      <Dialog open={!!forwardSource} onOpenChange={(open) => { if (!open && !forwarding) setForwardSource(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription className="truncate">{forwardSource && messagePreview(forwardSource)}</DialogDescription>
          <Input
            type="search"
            aria-label="Pesquisar destino"
            placeholder="Nome ou número com DDI e DDD"
            value={forwardSearch}
            onChange={(event) => { setForwardSearch(event.target.value); setForwardSelectedJid(""); }}
          />
          <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
            {forwardContacts.map((contact) => (
              <button key={contact.remoteJid} type="button"
                className={`flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent ${forwardSelectedJid === contact.remoteJid ? "bg-accent" : ""}`}
                onClick={() => setForwardSelectedJid(contact.remoteJid)}>
                <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={contact.profilePicUrl} alt={contact.pushName || contact.remoteJid} /><AvatarFallback><User className="h-4 w-4" /></AvatarFallback></Avatar>
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{contact.pushName || contact.remoteJid.split("@")[0]}</span><span className="block text-xs text-muted-foreground">{contact.remoteJid.split("@")[0]}</span></span>
              </button>
            ))}
            {forwardContacts.length === 0 && <p className="py-3 text-center text-sm text-muted-foreground">Nenhum contato encontrado. Você pode digitar um número.</p>}
          </div>
          <Button type="button" disabled={!/^\d{8,15}$/.test(selectedForwardNumber) || forwarding} onClick={sendForward}>
            {forwarding ? "Encaminhando..." : "Encaminhar"}
          </Button>
        </DialogContent>
      </Dialog>
    </ChatImageGallery>
  );
}

export { Messages };
