import { ChatContactMessage } from "@/components/chat-contact-message";

export function ContactMessage({ contactMessage, fromMe }: { contactMessage?: { displayName?: string; vcard?: string }; fromMe?: boolean }) {
  return <ChatContactMessage contact={contactMessage} fromMe={fromMe} />;
}
