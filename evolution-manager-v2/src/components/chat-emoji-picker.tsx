import * as Popover from "@radix-ui/react-popover";
import { SmilePlus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@evoapi/design-system/button";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

const emojiDataLoaders = {
  "pt-BR": () => import("emoji-picker-react/data/emojis-pt"),
  "es-ES": () => import("emoji-picker-react/data/emojis-es"),
  "fr-FR": () => import("emoji-picker-react/data/emojis-fr"),
  "en-US": () => import("emoji-picker-react/data/emojis-en"),
};

const pickerLabels = {
  "pt-BR": {
    searchPlaceholder: "Buscar emoji pelo nome",
    searchLabel: "Buscar emoji pelo nome",
    searchResultsNone: "Nenhum emoji encontrado",
    searchResultsOne: "1 emoji encontrado",
    searchResultsMany: "%n emojis encontrados",
    loading: "Carregando emojis...",
  },
  "es-ES": {
    searchPlaceholder: "Buscar emoji por nombre",
    searchLabel: "Buscar emoji por nombre",
    searchResultsNone: "No se encontraron emojis",
    searchResultsOne: "1 emoji encontrado",
    searchResultsMany: "%n emojis encontrados",
    loading: "Cargando emojis...",
  },
  "fr-FR": {
    searchPlaceholder: "Rechercher un emoji par nom",
    searchLabel: "Rechercher un emoji par nom",
    searchResultsNone: "Aucun emoji trouvé",
    searchResultsOne: "1 emoji trouvé",
    searchResultsMany: "%n emojis trouvés",
    loading: "Chargement des emojis...",
  },
  "en-US": { searchPlaceholder: "Search emoji by name", searchLabel: "Search emoji by name" },
};

type ChatEmojiPickerProps = {
  label: string;
  onSelect: (emoji: string) => void;
  onClear?: () => void;
  disabled?: boolean;
  iconColor?: string;
};

export function ChatEmojiPicker({ label, onSelect, onClear, disabled, iconColor }: ChatEmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage || i18n.language) as keyof typeof emojiDataLoaders;
  const activeLocale = locale in emojiDataLoaders ? locale : "pt-BR";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={label} disabled={disabled}>
          <SmilePlus className="h-4 w-4" style={{ color: iconColor }} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          aria-label="Selecionar emoji"
          className="z-50 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <Suspense fallback={<div className="flex h-72 w-72 items-center justify-center text-sm">Carregando emojis...</div>}>
            <EmojiPicker
              emojiData={emojiDataLoaders[activeLocale]}
              labels={pickerLabels[activeLocale]}
              width="min(320px, calc(100vw - 2rem))"
              height="min(380px, calc(100dvh - 8rem))"
              previewConfig={{ showPreview: false }}
              className="[--epr-bg-color:var(--popover)] [--epr-category-label-bg-color:var(--popover)] [--epr-text-color:var(--popover-foreground)] [--epr-hover-bg-color:var(--accent)] [--epr-focus-bg-color:var(--accent)] [--epr-search-input-bg-color:var(--background)] [--epr-search-border-color:var(--border)]"
              onEmojiClick={({ emoji }) => {
                onSelect(emoji);
                setOpen(false);
              }}
            />
          </Suspense>
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
