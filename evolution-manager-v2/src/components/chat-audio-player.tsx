import { Mic, Pause, Play } from "lucide-react";
import { useRef, useState } from "react";

type ChatAudioPlayerProps = {
  src: string;
  seconds?: number;
};

const SPEEDS = [1, 1.5, 2] as const;
const WAVE_BARS = Array.from({ length: 38 }, (_, index) => 7 + ((index * 13 + index * index * 7) % 18));

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function ChatAudioPlayer({ src, seconds }: ChatAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number(seconds) || 0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [error, setError] = useState(false);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setError(true);
      }
    } else {
      audio.pause();
    }
  };

  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const seek = (value: number) => {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  const progress = duration ? Math.min(currentTime / duration, 1) : 0;

  return (
    <div className="flex w-[19rem] max-w-full items-center gap-3 rounded-xl bg-background/80 px-3 py-2 text-foreground shadow-sm">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setDuration(value);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => {
          setPlaying(false);
          setError(true);
        }}
      />
      <button
        type="button"
        onClick={togglePlayback}
        disabled={error}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
        {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative flex h-7 items-center gap-[2px]">
          {WAVE_BARS.map((height, index) => (
            <span
              key={index}
              className={`min-w-0 flex-1 rounded-full ${index / WAVE_BARS.length <= progress ? "bg-primary" : "bg-foreground/30"}`}
              style={{ height }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(currentTime, duration || 1)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Posição do áudio"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100"
          />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{error ? "Áudio indisponível" : formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <Mic className="h-4 w-4 text-primary" aria-hidden="true" />
        <button
          type="button"
          onClick={changeSpeed}
          aria-label={`Velocidade ${speed} vezes. Alterar velocidade`}
          className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-semibold hover:bg-foreground/20">
          {speed}×
        </button>
      </div>
    </div>
  );
}
