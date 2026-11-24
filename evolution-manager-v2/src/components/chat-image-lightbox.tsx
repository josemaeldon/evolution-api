import { ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, CSSProperties, ReactNode, useContext, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getMessageImageSrc } from "@/lib/chat-message-image";
import { Message } from "@/types/evolution.types";

type GalleryImage = { id: string; src: string };
type GalleryContext = { open: (image: GalleryImage) => void };

const ImageGalleryContext = createContext<GalleryContext | null>(null);

export function ChatImageGallery({ messages, children }: { messages: Message[]; children: ReactNode }) {
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const images = useMemo<GalleryImage[]>(
    () =>
      messages.flatMap((message) => {
        const src = getMessageImageSrc(message);
        return src ? [{ id: message.key.id, src }] : [];
      }),
    [messages],
  );
  const activeIndex = images.findIndex((image) => image.id === selectedImage?.id);
  const activeImage = images[activeIndex] || selectedImage;

  const move = (step: number) => {
    if (activeIndex < 0) return;
    setSelectedImage(images[(activeIndex + step + images.length) % images.length]);
  };

  return (
    <ImageGalleryContext.Provider value={{ open: setSelectedImage }}>
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

export function ChatMessageImage({ message, className, style }: { message: Message; className?: string; style?: CSSProperties }) {
  const gallery = useContext(ImageGalleryContext);
  const src = getMessageImageSrc(message);
  if (!src) return null;

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
