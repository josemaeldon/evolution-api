import { Avatar, AvatarImage } from "@evoapi/design-system/avatar";
import { Button } from "@evoapi/design-system/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@evoapi/design-system/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardList, LayoutDashboard, LogOut, Menu, MessageCircle, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useFetchInstance } from "@/lib/queries/instance/fetchInstance";
import { logout } from "@/lib/queries/token";
import { CLOUD_BR_CHAT_MARK } from "@/lib/branding";
import { signOutManager, useManagerAccount } from "@/lib/queries/saas";

import { LanguageToggle } from "./language-toggle";
import { ModeToggle } from "./mode-toggle";

function Header({ instanceId }: { instanceId?: string }) {
  const { t } = useTranslation();
  const [logoutConfirmation, setLogoutConfirmation] = useState(false);
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
    </header>
  );
}

export { Header };
