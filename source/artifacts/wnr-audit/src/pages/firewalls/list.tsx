import { useLocation } from "wouter";
import { Link } from "wouter";
import { useListFirewalls } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Flame, Plus, Clock, AlertTriangle, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FirewallManufacturer } from "@workspace/api-client-react";

const MANUFACTURER_LABELS: Record<FirewallManufacturer, string> = {
  cisco: "Cisco",
  fortinet: "Fortinet",
  sophos: "Sophos",
  ubiquiti: "Ubiquiti",
  "tp-link": "TP-Link",
  pfsense: "pfSense",
  checkpoint: "Check Point",
  "palo-alto": "Palo Alto Networks",
  meraki: "Cisco Meraki",
  other: "Outro",
};

export default function FirewallsList() {
  const [, setLocation] = useLocation();
  const { data: firewalls, isLoading } = useListFirewalls();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Firewalls</h1>
          <p className="text-muted-foreground mt-1">
            Cadastre e audite firewalls on-premise com varreduras estilo pen-test.
          </p>
        </div>
        <Link href="/firewalls/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Cadastrar Firewall
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
      ) : !firewalls || firewalls.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Flame className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold font-display mb-2">Nenhum firewall cadastrado</h2>
            <p className="text-muted-foreground max-w-md mb-8">
              Cadastre seus firewalls (Cisco, Fortinet, Sophos, pfSense, etc.) para iniciar varreduras de segurança e identificar vulnerabilidades de configuração.
            </p>
            <Link href="/firewalls/new">
              <Button size="lg" className="h-12 px-6">
                <Plus className="mr-2 h-5 w-5" />
                Cadastrar Primeiro Firewall
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {firewalls.map((fw) => (
            <Card
              key={fw.id}
              className="overflow-hidden hover:border-primary/50 transition-colors group cursor-pointer"
              onClick={() => setLocation(`/firewalls/${fw.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 h-10 w-10 rounded-md bg-orange-500/10 flex items-center justify-center shrink-0">
                      <Flame className="h-5 w-5 text-orange-500" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                          {fw.name}
                        </h3>
                        <Badge variant="outline" className="text-xs">
                          {MANUFACTURER_LABELS[fw.manufacturer]}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                        {fw.model && <span className="font-mono">{fw.model}</span>}
                        {fw.ipAddress && (
                          <>
                            {fw.model && <span className="text-border">•</span>}
                            <span className="font-mono">{fw.ipAddress}</span>
                          </>
                        )}
                        {fw.location && (
                          <>
                            <span className="text-border">•</span>
                            <span>{fw.location}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground gap-2 pt-1">
                        {fw.lastScanAt ? (
                          <>
                            <Clock className="h-3 w-3" />
                            Última varredura{" "}
                            {format(new Date(fw.lastScanAt), "dd 'de' MMMM 'às' HH:mm", {
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
