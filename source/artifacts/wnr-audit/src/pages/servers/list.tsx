import { useLocation } from "wouter";
import { Link } from "wouter";
import { useListServers } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { HardDrive, Plus, Clock, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ServerOs } from "@workspace/api-client-react";

const OS_LABELS: Record<ServerOs, string> = {
  "windows-server": "Windows Server",
  ubuntu: "Ubuntu Linux",
  debian: "Debian Linux",
  rhel: "Red Hat Enterprise Linux",
  centos: "CentOS",
  "rocky-linux": "Rocky Linux",
  suse: "SUSE Linux",
  other: "Outro",
};

const OS_COLORS: Record<ServerOs, string> = {
  "windows-server": "bg-blue-500/10 text-blue-600",
  ubuntu: "bg-orange-500/10 text-orange-600",
  debian: "bg-red-500/10 text-red-600",
  rhel: "bg-red-700/10 text-red-700",
  centos: "bg-purple-500/10 text-purple-600",
  "rocky-linux": "bg-green-500/10 text-green-600",
  suse: "bg-green-700/10 text-green-700",
  other: "bg-muted text-muted-foreground",
};

export default function ServersList() {
  const [, setLocation] = useLocation();
  const { data: servers, isLoading } = useListServers();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Servidores On-Premise</h1>
          <p className="text-muted-foreground mt-1">
            Cadastre e audite servidores Windows e Linux com varreduras de vulnerabilidade.
          </p>
        </div>
        <Link href="/servers/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Cadastrar Servidor
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-[200px]" />
                    <Skeleton className="h-4 w-[150px]" />
                  </div>
                  <Skeleton className="h-8 w-[100px]" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !servers || servers.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <HardDrive className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold font-display mb-2">Nenhum servidor cadastrado</h2>
            <p className="text-muted-foreground max-w-md mb-8">
              Cadastre seus servidores Windows Server ou Linux para identificar vulnerabilidades de configuracao, patches pendentes e riscos de seguranca.
            </p>
            <Link href="/servers/new">
              <Button size="lg" className="h-12 px-6">
                <Plus className="mr-2 h-5 w-5" />
                Cadastrar Primeiro Servidor
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {servers.map((srv) => (
            <Card
              key={srv.id}
              className="overflow-hidden hover:border-primary/50 transition-colors group cursor-pointer"
              onClick={() => setLocation(`/servers/${srv.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <HardDrive className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                          {srv.name}
                        </h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OS_COLORS[srv.os]}`}>
                          {OS_LABELS[srv.os]}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap font-mono">
                        <span>{srv.hostname}</span>
                        {srv.ipAddress && (
                          <>
                            <span className="text-border">•</span>
                            <span>{srv.ipAddress}</span>
                          </>
                        )}
                        {srv.role && (
                          <>
                            <span className="text-border">•</span>
                            <span className="font-sans">{srv.role}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground gap-2 pt-1">
                        {srv.lastScanAt ? (
                          <>
                            <Clock className="h-3 w-3" />
                            Ultima varredura{" "}
                            {format(new Date(srv.lastScanAt), "dd 'de' MMMM 'as' HH:mm", {
                              locale: ptBR,
                            })}
                          </>
                        ) : (
                          <span className="italic">Nenhuma varredura realizada ainda</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors hidden sm:block" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
