import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [yearInput, setYearInput] = useState(() => String((parseDate(value) || new Date()).getFullYear()));
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 8 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = parseDate(value);
    if (selected) {
      setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
      setYearInput(String(selected.getFullYear()));
    }
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = window.visualViewport?.width || window.innerWidth;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const viewportTop = window.visualViewport?.offsetTop || 0;
      const width = Math.min(popoverRect.width, viewportWidth - margin * 2);
      const height = Math.min(popoverRect.height, viewportHeight - margin * 2);
      const left = Math.max(margin, Math.min(triggerRect.left, viewportWidth - width - margin));
      const below = viewportTop + viewportHeight - triggerRect.bottom;
      const above = triggerRect.top - viewportTop;
      const top =
        below >= height + margin || below >= above
          ? Math.min(triggerRect.bottom + margin, viewportTop + viewportHeight - height - margin)
          : Math.max(viewportTop + margin, triggerRect.top - height - margin);

      setPopoverPosition({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open, visibleMonth]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
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
    <div className="w-full">
      <Button
        ref={triggerRef}
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
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Selecionar data"
            className="fixed z-[100] max-h-[calc(100dvh-1rem)] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
            style={{ top: popoverPosition.top, left: popoverPosition.left }}>
            <div className="mb-3 flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Mês anterior"
                onClick={() => {
                  const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
                  setVisibleMonth(date);
                  setYearInput(String(date.getFullYear()));
                }}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <select
                aria-label="Mês"
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                value={visibleMonth.getMonth()}
                onChange={(event) => setVisibleMonth(new Date(visibleMonth.getFullYear(), Number(event.target.value), 1))}>
                {Array.from({ length: 12 }, (_, month) => (
                  <option key={month} value={month}>
                    {new Date(2024, month, 1).toLocaleDateString("pt-BR", { month: "long" })}
                  </option>
                ))}
              </select>
              <input
                aria-label="Ano"
                className="h-9 w-[5.25rem] rounded-md border bg-background px-2 text-center text-sm"
                type="number"
                inputMode="numeric"
                min={1}
                max={9999}
                value={yearInput}
                onChange={(event) => setYearInput(event.target.value.slice(0, 4))}
                onBlur={() => {
                  const year = Number(yearInput);
                  if (!Number.isInteger(year) || year < 1 || year > 9999) {
                    setYearInput(String(visibleMonth.getFullYear()));
                    return;
                  }
                  setVisibleMonth(new Date(year, visibleMonth.getMonth(), 1));
                  setYearInput(String(year));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Próximo mês"
                onClick={() => {
                  const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
                  setVisibleMonth(date);
                  setYearInput(String(date.getFullYear()));
                }}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid w-full grid-cols-7 text-center text-xs text-muted-foreground">
              {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((day) => (
                <span key={day} className="py-2" aria-label={day}>
                  {day}
                </span>
              ))}
              {Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
                const day = index - firstWeekday + 1;
                if (day < 1 || day > daysInMonth) {
                  return <span key={`empty-${index}`} aria-hidden="true" />;
                }

                const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
                const selected =
                  selectedDate?.getFullYear() === date.getFullYear() &&
                  selectedDate.getMonth() === date.getMonth() &&
                  selectedDate.getDate() === date.getDate();
                const today = new Date();
                const isToday =
                  today.getFullYear() === date.getFullYear() &&
                  today.getMonth() === date.getMonth() &&
                  today.getDate() === date.getDate();

                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={date.toLocaleDateString("pt-BR", { dateStyle: "full" })}
                    aria-pressed={selected}
                    onClick={() => {
                      onChange(formatDate(date));
                      setOpen(false);
                    }}
                    className={`mx-auto flex h-9 w-full max-w-9 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent ${selected ? "bg-primary text-primary-foreground hover:bg-primary/90" : isToday ? "border border-primary text-primary" : ""}`}>
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}>
                Limpar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const today = new Date();
                  onChange(formatDate(today));
                  setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                  setYearInput(String(today.getFullYear()));
                  setOpen(false);
                }}>
                Hoje
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
