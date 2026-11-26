import React from "react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";

import { Header } from "@/components/header";
import { InstanceSidebar } from "@/components/sidebar";

import { InstanceProvider } from "@/contexts/InstanceContext";
import { useInstance } from "@/contexts/InstanceContext";
import { saasApi } from "@/lib/queries/saas";

interface LayoutProps {
  children: React.ReactNode;
}

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function BirthdayReminders() {
  const { instance } = useInstance();
  const today = localDateKey(new Date());
  const { data } = useQuery<{ date: string; contacts: { id: string; name: string }[] }>({
    queryKey: ["birthdayReminders", instance?.id, today],
    queryFn: async () => (await saasApi.get(`/saas/instance/${instance?.id}/birthdays?date=${today}`)).data,
    enabled: !!instance?.id,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!instance?.id || data?.date !== today || !data.contacts.length) return;
    const storageKey = `birthday-reminder:${instance.id}:${today}`;
    try {
      if (window.localStorage.getItem(storageKey)) return;
      const names = data.contacts.map((contact) => contact.name);
      const visibleNames = names.slice(0, 5).join(", ");
      const extra = names.length > 5 ? ` e mais ${names.length - 5}` : "";
      toast.info(`Aniversário${names.length > 1 ? "s" : ""} hoje: ${visibleNames}${extra}. Lembre-se de enviar uma mensagem de parabéns.`, {
        autoClose: 15_000,
        toastId: storageKey,
      });
      window.localStorage.setItem(storageKey, "notified");
    } catch {
      // Keep birthday reminders available even if local storage is blocked.
    }
  }, [data, instance?.id, today]);

  return null;
}

function InstanceLayout({ children }: LayoutProps) {
  const { instanceId } = useParams<{ instanceId: string }>();

  return (
    <InstanceProvider>
      <div className="flex h-screen bg-background">
        <BirthdayReminders />
        <InstanceSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header instanceId={instanceId} />
          <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </InstanceProvider>
  );
}

export { InstanceLayout };
