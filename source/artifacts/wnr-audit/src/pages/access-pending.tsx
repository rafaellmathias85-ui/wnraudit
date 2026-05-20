import { useClerk, useUser } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Clock, LogOut, Mail } from "lucide-react";

export default function AccessPending({ status }: { status: "pending" | "blocked" }) {
  const { signOut } = useClerk();
  const { user } = useUser();

  const isBlocked = status === "blocked";

  return (
    <div className="min-h-screen bg-muted/20 flex items-center justify-center p-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            {isBlocked ? (
              <Shield className="h-7 w-7 text-destructive" />
            ) : (
              <Clock className="h-7 w-7 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-display">
            {isBlocked ? "Conta bloqueada" : "Aguardando aprovação"}
          </CardTitle>
          <CardDescription className="text-base">
            {isBlocked
              ? "Seu acesso ao WNR-Audit foi suspenso. Entre em contato com o administrador para reativar."
              : "Sua conta foi criada com sucesso. Para começar a usar o WNR-Audit, é necessário a aprovação de um administrador."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-4 space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Conta solicitada
            </p>
            <p className="font-medium flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {user?.primaryEmailAddress?.emailAddress}
            </p>
            {user?.fullName && (
              <p className="text-sm text-muted-foreground">{user.fullName}</p>
            )}
          </div>

          {!isBlocked && (
            <p className="text-sm text-muted-foreground text-center">
              Você receberá acesso assim que um administrador aprovar sua solicitação.
            </p>
          )}

          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
