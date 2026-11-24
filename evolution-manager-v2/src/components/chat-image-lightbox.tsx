import { ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { createContext, CSSProperties, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getMessageImageSrc } from "@/lib/chat-message-image";
import { api } from "@/lib/queries/api";
import { Message } from "@/types/evolution.types";

type GalleryImage = { id: string; src: string };
type GalleryContext = { open: (image: GalleryImage) => void; register: (image: GalleryImage) => void };

const ImageGalleryContext = createContext<GalleryContext | null>(null);

export function ChatImageGallery({ messages, children }: { messages: Message[]; children: ReactNode }) {
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});
  const register = useCallback((image: GalleryImage) => {
    setResolvedImages((current) => current[image.id] === image.src ? current : { ...current, [image.id]: image.src });
  }, []);
  const images = useMemo<GalleryImage[]>(
    () =>
      messages.flatMap((message) => {
        const src = getMessageImageSrc(message) || resolvedImages[message.key.id];
        return src ? [{ id: message.key.id, src }] : [];
      }),
    [messages, resolvedImages],
  );
  const activeIndex = images.findIndex((image) => image.id === selectedImage?.id);
  const activeImage = images[activeIndex] || selectedImage;

  const move = (step: number) => {
    if (activeIndex < 0) return;
    setSelectedImage(images[(activeIndex + step + images.length) % images.length]);
  };

  return (
    <ImageGalleryContext.Provider value={{ open: setSelectedImage, register }}>
      {children}
      <Dialog
        open={!!activeImage}
        onOpenChange={(open) => {
          if (!open) setSelectedImage(null);
        }}>
        <DialogContent
          className="flex h-[90vh] max-w-[95vw] items-center justify-center border-0 bg-black p-4 text-white sm:max-w-[95vw]"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(-1);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              move(1);
            }
          }}>
          <DialogTitle className="sr-only">Imagem da conversa</DialogTitle>
          {activeImage && <img src={activeImage.src} alt={activeIndex < 0 ? "Imagem citada" : `Imagem ${activeIndex + 1} de ${images.length}`} className="max-h-full max-w-full object-contain" />}
          {images.length > 1 && activeIndex >= 0 && (
            <>
              <button type="button" aria-label="Imagem anterior" onClick={() => move(-1)} className="absolute left-2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80">
                <ChevronLeft />
              </button>
              <button type="button" aria-label="Próxima imagem" onClick={() => move(1)} className="absolute right-2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80">
                <ChevronRight />
              </button>
              <span className="absolute bottom-3 text-sm text-white">
                {activeIndex + 1} / {images.length}
              </span>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ImageGalleryContext.Provider>
  );
}

export function ChatMessageImage({ message, instanceName, token, className, style }: { message: Message; instanceName?: string; token?: string; className?: string; style?: CSSProperties }) {
  const gallery = useContext(ImageGalleryContext);
  const register = gallery?.register;
  const storedSrc = getMessageImageSrc(message);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["chat", "image", instanceName, message.key?.id],
    queryFn: async () => {
      const response = await api.post<{ base64?: string; mimetype?: string }>(
        `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName!)}`,
        { message },
        token ? { headers: { apikey: token } } : undefined,
      );
      if (!response.data?.base64) throw new Error("Imagem indisponível");
      return response.data;
    },
    enabled: !storedSrc && !!instanceName && !!message.key?.id,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const mimeType = data?.mimetype || (message.messageType === "stickerMessage" ? "image/webp" : "image/jpeg");
  const src = storedSrc || (data?.base64 ? `data:${mimeType};base64,${data.base64}` : null);

  useEffect(() => {
    if (src) register?.({ id: message.key.id, src });
  }, [src, message.key.id, register]);

  if (!src) {
    return (
      <div className="rounded bg-muted p-4 max-w-xs text-center text-sm text-muted-foreground">
        {isPending && instanceName ? "Carregando imagem..." : "Imagem indisponível"}
        {isError && (
          <button type="button" className="mt-2 block w-full text-primary underline" onClick={() => refetch()}>
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        gallery?.open({ id: message.key.id, src });
      }}
      aria-label="Abrir imagem"
      className="cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <img src={src} alt="Imagem da conversa" className={className} style={style} loading="lazy" />
    </button>
  );
}
