import "./style.css";
import { Bold, Braces, Code2, Copy, Forward, Italic, List, ListOrdered, MoreHorizontal, Quote, Reply, Send, Strikethrough, Trash2, Upload, User, X } from "lucide-react";
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
import { ChatEmojiPicker } from "@/components/chat-emoji-picker";
import { ChatContactMessage } from "@/components/chat-contact-message";

import { useInstance } from "@/contexts/InstanceContext";

import { useFindChat } from "@/lib/queries/chat/findChat";
import { fetchMessagesPage } from "@/lib/queries/chat/findMessages";
import { useSendMessage, useSendMedia, useSendAudio } from "@/lib/queries/chat/sendMessage";
import { api } from "@/lib/queries/api";
import { getToken, TOKEN_ID } from "@/lib/queries/token";
import { useManagerAccount } from "@/lib/queries/saas";

import { Message, QuotedMessage } from "@/types/evolution.types";

import { connectSocket, disconnectSocket } from "@/services/websocket/socket";

// Import components from EmbedChatMessage for attachment functionality
import { MediaOptions, validateChatAttachment } from "../EmbedChatMessage/InputMessage/media-options";
import { SelectedMedia } from "../EmbedChatMessage/InputMessage/selected-media";
import { useChatPresence } from "./use-chat-presence";

type MessagesProps = {
  contacts?: { remoteJid: string; pushName?: string; customName?: string; profilePicUrl?: string }[];
  contactVariables?: { name: string; phone: string; birthDate: string; anniversary: string; age: string; labels: string };
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

const WHATSAPP_FORMAT_MARKERS = ["```", "**", "~~", "*", "_", "~", "`"];

const renderWhatsAppInline = (text: string, keyPrefix = "text"): ReactNode[] => {
  const parts: ReactNode[] = [];
  let plainStart = 0;
  let index = 0;
  let partIndex = 0;

  while (index < text.length) {
    const marker = WHATSAPP_FORMAT_MARKERS.find((candidate) => text.startsWith(candidate, index));
    if (!marker || (index > 0 && text[index - 1] === "\\")) {
      index += 1;
      continue;
    }

    const closeIndex = text.indexOf(marker, index + marker.length);
    if (closeIndex <= index + marker.length) {
      index += marker.length;
      continue;
    }
    const content = text.slice(index + marker.length, closeIndex);
    if (!content.trim()) {
      index = closeIndex + marker.length;
      continue;
    }

    if (index > plainStart) parts.push(text.slice(plainStart, index));
    const children = marker === "```" || marker === "`" ? [content] : renderWhatsAppInline(content, `${keyPrefix}-${partIndex}`);
    const key = `${keyPrefix}-${partIndex++}`;
    if (marker === "*" || marker === "**") parts.push(<strong key={key}>{children}</strong>);
    else if (marker === "_") parts.push(<em key={key}>{children}</em>);
    else if (marker === "~" || marker === "~~") parts.push(<del key={key}>{children}</del>);
    else parts.push(<code key={key} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em]">{children}</code>);

    index = closeIndex + marker.length;
    plainStart = index;
  }

  if (plainStart < text.length) parts.push(text.slice(plainStart));
  return parts;
};

const WhatsAppFormattedText = ({ text, className = "" }: { text: string; className?: string }) => {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`} className="border-l-2 border-current/40 pl-3 opacity-90">{quoteLines.map((quoteLine, lineIndex) => <div key={lineIndex}>{renderWhatsAppInline(quoteLine, `quote-${index}-${lineIndex}`)}</div>)}</blockquote>);
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`} className="list-disc space-y-0.5 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{renderWhatsAppInline(item, `list-${index}-${itemIndex}`)}</li>)}</ul>);
      continue;
    }

    const orderedMatch = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (orderedMatch) {
      const items: string[] = [];
      const start = Number(orderedMatch[1]);
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(<ol key={`ordered-${index}`} start={start} className="list-decimal space-y-0.5 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{renderWhatsAppInline(item, `ordered-${index}-${itemIndex}`)}</li>)}</ol>);
      continue;
    }

    blocks.push(line ? <div key={`line-${index}`}>{renderWhatsAppInline(line, `line-${index}`)}</div> : <div key={`line-${index}`} className="h-3" />);
    index += 1;
  }

  return <div className={`whitespace-pre-wrap break-words ${className}`}>{blocks}</div>;
};

const messageContent = (message: Message): Record<string, any> => {
  if (typeof message.message !== "string") return message.message || {};
  try {
    return JSON.parse(message.message);
  } catch {
    return { conversation: message.message };
  }
};

type MetaAiRichContent = { text: string; suggestions: string[]; images: string[] };

const getMetaAiRichContent = (richResponse: Record<string, any> | undefined): MetaAiRichContent => {
  if (!richResponse) return { text: "", suggestions: [], images: [] };

  const suggestions: string[] = [];
  const text = (Array.isArray(richResponse.submessages) ? richResponse.submessages : [])
    .map((submessage: Record<string, any>) => {
      const value = typeof submessage.messageText === "string" ? submessage.messageText : "";
      const cleaned = value.replace(/<ui-widget>([\s\S]*?)<\/ui-widget>/gi, (_match, widget: string) => {
        try {
          const parsed = JSON.parse(widget);
          if (parsed.type === "follow_up_suggestions" && Array.isArray(parsed.suggestions)) {
            suggestions.push(
              ...parsed.suggestions
                .map((suggestion: Record<string, unknown>) => suggestion.display_text || suggestion.text)
                .filter((suggestion: unknown): suggestion is string => typeof suggestion === "string" && !!suggestion.trim()),
            );
          }
        } catch {
          // Ignore unsupported widget payloads and keep rendering the text response.
        }
        return "";
      });
      return cleaned.replace(/\{\{\/?IE_\d+\}\}/g, "").trim();
    })
    .filter(Boolean)
    .join("\n\n");

  const images: string[] = [];
  const encodedData = richResponse.unifiedResponse?.data;
  if (typeof encodedData === "string") {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodedData), (char) => char.charCodeAt(0))));
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (!value || typeof value !== "object") return;
        const object = value as Record<string, any>;
        const image = object.full_image || object.preview_image;
        const url = typeof image?.url === "string" ? image.url : null;
        if (url) {
          try {
            const parsedUrl = new URL(url);
            if (parsedUrl.protocol === "https:" && parsedUrl.hostname.endsWith("whatsapp.net") && !images.includes(url)) {
              images.push(url);
            }
          } catch {
            // Ignore malformed image URLs from the rich response.
          }
          return;
        }
        Object.values(object).forEach(visit);
      };
      visit(decoded);
    } catch {
      // Older or incomplete rich responses may not contain decodable image metadata.
    }
  }

  return { text, suggestions: [...new Set(suggestions)], images };
};

