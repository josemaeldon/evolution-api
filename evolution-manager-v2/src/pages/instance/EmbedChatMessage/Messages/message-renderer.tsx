import { ChatMessageImage } from "@/components/chat-image-lightbox";
import { ChatAudioMessage } from "@/components/chat-audio-message";
import { ChatDocumentMessage } from "@/components/chat-document-message";
import { ChatVideoMessage } from "@/components/chat-video-message";

import { Message } from "@/types/evolution.types";

import { ContactMessage } from "./contact-message";
import { ConversationMessage } from "./conversation-message";
import { LocationMessage } from "./location-message";
import { MarkdownWrapper } from "./markdown-wrapper";

interface MessageRendererProps {
  message: Message;
  fromMe: boolean;
  instanceName?: string;
  token?: string;
}

export function MessageRenderer({ message, fromMe, instanceName, token }: MessageRendererProps) {
  switch (message.messageType as string) {
    case "conversation": {
      if (message.message.contactMessage) {
        return <ContactMessage contactMessage={message.message.contactMessage} fromMe={fromMe} />;
      }

      if (message.message.locationMessage) {
        return <LocationMessage locationMessage={message.message.locationMessage} fromMe={fromMe} />;
      }

      return <ConversationMessage message={message} />;
    }
    case "extendedTextMessage":
      return <MarkdownWrapper>{message.message.conversation ?? message.message.extendedTextMessage?.text}</MarkdownWrapper>;

    case "imageMessage":
      return (
        <div className="mb-2 flex flex-col gap-2">
          <ChatMessageImage message={message} instanceName={instanceName} token={token} style={{ maxWidth: "400px", maxHeight: "400px", objectFit: "contain" }} />
          <MarkdownWrapper>{message.message.imageMessage?.caption}</MarkdownWrapper>
        </div>
      );

    case "videoMessage":
      return (
        <div className="mb-2 flex flex-col gap-2">
          <ChatVideoMessage message={message} instanceName={instanceName} token={token} />
          <MarkdownWrapper>{message.message.videoMessage?.caption}</MarkdownWrapper>
        </div>
      );

    case "audioMessage":
      return <ChatAudioMessage message={message} instanceName={instanceName} token={token} />;

    case "documentMessage":
      return <ChatDocumentMessage message={message} instanceName={instanceName} token={token} />;

    case "documentWithCaptionMessage":
      return (
        <>
          <ChatDocumentMessage message={message} instanceName={instanceName} token={token} />
          <MarkdownWrapper>{message.message.documentWithCaptionMessage.message.documentMessage.caption}</MarkdownWrapper>
        </>
      );

    case "stickerMessage":
      return (
        <ChatMessageImage
          message={message}
          instanceName={instanceName}
          token={token}
          style={{
            maxWidth: "100px",
            maxHeight: "100px",
            objectFit: "contain",
          }}
        />
      );

    case "contactMessage":
      return <ContactMessage contactMessage={message.message.contactMessage} fromMe={fromMe} />;

    case "locationMessage":
      return <LocationMessage locationMessage={message.message.locationMessage} fromMe={fromMe} />;

    default:
      return <>{JSON.stringify(message.message)}</>;
  }
}
