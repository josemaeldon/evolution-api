import { SendButtonsDto } from '@api/dto/sendMessage.dto';

/** Keep copy codes usable when a WhatsApp client does not render native-flow buttons. */
export function buttonFallbackText(data: SendButtonsDto): string | null {
  const copyButtons = data.buttons?.filter((button) => button.type === 'copy' && button.copyCode?.trim()) ?? [];
  const urlButtons = data.buttons?.filter((button) => button.type === 'url' && button.url?.trim()) ?? [];
  if (copyButtons.length === 0) return null;

  const parts = [data.title?.trim(), data.description?.trim()].filter(Boolean);

  for (const button of copyButtons) {
    parts.push(`${button.displayText?.trim() || 'Copiar código'}:\n${button.copyCode!.trim()}`);
  }

  for (const button of urlButtons) {
    parts.push(`${button.displayText?.trim() || 'Abrir página'}:\n${button.url!.trim()}`);
  }

  if (data.footer?.trim()) parts.push(data.footer.trim());
  return parts.join('\n\n');
}