const ChatMetaAiMessage = ({ richResponse }: { richResponse: Record<string, any> }) => {
  const content = getMetaAiRichContent(richResponse);

  return (
    <div className="flex max-w-lg flex-col gap-3">
      {content.text && <WhatsAppFormattedText text={content.text} className="text-sm" />}
      {content.images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {content.images.map((url, index) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir imagem ${index + 1}`}>
              <img src={url} alt={`Imagem ${index + 1} gerada pela Meta AI`} loading="lazy" className="h-auto max-h-64 w-full rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}
      {content.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Sugestões da Meta AI">
          {content.suggestions.map((suggestion) => (
            <span key={suggestion} className="rounded-full border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
              {suggestion}
            </span>
          ))}
        </div>
      )}
      {!content.text && content.images.length === 0 && content.suggestions.length === 0 && (
        <span className="text-sm text-muted-foreground">Resposta da Meta AI indisponível</span>
      )}
    </div>
  );
};

const normalizeMessageForDisplay = (message: Message): Message => {
  let content = messageContent(message);

  // WhatsApp may wrap paired media in associatedChildMessage. Unwrap it along
  // with other future-proof wrappers before deciding how the chat should render it.
  for (let depth = 0; depth < 10; depth++) {
    const nested =
      content.associatedChildMessage?.message ||
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.viewOnceMessageV2Extension?.message ||
      content.documentWithCaptionMessage?.message ||
      content.deviceSentMessage?.message ||
      content.editedMessage?.message ||
      content.groupStatusMessage?.message ||
      content.groupStatusMessageV2?.message;

    if (!nested || typeof nested !== "object") break;
    content = nested;
  }

  const contentType = Object.keys(content).find((key) => key === "conversation" || (key.endsWith("Message") && key !== "messageContextInfo"));

  return {
    ...message,
    message: content,
    messageType: contentType || message.messageType,
  };
};

const copyableMessageText = (message: Message): string => {
  const content = messageContent(message);
  const nested = content.viewOnceMessage?.message || content.viewOnceMessageV2?.message || content.ephemeralMessage?.message || content;
  const candidates = [
    getMessageText(nested),
    getMetaAiRichContent(nested.richResponseMessage).text,
    nested.extendedTextMessage?.text,
    nested.imageMessage?.caption,
    nested.videoMessage?.caption,
    nested.documentMessage?.caption,
    nested.documentMessage?.fileName,
    nested.documentWithCaptionMessage?.message?.documentMessage?.caption,
    nested.buttonsResponseMessage?.selectedDisplayText,
    nested.listResponseMessage?.title,
    nested.interactiveMessage?.body?.text,
    nested.listMessage?.description,
    nested.pollCreationMessage?.name,
    nested.pollCreationMessageV3?.name,
    nested.locationMessage?.name,
    nested.locationMessage?.address,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
};

const messagePreview = (message: Message): string =>
  copyableMessageText(message) ||
  {
    imageMessage: "Imagem",
    videoMessage: "Vídeo",
    audioMessage: "Áudio",
    documentMessage: "Documento",
    contactMessage: "Contato",
    locationMessage: "Localização",
    stickerMessage: "Figurinha",
    reactionMessage: message.message?.reactionMessage?.text ? `Reação ${message.message.reactionMessage.text}` : "Reação removida",
    protocolMessage: "Atualização da mensagem",
  }[message.messageType] ||
  "Mensagem";

type MessageReaction = { sender: string; text: string };

const ReactionBadges = ({ reactions }: { reactions?: MessageReaction[] }) => {
  if (!reactions?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" aria-label="Reações da mensagem">
      {reactions.map((reaction) => (
        <span key={reaction.sender} title={reaction.sender} className="rounded-full border bg-background px-1.5 py-0.5 text-sm" aria-label={`${reaction.sender} reagiu com ${reaction.text}`}>
          {reaction.text}
        </span>
      ))}
    </div>
  );
};

const quotedMessage = (message: Message): QuotedMessage => ({ key: message.key, message: messageContent(message) });
const PAGE_SIZE = 30;

const quotedMessageId = (message: Message): string | null => {
  const content = messageContent(message) as any;
  const body = content.extendedTextMessage || content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage;
  const context = message.contextInfo || content.contextInfo || body?.contextInfo;
  return context?.stanzaId || context?.quotedMessage?.key?.id || context?.quotedMessage?.id || null;
};

const quotedContentPreview = (message: Message): string | null => {
  const content = messageContent(message);
  const body =
    content.extendedTextMessage || content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage || content.documentWithCaptionMessage?.message?.documentMessage;
  const quoted = message.contextInfo?.quotedMessage || content.contextInfo?.quotedMessage || body?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  const text =
    quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || quoted.videoMessage?.caption || quoted.documentMessage?.caption || quoted.documentMessage?.fileName;
  return text || (quoted.imageMessage ? "Imagem" : quoted.videoMessage ? "Vídeo" : quoted.audioMessage ? "Áudio" : quoted.documentMessage ? "Documento" : "Mensagem");
};

const QuotedContent = ({ message, onJump }: { message: Message; onJump: (messageId: string) => void }) => {
  const preview = quotedContentPreview(message);
  if (!preview) return null;
  const targetId = quotedMessageId(message);
  const content = <WhatsAppFormattedText text={preview} className="line-clamp-2" />;
  return targetId ? (
    <button type="button" onClick={() => onJump(targetId)} aria-label="Ir para a mensagem mencionada" className="mb-2 block w-full max-w-full overflow-hidden rounded border-l-2 border-current bg-black/10 px-2 py-1 text-left text-xs opacity-80 hover:opacity-100">
      {content}
    </button>
  ) : (
    <div className="mb-2 max-w-full overflow-hidden rounded border-l-2 border-current bg-black/10 px-2 py-1 text-xs opacity-80">{content}</div>
  );
};

// Component to render different message types based on messageType
const MessageContent = ({ message, instanceName, token }: { message: Message; instanceName?: string; token?: string }) => {
  message = normalizeMessageForDisplay(message);
  const messageType = message.messageType as string;

  switch (messageType) {
    case "conversation":
      if (
        message.message?.buttonsResponseMessage ||
        message.message?.listResponseMessage ||
        message.message?.pollCreationMessage ||
        message.message?.pollCreationMessageV3 ||
        message.message?.interactiveMessage ||
        message.message?.listMessage
      ) {
        return <ChatInteractiveMessage message={message} />;
      }
      if (message.message.contactMessage) {
        return <ChatContactMessage contact={message.message.contactMessage} fromMe={message.key.fromMe} />;
      }

      return <WhatsAppFormattedText text={getMessageText(message.message)} />;

    case "extendedTextMessage":
      return <WhatsAppFormattedText text={message.message.conversation ?? message.message.extendedTextMessage?.text ?? ""} />;

    case "contactMessage":
      return <ChatContactMessage contact={message.message.contactMessage} fromMe={message.key.fromMe} />;

    case "locationMessage": {
      const location = message.message.locationMessage;
      const latitude = location?.degreesLatitude;
      const longitude = location?.degreesLongitude;
      const hasCoordinates = typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude);

      return (
        <div className="max-w-xs rounded-lg bg-muted p-3">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <span aria-hidden="true">📍</span> Localização
          </div>
          {location?.name && <p className="text-sm font-medium">{location.name}</p>}
          {location?.address && <p className="text-xs text-muted-foreground">{location.address}</p>}
          {hasCoordinates && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm text-primary hover:underline">
              Abrir no mapa
            </a>
          )}
        </div>
      );
    }

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
          {message.message.imageMessage?.caption && <WhatsAppFormattedText text={message.message.imageMessage.caption} className="text-sm" />}
        </div>
      );

    case "videoMessage":
      return (
        <div className="flex flex-col gap-2">
          <ChatVideoMessage message={message} instanceName={instanceName} token={token} />
          {message.message.videoMessage?.caption && <WhatsAppFormattedText text={message.message.videoMessage.caption} className="text-sm" />}
        </div>
      );

    case "audioMessage":
      return <ChatAudioMessage message={message} instanceName={instanceName} token={token} />;

    case "documentMessage":
    case "documentWithCaptionMessage":
      return (
        <div className="flex flex-col gap-2">
          <ChatDocumentMessage message={message} instanceName={instanceName} token={token} />
          {(message.message.documentMessage?.caption || message.message.documentWithCaptionMessage?.message?.documentMessage?.caption) && (
            <WhatsAppFormattedText
              text={message.message.documentMessage?.caption || message.message.documentWithCaptionMessage?.message?.documentMessage?.caption || ""}
              className="text-sm"
            />
          )}
        </div>
      );

    case "stickerMessage":
      return <ChatMessageImage message={message} instanceName={instanceName} token={token} className="max-w-32 max-h-32 object-contain" />;

    case "reactionMessage":
      return <span>{message.message?.reactionMessage?.text ? `Reagiu com ${message.message.reactionMessage.text}` : "Reação removida"}</span>;

    case "protocolMessage":
      return <span>Atualização da mensagem</span>;

    case "richResponseMessage":
      return <ChatMetaAiMessage richResponse={message.message.richResponseMessage} />;

    case "secretEncryptedMessage":
      return <span className="text-sm text-muted-foreground">Mensagem editada (conteúdo indisponível)</span>;

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
  message = normalizeMessageForDisplay(message);
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
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isMedia, visible]);

  if (!isMedia) return <MessageContent message={message} instanceName={instanceName} token={token} />;
  return (
    <div ref={containerRef} className={visible ? undefined : "min-h-20 min-w-32"}>
      {visible ? <MessageContent message={message} instanceName={instanceName} token={token} /> : <span className="text-xs text-muted-foreground">{messagePreview(message)}</span>}
    </div>
  );
};

const withoutManagerSignature = (message: Message): Message => {
  if (!message.managerSigned || !message.managerSenderName || !message.message) return message;
  const safeName = message.managerSenderName
    .replace(/[\r\n*_~`]/g, " ")
    .trim()
    .slice(0, 100);
  const prefix = `*${safeName}:*\n`;
  const content = { ...message.message };
  if (typeof content.conversation === "string" && content.conversation.startsWith(prefix)) {
    content.conversation = content.conversation.slice(prefix.length);
  }
  if (typeof content.extendedTextMessage?.text === "string" && content.extendedTextMessage.text.startsWith(prefix)) {
    content.extendedTextMessage = { ...content.extendedTextMessage, text: content.extendedTextMessage.text.slice(prefix.length) };
  }
  for (const kind of ["imageMessage", "videoMessage", "documentMessage"]) {
    if (typeof content[kind]?.caption === "string" && content[kind].caption.startsWith(prefix)) {
      content[kind] = { ...content[kind], caption: content[kind].caption.slice(prefix.length) };
    }
  }
  const nestedDocument = content.documentWithCaptionMessage?.message?.documentMessage;
  if (typeof nestedDocument?.caption === "string" && nestedDocument.caption.startsWith(prefix)) {
    content.documentWithCaptionMessage = {
      ...content.documentWithCaptionMessage,
      message: {
        ...content.documentWithCaptionMessage.message,
        documentMessage: { ...nestedDocument, caption: nestedDocument.caption.slice(prefix.length) },
      },
    };
  }
  return { ...message, message: content };
};

function Messages({ contacts = [], contactVariables, headerNameOverride, headerActions, textareaRef, handleTextareaChange, textareaHeight, lastMessageRef, scrollToBottom }: MessagesProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = i18n.language;
  const { instance } = useInstance();
  const { data: managerAccount } = useManagerAccount();
  const contactsByCanonicalJid = useMemo(() => {
    const normalizeJid = (jid: string) => jid.replace(/:\d+(?=@)/, "");
    return new Map(contacts.map((contact) => [normalizeJid(contact.remoteJid), contact]));
  }, [contacts]);
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const sendLockRef = useRef(false);
  const pendingSendRef = useRef<{ kind: string; chat?: string; content: string | File | Blob; caption?: string; id: string } | null>(null);
  const requestIdFor = (kind: string, content: string | File | Blob, caption?: string) => {
    const pending = pendingSendRef.current;
    if (pending?.kind === kind && pending.chat === remoteJid && pending.content === content && pending.caption === caption) return pending.id;
    const id = crypto.randomUUID();
    pendingSendRef.current = { kind, chat: remoteJid, content, caption, id };
    return id;
  };
  const clearRequestId = (id: string) => {
    if (pendingSendRef.current?.id === id) pendingSendRef.current = null;
  };
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [preparedMedia, setPreparedMedia] = useState<{ file: File; base64: string } | null>(null);
  const [mediaPreparationProgress, setMediaPreparationProgress] = useState<number | null>(null);
  const [mediaUploadProgress, setMediaUploadProgress] = useState<number | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forwardSource, setForwardSource] = useState<Message | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardSelectedJid, setForwardSelectedJid] = useState("");
  const [forwarding, setForwarding] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [reactingId, setReactingId] = useState("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [olderPages, setOlderPages] = useState<Message[][]>([]);
  const pendingJumpRef = useRef<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const readReceiptIdsRef = useRef(new Set<string>());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef<{ height: number; top: number; expectedPages: number } | null>(null);
  const initialScrollDoneRef = useRef(false);
  const nearBottomRef = useRef(true);
  const { sendText: sendTextMutation } = useSendMessage();
  const { sendMedia: sendMediaMutation } = useSendMedia();
  const { sendAudio: sendAudioMutation } = useSendAudio();

  const { remoteJid } = useParams<{ remoteJid: string }>();
  const { contactTyping, updateTyping, stopTyping } = useChatPresence(instance?.name, instance?.token, instance?.integration, remoteJid);

  useEffect(() => setRecordingActive(false), [remoteJid]);

  useEffect(() => {
    if (!selectedMedia) {
      setPreparedMedia(null);
      setMediaPreparationProgress(null);
      setMediaUploadProgress(null);
      return;
    }
    const reader = new FileReader();
    setPreparedMedia(null);
    setMediaPreparationProgress(0);
    setMediaUploadProgress(null);
    reader.onprogress = (event) => {
      if (event.lengthComputable) setMediaPreparationProgress(Math.round((event.loaded / event.total) * 100));
    };
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      setPreparedMedia({ file: selectedMedia, base64 });
      setMediaPreparationProgress(100);
    };
    reader.onerror = () => {
      setMediaPreparationProgress(null);
      toast.error("Não foi possível preparar o arquivo para envio.");
    };
    reader.readAsDataURL(selectedMedia);
    return () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [selectedMedia]);

  const selectDroppedFile = (file?: File) => {
    if (!file || !validateChatAttachment(file)) return;
    setSelectedMedia(file);
  };

  const sendRecording = async (audio: Blob) => {
    if (!remoteJid || !instance?.name || !instance?.token) throw new Error("Instância indisponível");
    if (sendLockRef.current) throw new Error("Envio em andamento");
    sendLockRef.current = true;
    const clientRequestId = requestIdFor("audio", audio, replyTo?.key.id);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(audio);
      });
      await sendAudioMutation({ instanceName: instance.name, token: instance.token, data: { number: remoteJid, audio: base64, clientRequestId, ...(replyTo && { quoted: quotedMessage(replyTo) }) } });
      clearRequestId(clientRequestId);
      setReplyTo(null);
    } finally {
      sendLockRef.current = false;
    }
  };

  // Handle sending text messages
  const sendTextMessage = async () => {
    if (!messageText.trim() || !remoteJid || !instance?.name || !instance?.token || isSending) return;
    const personalizedText = personalizeMessage(messageText.trim());
    const clientRequestId = requestIdFor("text", personalizedText, replyTo?.key.id);

    try {
      setIsSending(true);
      await sendTextMutation({
        instanceName: instance.name,
        token: instance.token,
        data: {
          number: remoteJid,
          text: personalizedText,
          clientRequestId,
          signMessage: managerAccount?.signMessages === true,
          ...(replyTo && { quoted: quotedMessage(replyTo) }),
        },
      });

      // Clear the input after sending
      clearRequestId(clientRequestId);
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
    if (!selectedMedia || preparedMedia?.file !== selectedMedia || !remoteJid || !instance?.name || !instance?.token || isSending) return;
    const personalizedCaption = personalizeMessage(messageText.trim());
    const clientRequestId = requestIdFor("media", selectedMedia, `${personalizedCaption}\0${replyTo?.key.id || ""}`);

    try {
      setIsSending(true);

      setMediaUploadProgress(0);
      await sendMediaMutation({
        instanceName: instance.name,
        token: instance.token,
        onUploadProgress: setMediaUploadProgress,
        data: {
          number: remoteJid,
          clientRequestId,
          signMessage: managerAccount?.signMessages === true,
          ...(replyTo && { quoted: quotedMessage(replyTo) }),
          mediaMessage: {
            mediatype: ["audio", "video", "image"].includes(selectedMedia.type.split("/")[0]) ? (selectedMedia.type.split("/")[0] as "audio" | "video" | "image") : "document",
            mimetype: selectedMedia.type || "application/octet-stream",
            caption: personalizedCaption,
            media: preparedMedia.base64,
            fileName: selectedMedia.name,
          },
        },
      });

      // Clear the input and media after sending
      clearRequestId(clientRequestId);
      setSelectedMedia(null);
      setMessageText("");
      setReplyTo(null);
      if (textareaRef.current) {
        textareaRef.current.value = "";
        handleTextareaChange(); // Reset height
      }
    } catch (error) {
      console.error("Error sending media:", error);
      setMediaUploadProgress(null);
      toast.error("Não foi possível enviar o arquivo. Tente novamente.");
    } finally {
      setIsSending(false);
    }
  };

  // Handle message sending (decides between text or media)
  const sendMessage = async () => {
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    try {
      stopTyping();
      if (selectedMedia) {
        await sendMediaMessage();
      } else {
        await sendTextMessage();
      }
    } finally {
      sendLockRef.current = false;
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
    updateTyping(e.target.value);
    handleTextareaChange();
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? messageText.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${messageText.slice(0, start)}${emoji}${messageText.slice(end)}`;
    setMessageText(next);
    updateTyping(next);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length);
      handleTextareaChange();
    });
  };

  const insertVariable = (token: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? messageText.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${messageText.slice(0, start)}${token}${messageText.slice(end)}`;
    setMessageText(next);
    updateTyping(next);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
      handleTextareaChange();
    });
  };

  const personalizeMessage = (text: string) => {
    const values: Record<string, string> = {
      nome: contactVariables?.name || remoteJid?.split("@")[0] || "",
      primeiro_nome: (contactVariables?.name || remoteJid?.split("@")[0] || "").split(/\s+/)[0] || "",
      telefone: contactVariables?.phone || remoteJid?.split("@")[0] || "",
      data_nascimento: contactVariables?.birthDate || "",
      aniversario: contactVariables?.anniversary || "",
      idade: contactVariables?.age || "",
      etiquetas: contactVariables?.labels || "",
    };
    return text.replace(/{{\s*(nome|primeiro_nome|telefone|data_nascimento|aniversario|idade|etiquetas)\s*}}/gi, (_, key: string) => values[key.toLowerCase()] || "");
  };

  const applyWhatsAppFormatting = (format: "bold" | "italic" | "strike" | "monospace" | "quote" | "bullet" | "numbered") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    const originalStart = start;
    const hadSelection = end > start;
    const value = textarea.value;
    const selected = value.slice(start, end);
    let next: string;
    let selectionStart: number;
    let selectionEnd: number;

    const wrappers = {
      bold: ["*", "*"],
      italic: ["_", "_"],
      strike: ["~", "~"],
      monospace: ["```", "```"],
    } as const;

    if (format in wrappers) {
      const [before, after] = wrappers[format as keyof typeof wrappers];
      const replacement = `${before}${selected}${after}`;
      next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
      selectionStart = start + before.length;
      selectionEnd = selectionStart + selected.length;
    } else {
      const listMarkers = { quote: "> ", bullet: "- ", numbered: "1. " } as const;
      const marker = listMarkers[format as keyof typeof listMarkers];
      if (start === end) {
        const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
        const lineEndIndex = value.indexOf("\n", start);
        end = lineEndIndex < 0 ? value.length : lineEndIndex;
        start = lineStart;
      }
      const lines = value.slice(start, end).split("\n");
      const replacement = lines.map((line, lineIndex) => `${format === "numbered" ? `${lineIndex + 1}. ` : marker}${line}`).join("\n");
      next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
      if (hadSelection) {
        selectionStart = start + marker.length;
        selectionEnd = start + replacement.length;
      } else {
        selectionStart = start + marker.length + (originalStart - start);
        selectionEnd = selectionStart;
      }
    }

    setMessageText(next);
    updateTyping(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      handleTextareaChange();
    });
  };

  const { data: chat } = useFindChat({
    remoteJid,
    instanceName: instance?.name,
  });

  const { data: messagePage } = useQuery<{ records: Message[]; pages: number }>({
    queryKey: ["chats", "findMessages", instance?.name, remoteJid, PAGE_SIZE],
    queryFn: () => fetchMessagesPage({ instanceName: instance!.name, remoteJid: remoteJid!, offset: PAGE_SIZE, page: 1 }),
    enabled: !!instance?.name && !!remoteJid,
    // Keep incoming messages responsive when Socket.IO is unavailable behind a proxy.
    refetchInterval: 1500,
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
      const stored = messageMap.get(message.key.id) as Message | undefined;
      messageMap.set(message.key.id, {
        ...stored,
        ...message,
        managerSenderId: message.managerSenderId ?? stored?.managerSenderId,
        managerSenderName: message.managerSenderName ?? stored?.managerSenderName,
        managerSigned: message.managerSigned ?? stored?.managerSigned,
      });
    });

    return Array.from(messageMap.values()).filter((message: Message) => !removedIds.has(message.key.id) && !message.key.deleted && message.status !== "DELETED");
  }, [messages, olderPages, realtimeMessages, removedIds]);

  const jumpToQuotedMessage = async (messageId: string) => {
    const findTarget = () => Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((element) => element.dataset.messageId === messageId);
    if (!findTarget() && instance?.name && remoteJid) {
      const lastPage = messagePage?.pages || 1;
      for (let pageNumber = olderPages.length + 2; pageNumber <= lastPage; pageNumber += 1) {
        try {
          const page = await fetchMessagesPage({ instanceName: instance.name, remoteJid, offset: PAGE_SIZE, page: pageNumber });
          setOlderPages((current) => current.some((existing) => existing[0]?.key.id === page.records[0]?.key.id) ? current : [...current, page.records]);
          if (page.records.some((record: Message) => record.key.id === messageId)) break;
          if (!page.records.length) break;
        } catch {
          toast.error("Não foi possível localizar a mensagem mencionada");
          return;
        }
      }
    }
    pendingJumpRef.current = messageId;
    const target = findTarget();
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("message-jump-highlight");
      window.setTimeout(() => target.classList.remove("message-jump-highlight"), 1800);
      pendingJumpRef.current = null;
    }
  };

  useEffect(() => {
    const messageId = pendingJumpRef.current;
    if (!messageId || !allMessages.some((message) => message.key.id === messageId)) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((element) => element.dataset.messageId === messageId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("message-jump-highlight");
    window.setTimeout(() => target.classList.remove("message-jump-highlight"), 1800);
    pendingJumpRef.current = null;
  }, [allMessages]);

  useEffect(() => {
    readReceiptIdsRef.current.clear();
  }, [instance?.id, remoteJid]);

  useEffect(() => {
    if (!instance?.name || !instance.token || !remoteJid || !allMessages.length) return;
    const unreadMessages = allMessages.filter(
      (message) => !message.key.fromMe && message.key.remoteJid === remoteJid && message.status === "DELIVERY_ACK" && !readReceiptIdsRef.current.has(message.key.id),
    );
    if (!unreadMessages.length) return;
    unreadMessages.forEach((message) => readReceiptIdsRef.current.add(message.key.id));
    api
      .post(
        `/chat/markMessageAsRead/${instance.name}`,
        { readMessages: unreadMessages.map(({ key }) => ({ id: key.id, fromMe: false, remoteJid: key.remoteJid })) },
        { headers: { apikey: instance.token } },
      )
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["chats", "findChats"] }).catch(console.error);
        queryClient.invalidateQueries({ queryKey: ["chats", "findMessages"] }).catch(console.error);
      })
      .catch((error) => {
        unreadMessages.forEach((message) => readReceiptIdsRef.current.delete(message.key.id));
        console.error("Could not mark chat messages as read:", error);
      });
  }, [allMessages, instance?.id, instance?.name, instance?.token, queryClient, remoteJid]);

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
          updatedMessages[existingIndex] = {
            ...updatedMessages[existingIndex],
            ...message,
            managerSenderId: message.managerSenderId ?? updatedMessages[existingIndex].managerSenderId,
            managerSenderName: message.managerSenderName ?? updatedMessages[existingIndex].managerSenderName,
            managerSigned: message.managerSigned ?? updatedMessages[existingIndex].managerSigned,
          };
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

  const { visibleMessages, reactionsByTarget } = useMemo(() => {
    const reactions = new Map<string, Map<string, MessageReaction>>();
    const edits = new Map<string, Record<string, unknown>>();
    const targetIds = new Set(allMessages.filter((message) => !["reactionMessage", "protocolMessage"].includes(normalizeMessageForDisplay(message).messageType)).map((message) => message.key.id));
    const visible: Message[] = [];

    [...allMessages]
      .sort((a, b) => getMessageTimestamp(a).getTime() - getMessageTimestamp(b).getTime())
      .forEach((message) => {
        const normalized = normalizeMessageForDisplay(message);
        if (normalized.messageType === "protocolMessage") {
          const protocol = normalized.message?.protocolMessage;
          const editedContent = protocol?.editedMessage;
          const targetId = protocol?.key?.id;
          if (editedContent && targetId) {
            if (targetIds.has(targetId)) edits.set(targetId, editedContent);
            else visible.push(normalizeMessageForDisplay({ ...message, message: editedContent, status: "EDITED" }));
          } else {
            visible.push(message);
          }
          return;
        }
        if (normalized.messageType !== "reactionMessage") {
          visible.push(message);
          return;
        }

        const reaction = normalized.message?.reactionMessage;
        const targetId = reaction?.key?.id;
        if (!targetId) {
          visible.push(message);
          return;
        }

        const sender = message.key.fromMe ? "Você" : message.pushName || message.key.participant || message.key.remoteJid;
        const senderKey = message.key.fromMe ? "self" : message.key.participant || message.key.remoteJid;
        const bySender = reactions.get(targetId) || new Map<string, MessageReaction>();
        if (reaction.text) bySender.set(senderKey, { sender, text: reaction.text });
        else bySender.delete(senderKey);
        reactions.set(targetId, bySender);

        if (!targetIds.has(targetId) && reaction.text) visible.push(message);
      });

    return {
      visibleMessages: visible.map((message) => {
        const editedContent = edits.get(message.key.id);
        return editedContent ? normalizeMessageForDisplay({ ...message, message: editedContent, status: "EDITED" }) : message;
      }),
      reactionsByTarget: new Map([...reactions].map(([targetId, bySender]) => [targetId, [...bySender.values()]])),
    };
  }, [allMessages]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    // Sort messages by timestamp first
    const sortedMessages = [...visibleMessages].sort((a, b) => {
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
  }, [visibleMessages, t, locale]);

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

  useEffect(() => {
    if (contactTyping && nearBottomRef.current) scrollToBottom();
  }, [contactTyping, scrollToBottom]);

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
      if (!copied) {
        toast.error("Não foi possível copiar a mensagem");
        return;
      }
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

  const sendReaction = async (message: Message, emoji: string) => {
    if (!instance?.name || !instance?.token || reactingId) return;
    const currentReaction = reactionsByTarget.get(message.key.id)?.find((reaction) => reaction.sender === "Você")?.text;
    const reaction = emoji === currentReaction ? "" : emoji;
    try {
      setReactingId(message.key.id);
      const response = await api.post<Message>(
        `/message/sendReaction/${instance.name}`,
        { key: { id: message.key.id, remoteJid: message.key.remoteJid, fromMe: message.key.fromMe, ...(message.key.participant && { participant: message.key.participant }) }, reaction },
        { headers: { apikey: instance.token } },
      );
      if (response.data?.key?.id && response.data.message?.reactionMessage) {
        setRealtimeMessages((current) => [...current.filter((item) => item.key.id !== response.data.key.id), response.data]);
      }
      await queryClient.invalidateQueries({ queryKey: ["chats", "findMessages"] });
    } catch (error) {
      console.error("Error sending reaction:", error);
      toast.error("Não foi possível enviar a reação");
    } finally {
      setReactingId("");
    }
  };

  const sendForward = async () => {
    if (!forwardSource || !instance?.name || !instance?.token || forwarding || sendLockRef.current) return;
    const number = (forwardSelectedJid || forwardSearch).replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(number)) return;
    sendLockRef.current = true;
    const clientRequestId = requestIdFor("forward", `${forwardSource.key.id}:${number}`);
    try {
      setForwarding(true);
      await api.post(
        `/chat/forwardMessage/${instance.name}`,
        {
          id: forwardSource.key.id,
          remoteJid: forwardSource.key.remoteJid,
          number,
          clientRequestId,
        },
        { headers: { apikey: instance.token } },
      );
      setForwardSource(null);
      clearRequestId(clientRequestId);
      await queryClient.invalidateQueries({ queryKey: ["chats", "findChats"] });
      toast.success("Mensagem encaminhada");
    } catch (error) {
      console.error("Error forwarding message:", error);
      toast.error("Não foi possível encaminhar a mensagem");
    } finally {
      setForwarding(false);
      sendLockRef.current = false;
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
        <DropdownMenuItem
          onClick={() => {
            setReplyTo(message);
            textareaRef.current?.focus();
          }}>
          <Reply className="mr-2 h-4 w-4" /> Responder
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={instance?.integration !== "WHATSAPP-BAILEYS"}
          onClick={() => {
            setForwardSearch("");
            setForwardSelectedJid("");
            setForwardSource(message);
          }}>
          <Forward className="mr-2 h-4 w-4" /> Encaminhar
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!copyableMessageText(message)} onClick={() => copyMessage(message)}>
          <Copy className="mr-2 h-4 w-4" /> Copiar
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!message.key.fromMe || instance?.integration !== "WHATSAPP-BAILEYS" || !!deletingId} className="text-destructive" onClick={() => deleteForEveryone(message)}>
          <Trash2 className="mr-2 h-4 w-4" /> Excluir para todos
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderBubbleRight = (message: Message) => (
    <div key={message.key.id} data-message-id={message.key.id} className="mb-4 flex justify-end">
      <div className="flex max-w-[85%] items-start gap-1">
        <ChatEmojiPicker
          label="Reagir à mensagem"
          onSelect={(emoji) => sendReaction(message, emoji)}
          onClear={reactionsByTarget.get(message.key.id)?.some((reaction) => reaction.sender === "Você") ? () => sendReaction(message, "") : undefined}
          disabled={!!reactingId || !["WHATSAPP-BAILEYS", "WHATSAPP-BUSINESS"].includes(instance?.integration || "")}
        />
        {messageActions(message)}
        <div className="min-w-0">
          {message.managerSenderName && <div className="mb-1 px-1 text-right text-xs font-semibold text-primary">{message.managerSenderName}:</div>}
          <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
            <QuotedContent message={message} onJump={jumpToQuotedMessage} />
            <DeferredMessageContent message={withoutManagerSignature(message)} instanceName={instance?.name} token={instance?.token} />
          </div>
          <ReactionBadges reactions={reactionsByTarget.get(message.key.id)} />
          <span className="mt-0.5 block px-1 text-right text-[11px] text-muted-foreground">
            {formatMessageTime(getMessageTimestamp(message), locale)}
            {message.status === "EDITED" && " · editada"}
          </span>
        </div>
      </div>
    </div>
  );

  const renderBubbleLeft = (message: Message) => {
    const isGroup = !!remoteJid?.endsWith("@g.us");
    const participant = message.key.participant;
    const senderKey = participant || message.pushName || "";
    const normalizeJid = (jid: string) => jid.replace(/:\d+(?=@)/, "");
    const participantCandidates = [participant, (message.key as typeof message.key & { participantAlt?: string }).participantAlt]
      .filter((jid): jid is string => Boolean(jid))
      .map(normalizeJid);
    const senderContact = participantCandidates.map((jid) => contactsByCanonicalJid.get(jid)).find(Boolean);
    const contactSenderName = senderContact?.customName?.trim() || senderContact?.pushName?.trim();
    const messageSenderName = message.pushName?.trim();
    const hasNumericSenderName = Boolean(messageSenderName && /^\+?\d[\d:]*$/.test(messageSenderName));
    const senderName = contactSenderName || (!hasNumericSenderName ? messageSenderName : "") || (participant ? normalizeJid(participant).split("@")[0] : "");

    return (
      <div key={message.key.id} data-message-id={message.key.id} className="mb-4 flex justify-start">
        <div className="flex max-w-[85%] items-start gap-1">
          <div className="min-w-0">
            {isGroup && senderName && (
              <div className="mb-1 text-xs font-semibold" style={{ color: getSenderColor(senderKey) }}>
                {senderName}
              </div>
            )}
            <div className="rounded-lg border bg-muted px-3 py-2 text-sm text-foreground">
              <QuotedContent message={message} onJump={jumpToQuotedMessage} />
              <DeferredMessageContent message={message} instanceName={instance?.name} token={instance?.token} />
            </div>
            <ReactionBadges reactions={reactionsByTarget.get(message.key.id)} />
            <span className="mt-0.5 block px-1 text-[11px] text-muted-foreground">
              {formatMessageTime(getMessageTimestamp(message), locale)}
              {message.status === "EDITED" && " · editada"}
            </span>
          </div>
          {messageActions(message)}
          <ChatEmojiPicker
            label="Reagir à mensagem"
            onSelect={(emoji) => sendReaction(message, emoji)}
            onClear={reactionsByTarget.get(message.key.id)?.some((reaction) => reaction.sender === "Você") ? () => sendReaction(message, "") : undefined}
            disabled={!!reactingId || !["WHATSAPP-BAILEYS", "WHATSAPP-BUSINESS"].includes(instance?.integration || "")}
          />
        </div>
      </div>
    );
  };

  const headerName = headerNameOverride || chat?.pushName || chat?.remoteJid?.split("@")[0] || remoteJid?.split("@")[0];
  const headerSub = chat?.remoteJid?.split("@")[0];
  const forwardQuery = forwardSearch
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const forwardDigits = forwardSearch.replace(/\D/g, "");
  const forwardContacts = contacts.filter(
    (contact) =>
      contact.remoteJid.endsWith("@s.whatsapp.net") &&
      (!forwardQuery ||
        (contact.pushName || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .includes(forwardQuery) ||
        (forwardDigits.length > 0 && contact.remoteJid.includes(forwardDigits))),
  );
  const selectedForwardNumber = (forwardSelectedJid || forwardSearch).replace(/\D/g, "");

  return (
    <ChatImageGallery key={remoteJid} messages={groupedMessages.flatMap((group) => group.messages)}>
      <div
        className="relative flex h-full flex-col bg-muted/10"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDraggingFile(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDraggingFile(false);
          if (event.dataTransfer.files.length > 1) toast.info("Anexe um arquivo por vez.");
          selectDroppedFile(event.dataTransfer.files[0]);
        }}>
        {draggingFile && (
          <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-primary shadow-lg">
            <div className="flex flex-col items-center gap-2 text-center">
              <Upload className="h-8 w-8" />
              <span className="font-medium">Solte a mídia ou arquivo para anexar</span>
              <span className="text-sm text-muted-foreground">Tamanho máximo: 25 MB</span>
            </div>
          </div>
        )}
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
          {hasOlder && !loadingOlder && (
            <button type="button" className="py-2 text-center text-xs text-primary hover:underline" onClick={loadOlder}>
              Carregar mensagens anteriores
            </button>
          )}
          {groupedMessages.map((group, groupIndex) => (
            <div key={groupIndex}>
              <DateSeparator date={group.date} />
              {group.messages.map((message) => (message.key.fromMe ? renderBubbleRight(message) : renderBubbleLeft(message)))}
            </div>
          ))}
          {contactTyping && (
            <div className="flex justify-start py-1" role="status" aria-label={`${headerName} está digitando`}>
              <div className="chat-typing-bubble rounded-lg border bg-muted px-3 py-2" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={lastMessageRef as never} />
        </div>
        <div className="flex-shrink-0 border-t bg-background p-3">
          <div className="rounded-lg border border-border bg-card shadow-sm">
            {replyTo && (
              <div className="flex items-start gap-2 border-b border-border bg-muted/30 px-3 py-2">
                <Reply className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">Respondendo a {replyTo.key.fromMe ? "você" : replyTo.pushName || headerName}</p>
                  <p className="truncate text-xs text-muted-foreground">{messagePreview(replyTo)}</p>
                </div>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Cancelar resposta" onClick={() => setReplyTo(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            {selectedMedia && (
              <div className="border-b border-border bg-muted/30 px-3 py-2">
                <SelectedMedia selectedMedia={selectedMedia} setSelectedMedia={setSelectedMedia} />
                <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{mediaUploadProgress !== null ? "Enviando arquivo…" : preparedMedia?.file === selectedMedia ? "Pronto para envio" : "Preparando arquivo para envio…"}</span>
                    <span>{mediaUploadProgress ?? mediaPreparationProgress ?? 0}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Progresso do arquivo"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={mediaUploadProgress ?? mediaPreparationProgress ?? 0}
                    className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${mediaUploadProgress ?? mediaPreparationProgress ?? 0}%` }} />
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 px-2 py-1.5">
              {!recordingActive && <div className="flex flex-shrink-0 items-center">{instance && <MediaOptions instance={instance} setSelectedMedia={setSelectedMedia} />}</div>}
              {!recordingActive && <ChatEmojiPicker label="Inserir emoji" onSelect={insertEmoji} disabled={isSending} />}
              {!recordingActive && instance?.token && remoteJid && (
                <ChatInteractiveComposer
                  key={remoteJid}
                  instanceName={instance.name}
                  token={instance.token}
                  integration={instance.integration}
                  remoteJid={remoteJid}
                  recipientName={instance.profileName}
                />
              )}
              {!recordingActive && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon" variant="ghost" className="h-9 w-9 flex-shrink-0" aria-label="Formatação de texto" title="Formatação de texto" disabled={isSending}>
                      <Bold className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top">
                    <DropdownMenuItem onClick={() => applyWhatsAppFormatting("bold")}><Bold className="mr-2 h-4 w-4" /> Negrito</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyWhatsAppFormatting("italic")}><Italic className="mr-2 h-4 w-4" /> Itálico</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyWhatsAppFormatting("strike")}><Strikethrough className="mr-2 h-4 w-4" /> Tachado</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyWhatsAppFormatting("monospace")}><Code2 className="mr-2 h-4 w-4" /> Monoespaçado</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyWhatsAppFormatting("quote")}><Quote className="mr-2 h-4 w-4" /> Citação</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyWhatsAppFormatting("bullet")}><List className="mr-2 h-4 w-4" /> Lista com marcadores</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applyWhatsAppFormatting("numbered")}><ListOrdered className="mr-2 h-4 w-4" /> Lista numerada</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {!recordingActive && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon" variant="ghost" className="h-9 w-9 flex-shrink-0" aria-label="Inserir variável do contato" title="Inserir variável do contato" disabled={isSending}>
                      <Braces className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top">
                    {[
                      ["Nome", "{{nome}}"],
                      ["Primeiro nome", "{{primeiro_nome}}"],
                      ["Telefone", "{{telefone}}"],
                      ["Data de nascimento", "{{data_nascimento}}"],
                      ["Aniversário", "{{aniversario}}"],
                      ["Idade", "{{idade}}"],
                      ["Etiquetas", "{{etiquetas}}"],
                    ].map(([label, token]) => (
                      <DropdownMenuItem key={token} onClick={() => insertVariable(token)}>{label} <span className="ml-auto pl-4 font-mono text-xs text-muted-foreground">{token}</span></DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {!recordingActive && (
                <Textarea
                  placeholder={t("chat.input.placeholder", { defaultValue: "Digite uma mensagem..." })}
                  name="message"
                  id="message"
                  rows={1}
                  ref={textareaRef}
                  value={messageText}
                  onChange={handleInputChange}
                  onBlur={stopTyping}
                  onKeyDown={handleKeyDown}
                  disabled={isSending}
                  style={{ height: textareaHeight }}
                  className="min-h-9 flex-1 resize-none border-none bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              )}
              {!messageText.trim() && !selectedMedia && (
                <ChatVoiceRecorder key={remoteJid} disabled={isSending || !instance?.token || !remoteJid} onActiveChange={setRecordingActive} onSend={sendRecording} />
              )}
              {!recordingActive && (messageText.trim() || selectedMedia) && (
                <Button
                  type="button"
                  size="icon"
                  onClick={sendMessage}
                  disabled={(!messageText.trim() && !selectedMedia) || (selectedMedia !== null && preparedMedia?.file !== selectedMedia) || isSending}
                  className="h-9 w-9 flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/85 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-50">
                  <Send className="h-4 w-4" />
                  <span className="sr-only">{t("chat.input.send")}</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <Dialog
        open={!!forwardSource}
        onOpenChange={(open) => {
          if (!open && !forwarding) setForwardSource(null);
        }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription className="truncate">{forwardSource && messagePreview(forwardSource)}</DialogDescription>
          <Input
            type="search"
            aria-label="Pesquisar destino"
            placeholder="Nome ou número com DDI e DDD"
            value={forwardSearch}
            onChange={(event) => {
              setForwardSearch(event.target.value);
              setForwardSelectedJid("");
            }}
          />
          <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
            {forwardContacts.map((contact) => (
              <button
                key={contact.remoteJid}
                type="button"
                className={`flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent ${forwardSelectedJid === contact.remoteJid ? "bg-accent" : ""}`}
                onClick={() => setForwardSelectedJid(contact.remoteJid)}>
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={contact.profilePicUrl} alt={contact.pushName || contact.remoteJid} />
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{contact.pushName || contact.remoteJid.split("@")[0]}</span>
                  <span className="block text-xs text-muted-foreground">{contact.remoteJid.split("@")[0]}</span>
                </span>
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
