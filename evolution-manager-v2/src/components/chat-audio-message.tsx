import { useQuery } from "@tanstack/react-query";

import { ChatAudioPlayer } from "@/components/chat-audio-player";
import { api } from "@/lib/queries/api";
import { Message } from "@/types/evolution.types";

type ChatAudioMessageProps = {
  message: Message;
  instanceName?: string;
  token?: string;
};

type MediaResponse = {
  base64?: string;
  mimetype?: string;
};

export function ChatAudioMessage({ message, instanceName, token }: ChatAudioMessageProps) {
  const audio = message.message;
  const storedSource = audio?.base64
    ? audio.base64.startsWith("data:")
      ? audio.base64
      : `data:${audio.audioMessage?.mimetype || "audio/ogg"};base64,${audio.base64}`
    : audio?.mediaUrl;

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["chat", "audio", instanceName, message.key?.id],
    queryFn: async () => {
      const response = await api.post<MediaResponse>(
        `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName!)}`,
        { message },
        token ? { headers: { apikey: token } } : undefined,
      );
      if (!response.data?.base64) throw new Error("Áudio indisponível");
      return response.data;
    },
    enabled: !storedSource && !!instanceName && !!message.key?.id,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const source = storedSource || (data?.base64 ? `data:${data.mimetype || audio?.audioMessage?.mimetype || "audio/ogg"};base64,${data.base64}` : undefined);

  if (source) return <ChatAudioPlayer src={source} seconds={audio?.audioMessage?.seconds} />;

  return (
    <div className="rounded bg-muted p-4 max-w-xs text-center text-sm text-muted-foreground">
      {isPending && instanceName ? "Carregando áudio..." : "Áudio indisponível"}
      {isError && (
        <button type="button" className="mt-2 block w-full text-primary underline" onClick={() => refetch()}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
