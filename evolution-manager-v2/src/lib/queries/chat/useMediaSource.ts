import { useQuery } from "@tanstack/react-query";

import { Message } from "@/types/evolution.types";

import { api } from "../api";

type MediaResponse = { base64?: string; mimetype?: string; fileName?: string };

export function useMediaSource(message: Message, instanceName: string | undefined, token: string | undefined, fallbackMime: string) {
  const base64 = message.message?.base64;
  const storedSource = typeof base64 === "string" && base64
    ? base64.startsWith("data:") ? base64 : `data:${fallbackMime};base64,${base64}`
    : message.message?.mediaUrl;

  const query = useQuery({
    queryKey: ["chat", "media", instanceName, message.key?.id],
    queryFn: async () => {
      const response = await api.post<MediaResponse>(
        `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName!)}`,
        { message },
        token ? { headers: { apikey: token } } : undefined,
      );
      if (!response.data?.base64) throw new Error("Mídia indisponível");
      return response.data;
    },
    enabled: !storedSource && !!instanceName && !!message.key?.id,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const fetchedBase64 = query.data?.base64;
  const source = storedSource || (fetchedBase64
    ? fetchedBase64.startsWith("data:") ? fetchedBase64 : `data:${query.data?.mimetype || fallbackMime};base64,${fetchedBase64}`
    : undefined);

  return { source, isPending: query.isPending, isError: query.isError, refetch: query.refetch };
}
