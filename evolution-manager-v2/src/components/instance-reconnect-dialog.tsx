import { Button } from "@evoapi/design-system/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LoaderCircle, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { useTranslation } from "react-i18next";

import { Instance } from "@/types/evolution.types";
import { useManageInstance } from "@/lib/queries/instance/manageInstance";

interface InstanceReconnectDialogProps {
  instance: Instance;
}

export function InstanceReconnectDialog({ instance }: InstanceReconnectDialogProps) {
  const { t } = useTranslation();
  const { connect } = useManageInstance();
  const [open, setOpen] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [loading, setLoading] = useState(false);
  const isGo = instance.integration === "EVOLUTION_GO";

  useEffect(() => {
    if (!open || instance.connectionStatus !== "close") return;

    let cancelled = false;
    setLoading(true);
    setQrCode("");
    connect({ instanceName: instance.name, token: instance.token })
      .then((result) => {
        if (cancelled) return;
        const data = result?.data ?? result;
        const code = isGo
          ? data?.base64 ?? data?.Qrcode ?? data?.qrcode
          : typeof data === "string"
            ? data
            : data?.code ?? data?.qrcode ?? data?.base64 ?? data?.pairingCode;
        setQrCode(typeof code === "string" ? code : "");
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error("Could not generate instance QR code:", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connect, instance.connectionStatus, instance.name, instance.token, isGo, open]);

  const qrImage = qrCode.startsWith("data:image/");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full" disabled={instance.connectionStatus !== "close"}>
          <QrCode className="mr-2 h-4 w-4" />
          {t("instance.dashboard.button.qrcode.label", { defaultValue: "Gerar QR Code e reconectar" })}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("instance.dashboard.button.qrcode.title", { defaultValue: "Reconectar ao WhatsApp" })}</DialogTitle>
          <DialogDescription>{instance.profileName || instance.name}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-64 items-center justify-center py-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
              <LoaderCircle className="h-8 w-8 animate-spin" />
              {t("qrCode.generating", { defaultValue: "Gerando QR Code..." })}
            </div>
          ) : qrCode ? (
            qrImage ? <img src={qrCode} alt="QR Code para reconectar ao WhatsApp" className="max-h-64 max-w-64" /> :
              <QRCode value={qrCode} size={256} />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              {t("qrCode.description", { defaultValue: "Não foi possível gerar o QR Code. Feche e tente novamente." })}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
