import { SendButtonsDto } from '@api/dto/sendMessage.dto';

/** Keep copy codes visible when a WhatsApp client does not render native-flow buttons. */
export function copyCodeFallback(data: SendButtonsDto): string | null {
  const copyButtons = data.buttons?.filter((button) => button.type === 'copy' && button.copyCode?.trim()) ?? [];
  if (copyButtons.length === 0) return null;

  const parts = [data.title?.trim(), data.description?.trim()].filter(Boolean);

  for (const button of copyButtons) {
    parts.push(`${button.displayText?.trim() || 'Copiar código'}:\n${button.copyCode!.trim()}`);
  }

  for (const button of data.buttons) {
    if (button.type === 'url' && button.url?.trim()) {
      parts.push(`${button.displayText?.trim() || 'Abrir página'}:\n${button.url.trim()}`);
    }
  }

  if (data.footer?.trim()) parts.push(data.footer.trim());
  return parts.join('\n\n');
}
