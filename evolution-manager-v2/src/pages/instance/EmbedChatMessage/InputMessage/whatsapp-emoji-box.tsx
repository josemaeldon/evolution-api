import { ChatEmojiPicker } from "@/components/chat-emoji-picker";
import { useEmbedColors } from "@/contexts/EmbedColorsContext";

interface WhatsAppEmojiBoxProps {
  handleEmojiClick: (emoji: string) => void;
}

export default function WhatsAppEmojiBox({ handleEmojiClick }: WhatsAppEmojiBoxProps) {
  const { inputIconsMainColor } = useEmbedColors();

  return <ChatEmojiPicker label="Inserir emoji" onSelect={handleEmojiClick} iconColor={inputIconsMainColor} />;
}
