import { Message } from "@/types/evolution.types";

export function getMessageImageSrc(message: Message): string | null {
  if (message.messageType !== "imageMessage" && message.messageType !== "stickerMessage") return null;

  const base64 = message.message?.base64;
  if (typeof base64 === "string" && base64) {
    const mimeType = message.messageType === "stickerMessage"
      ? message.message?.stickerMessage?.mimetype || "image/webp"
      : message.message?.imageMessage?.mimetype || "image/jpeg";
    return base64.startsWith("data:") ? base64 : `data:${mimeType};base64,${base64}`;
  }

  return message.message?.mediaUrl || null;
}
