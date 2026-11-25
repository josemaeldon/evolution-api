import { Send, User } from "lucide-react";
import { ReactNode, RefObject, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
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
import { useFindMessages } from "@/lib/queries/chat/findMessages";
import { useSendMessage, useSendMedia, useSendAudio } from "@/lib/queries/chat/sendMessage";
import { getToken, TOKEN_ID } from "@/lib/queries/token";

import { Message } from "@/types/evolution.types";

import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

// Import components from EmbedChatMessage for attachment functionality
import { MediaOptions } from "../EmbedChatMessage/InputMessage/media-options";
import { SelectedMedia } from "../EmbedChatMessage/InputMessage/selected-media";

type MessagesProps = {
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

function Messages({ headerNameOverride, headerActions, textareaRef, handleTextareaChange, textareaHeight, lastMessageRef, scrollToBottom }: MessagesProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { instance } = useInstance();
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [recordingActive, setRecordingActive] = useState(false);
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
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
    await sendAudioMutation({ instanceName: instance.name, token: instance.token, data: { number: remoteJid, audio: base64 } });
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
        },
      });

      // Clear the input after sending
      setMessageText("");
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

  const { data: messages, isSuccess } = useFindMessages({
    remoteJid,
    instanceName: instance?.name,
    refetchInterval: 5000,
  });

  // Combine React Query messages with real-time updates
  const allMessages = useMemo(() => {
    if (!messages) return realtimeMessages;

    // Merge messages from React Query with real-time updates
    const messageMap = new Map();

    // First add all messages from React Query
    messages.forEach((message) => messageMap.set(message.key.id, message));

    // Then add/update with real-time messages
    realtimeMessages.forEach((message) => {
      messageMap.set(message.key.id, message);
    });

    return Array.from(messageMap.values());
  }, [messages, realtimeMessages]);

  // Add websocket functionality for real-time message updates
  useEffect(() => {
    if (!instance?.name || !remoteJid) return;

    const serverUrl = getToken(TOKEN_ID.API_URL);
    if (!serverUrl) {
      console.error("API URL not found in localStorage");
      return;
    }

    const socket = connectSocket(serverUrl, instance.token);

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

  useEffect(() => {
    if (isSuccess && allMessages) {
      scrollToBottom();
    }
  }, [isSuccess, allMessages, scrollToBottom]);

  // Clear selected media and real-time messages when switching chats
  useEffect(() => {
    setSelectedMedia(null);
    setMessageText("");
    setRealtimeMessages([]); // Clear real-time messages when switching chats
    if (textareaRef.current) {
      textareaRef.current.value = "";
      handleTextareaChange();
    }
  }, [remoteJid]);

  const renderBubbleRight = (message: Message) => (
    <div key={message.id} className="mb-4 flex justify-end">
      <div className="max-w-[70%]">
        <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          <MessageContent message={message} instanceName={instance?.name} token={instance?.token} />
        </div>
        <span className="mt-0.5 block px-1 text-right text-[11px] text-muted-foreground">{formatMessageTime(getMessageTimestamp(message), locale)}</span>
      </div>
    </div>
  );

  const renderBubbleLeft = (message: Message) => {
    const isGroup = !!remoteJid?.endsWith("@g.us");
    const participant = message.key.participant;
    const senderKey = participant || message.pushName || "";
    const senderName = message.pushName || (participant ? participant.split("@")[0] : "");

    return (
      <div key={message.id} className="mb-4 flex justify-start">
        <div className="max-w-[70%]">
          {isGroup && senderName && (
            <div className="mb-1 text-xs font-semibold" style={{ color: getSenderColor(senderKey) }}>
              {senderName}
            </div>
          )}
          <div className="rounded-lg border bg-muted px-3 py-2 text-sm text-foreground">
            <MessageContent message={message} instanceName={instance?.name} token={instance?.token} />
          </div>
          <span className="mt-0.5 block px-1 text-[11px] text-muted-foreground">{formatMessageTime(getMessageTimestamp(message), locale)}</span>
        </div>
      </div>
    );
  };

  const headerName = headerNameOverride || chat?.pushName || chat?.remoteJid?.split("@")[0] || remoteJid?.split("@")[0];
  const headerSub = chat?.remoteJid?.split("@")[0];

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
        <div className="flex w-full flex-1 flex-col overflow-y-auto px-4 py-4">
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
    </ChatImageGallery>
  );
}

export { Messages };
