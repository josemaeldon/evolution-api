import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@evoapi/design-system/button";

type DatePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
};

const formatDate = (date: Date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;

function parseDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? date : null;
}

export function DatePicker({ id, value, onChange, required, disabled }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = parseDate(value) || new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = parseDate(value);
    if (selected) setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const firstWeekday = (visibleMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const selectedDate = parseDate(value);

  return (
    <div ref={rootRef} className="relative">
      <Button
        id={id}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required}
        onClick={() => setOpen((current) => !current)}
        className="w-full justify-start gap-2 font-normal">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className={value ? "" : "text-muted-foreground"}>{value || "Selecione uma data"}</span>
      </Button>
      {open && (
        <div role="dialog" aria-label="Selecionar data" className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[min(19rem,calc(100vw-2rem))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => setVisibleMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold capitalize">{visibleMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
            <Button type="button" variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => setVisibleMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {["S", "T", "Q", "Q", "S", "S", "D"].map((day, index) => <span key={`${day}-${index}`} className="py-2">{day}</span>)}
            {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1);
              const selected = selectedDate?.getFullYear() === date.getFullYear() && selectedDate.getMonth() === date.getMonth() && selectedDate.getDate() === date.getDate();
              const today = new Date();
              const isToday = today.getFullYear() === date.getFullYear() && today.getMonth() === date.getMonth() && today.getDate() === date.getDate();
              return (
                <button
                  key={index + 1}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { onChange(formatDate(date)); setOpen(false); }}
                  className={`mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent ${selected ? "bg-primary text-primary-foreground hover:bg-primary/90" : isToday ? "border border-primary text-primary" : ""}`}>
                  {index + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(""); setOpen(false); }}>Limpar</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { const today = new Date(); onChange(formatDate(today)); setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setOpen(false); }}>Hoje</Button>
          </div>
        </div>
      )}
    </div>
  );
}
