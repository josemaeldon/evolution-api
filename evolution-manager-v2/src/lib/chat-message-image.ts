import { Message } from "@/types/evolution.types";

export function getMessageImageSrc(message: Message): string | null {
  if (message.messageType !== "imageMessage") return null;

  const base64 = message.message?.base64;
  if (typeof base64 === "string" && base64) {
    return base64.startsWith("data:") ? base64 : `data:${message.message?.imageMessage?.mimetype || "image/jpeg"};base64,${base64}`;
  }

  return message.message?.mediaUrl || null;
}
