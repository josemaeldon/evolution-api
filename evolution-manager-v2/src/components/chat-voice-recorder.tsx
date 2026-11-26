import { Mic, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@evoapi/design-system/button";

type ChatVoiceRecorderProps = {
  disabled?: boolean;
  onActiveChange: (active: boolean) => void;
  onSend: (audio: Blob) => Promise<void>;
};

export function ChatVoiceRecorder({ disabled, onActiveChange, onSend }: ChatVoiceRecorderProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const clear = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    releaseStream();
    recorderRef.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setAudio(null);
    setRecording(false);
    setElapsed(0);
    setError(null);
    onActiveChange(false);
  };

  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Gravação não disponível neste navegador");
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        releaseStream();
        const recorded = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!recorded.size) {
          setError("A gravação ficou vazia. Tente novamente.");
          onActiveChange(false);
          return;
        }
        const url = URL.createObjectURL(recorded);
        previewUrlRef.current = url;
        setAudio(recorded);
        setPreviewUrl(url);
      };
      recorder.start();
      setRecording(true);
      setElapsed(0);
      onActiveChange(true);
      timerRef.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    } catch {
      releaseStream();
      setError("Não foi possível acessar o microfone.");
      onActiveChange(false);
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  };

  const send = async () => {
    if (!audio || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(audio);
      clear();
    } catch {
      setError("Não foi possível enviar o áudio. Tente novamente.");
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  if (!recording && !audio) {
    return (
      <div className="flex items-center gap-1">
        {error && <span role="alert" className="max-w-40 text-xs text-destructive">{error}</span>}
        <Button type="button" size="icon" variant="ghost" disabled={disabled} onClick={start} aria-label="Gravar áudio" className="h-9 w-9 shrink-0 rounded-full">
          <Mic className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button type="button" size="icon" variant="ghost" disabled={sending} onClick={clear} aria-label="Descartar gravação" className="h-9 w-9 shrink-0">
        <Trash2 className="h-4 w-4" />
      </Button>
      {recording ? (
        <>
          <span className="flex-1 text-sm text-destructive">● Gravando {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, "0")}</span>
          <Button type="button" size="icon" onClick={stop} aria-label="Parar gravação" className="h-9 w-9 shrink-0"><Square className="h-4 w-4" /></Button>
        </>
      ) : (
        <>
          <audio controls src={previewUrl || undefined} className="h-9 min-w-0 flex-1" />
          <Button type="button" size="icon" disabled={sending} onClick={send} aria-label="Enviar gravação" className="h-9 w-9 shrink-0"><Send className="h-4 w-4" /></Button>
        </>
      )}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
