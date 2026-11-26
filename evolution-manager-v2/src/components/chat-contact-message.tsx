import { Phone, UserRound } from "lucide-react";

type Contact = { displayName?: string; vcard?: string } | null | undefined;

function contactDetails(contact: Contact) {
  const lines = (contact?.vcard || "").replace(/\r\n?/g, "\n").split("\n");
  const fullName = lines
    .find((line) => /^FN:/i.test(line))
    ?.slice(3)
    .trim();
  const name = contact?.displayName?.trim() || fullName || "Contato";
  const numbers = lines
    .filter((line) => /^(?:item\d+\.)?TEL(?:;[^:]*)?:/i.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim())
    .filter(Boolean);

  return { name, numbers: [...new Set(numbers)] };
}

export function ChatContactMessage({ contact }: { contact: Contact; fromMe?: boolean }) {
  const { name, numbers } = contactDetails(contact);

  return (
    <div className="flex min-w-0 max-w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" aria-hidden="true">
        <UserRound className="h-5 w-5" />
      </span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Contato</p>
        <p className="break-words font-semibold">{name}</p>
        {numbers.map((number) => {
          const dialNumber = number.replace(/[^\d+]/g, "");
          return dialNumber ? (
            <a
              key={number}
              href={`tel:${dialNumber}`}
              className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-200">
              <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-all">{number}</span>
            </a>
          ) : null;
        })}
      </div>
    </div>
  );
}
