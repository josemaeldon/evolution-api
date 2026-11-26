import { Phone, UserRound } from "lucide-react";

type Contact = { displayName?: string; vcard?: string } | null | undefined;

function contactDetails(contact: Contact) {
  const lines = (contact?.vcard || "").replace(/\r\n?/g, "\n").split("\n");
  const fullName = lines.find((line) => /^FN:/i.test(line))?.slice(3).trim();
  const name = contact?.displayName?.trim() || fullName || "Contato";
  const numbers = lines
    .filter((line) => /^TEL(?:;[^:]*)?:/i.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim())
    .filter(Boolean);

  return { name, numbers: [...new Set(numbers)] };
}

export function ChatContactMessage({ contact, fromMe = false }: { contact: Contact; fromMe?: boolean }) {
  const { name, numbers } = contactDetails(contact);

  return (
    <div className={`flex min-w-0 max-w-full items-start gap-3 rounded-lg p-3 ${fromMe ? "bg-emerald-500/10" : "bg-muted"}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/70" aria-hidden="true">
        <UserRound className="h-5 w-5" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">Contato</p>
        <p className="break-words font-medium">{name}</p>
        {numbers.map((number) => {
          const dialNumber = number.replace(/[^\d+]/g, "");
          return dialNumber ? (
            <a key={number} href={`tel:${dialNumber}`} className="flex min-w-0 items-center gap-1.5 break-all text-sm text-primary hover:underline">
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {number}
            </a>
          ) : null;
        })}
      </div>
    </div>
  );
}
