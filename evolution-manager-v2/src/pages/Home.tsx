import { Button } from "@evoapi/design-system/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@evoapi/design-system/card";
import { Badge } from "@evoapi/design-system/badge";
import { ArrowRight, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/components/theme-provider";
import { ModeToggle } from "@/components/mode-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { CLOUD_BR_CHAT_LOGO, CLOUD_BR_CHAT_LOGO_DARK } from "@/lib/branding";

export default function Home() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const logoSrc = theme === "dark" ? CLOUD_BR_CHAT_LOGO_DARK : CLOUD_BR_CHAT_LOGO;

  const handleGoToManager = () => {
    navigate("/manager");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header with theme toggle */}
      <header className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center">
          <img
            src={logoSrc}
            alt="CloudBR Chat"
            className="h-10 w-auto"
          />
        </div>
        <div className="flex items-center gap-4">
          <LanguageToggle />
          <ModeToggle />
        </div>
      </header>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center mb-6">
              <img
                src={logoSrc}
                alt="CloudBR Chat"
                className="h-14 w-auto"
              />
            </div>
            <h1 className="text-4xl font-bold text-foreground mb-4">
              CloudBR Chat
            </h1>
            <p className="text-xl text-muted-foreground mb-6">
              Gerencie suas conversas e instâncias WhatsApp em um só lugar
            </p>
            <Badge variant="secondary" className="text-sm px-3 py-1">
              Version 2.0.0
            </Badge>
          </div>

          {/* Main Card */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Bem-vindo ao CloudBR Chat
              </CardTitle>
              <CardDescription>
                Acompanhe conversas, configure integrações e gerencie suas instâncias WhatsApp.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="pt-6 border-t border-border">
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                  <Button
                    onClick={handleGoToManager}
                    size="lg"
                    className="px-8 py-3"
                  >
                    Acessar painel
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="text-center mt-12 text-sm text-muted-foreground">
            <p>© {new Date().getFullYear()} CloudBR Chat</p>
          </div>
        </div>
      </div>
    </div>
  );
}
