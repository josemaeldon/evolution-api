import { Avatar, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@evoapi/design-system/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Bell, CalendarDays, ClipboardList, CreditCard, LayoutDashboard, LogOut, Menu, MessageCircle, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useFetchInstance } from "@/lib/queries/instance/fetchInstance";
import { saasApi } from "@/lib/queries/saas";
import { logout } from "@/lib/queries/token";
import { CLOUD_BR_CHAT_MARK } from "@/lib/branding";
import { signOutManager, useManagerAccount } from "@/lib/queries/saas";
import { isFeatureEnabled } from "@/lib/provider/features";

import { LanguageToggle } from "./language-toggle";
import { ModeToggle } from "./mode-toggle";

const localDateKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const toPickerDate = (date: string) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "");
const fromPickerDate = (date: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
};

function Header({ instanceId }: { instanceId?: string }) {
  const { t } = useTranslation();
  const [logoutConfirmation, setLogoutConfirmation] = useState(false);
  const [birthdaySearchOpen, setBirthdaySearchOpen] = useState(false);
  const [birthdaySearchDate, setBirthdaySearchDate] = useState(localDateKey);
  const navigate = useNavigate();

  const handleClose = async () => {
    if (localStorage.getItem("managerSaas") === "company") {
      try {
        await signOutManager();
      } catch {
        // The local session must be cleared even when the server is unavailable.
      }
    }
    logout();
    navigate("/manager/login", { replace: true });
    window.location.reload();
  };

  const { data: instance } = useFetchInstance({ instanceId });
  const { data: account } = useManagerAccount();
  const role = account?.role;
  const localDate = localDateKey();
  const { data: birthdayNotifications } = useQuery<{ date: string; contacts: { id: string; name: string; remoteJid: string }[] }>({
    queryKey: ["birthdayReminders", instanceId, localDate],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instanceId}/birthdays?date=${localDate}`)).data,
    enabled: !!instanceId,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: true,
  });
  const birthdayContacts = birthdayNotifications?.date === localDate ? birthdayNotifications.contacts : [];
  const { data: birthdaySearchResults, isFetching: birthdaySearchLoading } = useQuery<{ date: string; contacts: { id: string; name: string; remoteJid: string }[] }>({
    queryKey: ["birthdayLookup", instanceId, birthdaySearchDate],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instanceId}/birthdays?date=${birthdaySearchDate}`)).data,
    enabled: !!instanceId && birthdaySearchOpen,
  });

  return (
    <header className="flex h-16 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 shadow-sm md:justify-end">
      {instanceId && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="text-sidebar-foreground md:hidden" aria-label="Abrir menu">
              <Menu className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => navigate("/manager")}>
              <LayoutDashboard className="mr-2 h-4 w-4" /> Instâncias
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/manager/instance/${instanceId}/chat`)}>
              <MessageCircle className="mr-2 h-4 w-4" /> Chat
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/manager/instance/${instanceId}/forms`)}>
              <ClipboardList className="mr-2 h-4 w-4" /> Formulários
            </DropdownMenuItem>
            {role !== "user" && isFeatureEnabled("charges") && (
              <DropdownMenuItem onClick={() => navigate(`/manager/instance/${instanceId}/charges`)}>
                <CreditCard className="mr-2 h-4 w-4" /> Cobranças
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="flex items-center gap-2">
        {instanceId && instance && (
          <div className="mr-2 flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-3 py-1.5">
            <Avatar className="h-6 w-6">
              <AvatarImage src={instance.profilePicUrl || CLOUD_BR_CHAT_MARK} alt={instance.name} />
            </Avatar>
            <span className="text-sm font-medium text-sidebar-foreground">{instance.profileName || instance.name}</span>
          </div>
        )}
        <LanguageToggle />
        <ModeToggle />
        {instanceId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="relative text-sidebar-foreground" aria-label={`Aniversariantes de hoje: ${birthdayContacts.length}`} title="Aniversariantes de hoje">
                <Bell className="h-4 w-4" />
                {birthdayContacts.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                    {birthdayContacts.length > 99 ? "99+" : birthdayContacts.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Aniversariantes de hoje</span>
                {birthdayContacts.length > 0 && <span className="text-xs font-normal text-muted-foreground">{birthdayContacts.length}</span>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {birthdayContacts.length ? (
                <div className="max-h-72 overflow-y-auto py-1">
                  {birthdayContacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{contact.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{contact.remoteJid.split("@")[0]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-3 text-sm text-muted-foreground">Nenhum contato faz aniversário hoje.</p>
              )}
              {birthdayContacts.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate(`/manager/instance/${instanceId}/labels`)}>
                    Ver etiqueta de aniversariantes
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setBirthdaySearchOpen(true)}>
                <CalendarDays className="mr-2 h-4 w-4" /> Ver aniversariantes em outra data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-2 text-sidebar-foreground hover:bg-sidebar-accent">
              <UserRound className="h-4 w-4" />
              {t("header.profile.action")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{account?.name || t("header.profile.fallback")}</span>
                {account?.email && <span className="break-all text-xs text-muted-foreground">{account.email}</span>}
                {role && <span className="text-xs text-muted-foreground">{t(`header.profile.roles.${role}`)}</span>}
                {account?.company?.name && <span className="text-xs text-muted-foreground">{account.company.name}</span>}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setLogoutConfirmation(true)}>
              <LogOut className="mr-2 h-4 w-4" />
              {t("header.logout.action")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog onOpenChange={setLogoutConfirmation} open={logoutConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("header.logout.title")}</DialogTitle>
            <DialogDescription>{t("header.logout.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <div className="flex items-center gap-4">
              <Button onClick={() => setLogoutConfirmation(false)} size="sm" variant="outline">
                {t("button.cancel")}
              </Button>
              <Button onClick={handleClose} variant="destructive">
                {t("header.logout.action")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={birthdaySearchOpen} onOpenChange={setBirthdaySearchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Consultar aniversariantes</DialogTitle>
            <DialogDescription>Escolha uma data para verificar quais contatos fazem aniversário.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label htmlFor="birthday-search-date" className="text-sm font-medium">Data</label>
            <DatePicker
              id="birthday-search-date"
              value={toPickerDate(birthdaySearchDate)}
              onChange={(value) => setBirthdaySearchDate(fromPickerDate(value) || localDateKey())}
            />
            {birthdaySearchLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Buscando aniversariantes…</p>
            ) : birthdaySearchResults?.date === birthdaySearchDate && birthdaySearchResults.contacts.length ? (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                {birthdaySearchResults.contacts.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0">
                    <span className="min-w-0 truncate font-medium">{contact.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{contact.remoteJid.split("@")[0]}</span>
                  </div>
                ))}
              </div>
            ) : birthdaySearchResults?.date === birthdaySearchDate ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum contato faz aniversário nessa data.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}

export { Header };
