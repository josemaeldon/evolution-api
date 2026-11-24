import { useState } from "react";

import { useMediaSource } from "@/lib/queries/chat/useMediaSource";
import { Message } from "@/types/evolution.types";

export function ChatVideoMessage({ message, instanceName, token }: { message: Message; instanceName?: string; token?: string }) {
  const [playbackError, setPlaybackError] = useState(false);
  const { source, isPending, isError, refetch } = useMediaSource(message, instanceName, token, message.message?.videoMessage?.mimetype || "video/mp4");

  if (source && !playbackError) {
    return <video src={source} controls playsInline preload="metadata" className="max-h-[400px] max-w-full rounded-lg" style={{ maxWidth: 400 }} onError={() => setPlaybackError(true)} />;
  }

  return (
    <div className="max-w-xs rounded bg-muted p-4 text-center text-sm text-muted-foreground">
      {isPending && instanceName ? "Carregando vídeo..." : "Vídeo indisponível"}
      {isError && (
        <button type="button" className="mt-2 block w-full text-primary underline" onClick={() => refetch()}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
