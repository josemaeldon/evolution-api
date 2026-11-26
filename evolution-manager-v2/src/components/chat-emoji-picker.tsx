import * as Popover from "@radix-ui/react-popover";
import { SmilePlus } from "lucide-react";
import { useState } from "react";

import { Button } from "@evoapi/design-system/button";

const emojiGroups = [
  { label: "Frequentes", emojis: ["👍", "❤️", "😂", "😮", "😢", "🙏", "😀", "😊", "🔥", "🎉", "👏", "😍"] },
  { label: "Rostos", emojis: ["😃", "😄", "😁", "😆", "😅", "🤣", "😉", "🥰", "😘", "😎", "🤔", "😴", "😡", "😭", "🥺", "🤩"] },
  { label: "Gestos", emojis: ["👎", "👌", "✌️", "🤞", "🤝", "👋", "🙌", "💪", "🫶", "👀", "✅", "💯"] },
  { label: "Símbolos", emojis: ["🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "⭐", "✨", "⚠️", "❌"] },
  { label: "Outros", emojis: ["🌸", "🌹", "🌻", "🌞", "🌈", "🍀", "🍕", "🍎", "☕", "⚽", "🚗", "🎁"] },
];

type ChatEmojiPickerProps = {
  label: string;
  onSelect: (emoji: string) => void;
  onClear?: () => void;
  disabled?: boolean;
};

export function ChatEmojiPicker({ label, onSelect, onClear, disabled }: ChatEmojiPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={label} disabled={disabled}>
          <SmilePlus className="h-4 w-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} aria-label="Selecionar emoji" className="z-50 max-h-72 w-72 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
          {emojiGroups.map((group) => (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">{group.label}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded text-xl hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Selecionar ${emoji}`}
                    onClick={() => {
                      onSelect(emoji);
                      setOpen(false);
                    }}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {onClear && (
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
              onClick={() => {
                onClear();
                setOpen(false);
              }}>
              Remover reação
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
