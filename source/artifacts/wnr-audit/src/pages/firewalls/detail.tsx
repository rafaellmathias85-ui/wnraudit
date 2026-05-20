import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetFirewall,
  useListFirewallScans,
  useStartFirewallScan,
  useDeleteFirewall,
  getGetFirewallQueryKey,
  getListFirewallScansQueryKey,
  FirewallManufacturer,
  ScanStatus,
  type ErrorResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft, Flame, Play, Clock, CheckCircle, ExternalLink, Trash2, MapPin, Cpu, Wifi,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  pending: "Aguardando",
  running: "Em andamento",
  completed: "Concluida",
  failed: "Falha",
};

const SCAN_STATUS_VARIANT: Record<ScanStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "default",
  completed: "outline",
  failed: "destructive",
};

export default function FirewallDetail({ deviceId }: { deviceId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const { data: fw, isLoading: loadingFw } = useGetFirewall(deviceId, {
    query: { enabled: !!deviceId, queryKey: getGetFirewallQueryKey(deviceId) },
  });

  const { data: scans, isLoading: loadingScans } = useListFirewallScans(deviceId, {
    query: { enabled: !!deviceId, queryKey: getListFirewallScansQueryKey(deviceId) },
  });

  const startScan = useStartFirewallScan();
  const deleteFirewall = useDeleteFirewall();

  const handleStartScan = () => {
    startScan.mutate(
      { deviceId },
      {
        onSuccess: () => {
          toast({ title: "Varredura iniciada", description: "A auditoria do firewall foi iniciada." });
          queryClient.invalidateQueries({ queryKey: getListFirewallScansQueryKey(deviceId) });
          queryClient.invalidateQueries({ queryKey: getGetFirewallQueryKey(deviceId) });
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Erro ao iniciar",
            description: (error.data as ErrorResponse | undefined)?.error || "Nao foi possivel iniciar.",
          });
        },
      }
    );
  };

  const handleDelete = () => {
    deleteFirewall.mutate(
      { deviceId },
      {
        onSuccess: () => {
          toast({ title: "Firewall removido", description: "Dispositivo excluido com sucesso." });
          setLocation("/firewalls");
        },
        onError: () => {
          toast({ variant: "destructive", title: "Erro ao remover", description: "Nao foi possivel remover." });
        },
      }
    );
  };

  if (loadingFw) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[300px]" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!fw) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Firewall nao encontrado.</p>
        <Link href="/firewalls">
          <Button variant="link" className="mt-4">Voltar para Firewalls</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/firewalls">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-display font-bold tracking-tight">{fw.name}</h1>
            <Badge variant="outline">{MANUFACTURER_LABELS[fw.manufacturer]}</Badge>
          </div>
          {fw.model && <p className="text-muted-foreground mt-1 font-mono">{fw.model}</p>}
        </div>
        <Button
          onClick={handleStartScan}
          disabled={startScan.isPending}
          className="gap-2"
        >
          <Play className="h-4 w-4" />
          {startScan.isPending ? "Iniciando..." : "Iniciar Varredura"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {fw.ipAddress && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Wifi className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Endereco IP</p>
                <p className="font-mono font-medium">{fw.ipAddress}</p>
              </div>
            </CardContent>
          </Card>
        )}
        {fw.firmwareVersion && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Cpu className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Firmware</p>
                <p className="font-mono font-medium">{fw.firmwareVersion}</p>
              </div>
            </CardContent>
          </Card>
        )}
        {fw.location && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Localizacao</p>
                <p className="font-medium">{fw.location}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {fw.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{fw.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historico de Varreduras</CardTitle>
          <CardDescription>Auditorias CIS realizadas neste dispositivo</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingScans ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !scans || scans.length === 0 ? (
            <div className="text-center py-12">
              <Flame className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">Nenhuma varredura realizada ainda.</p>
              <Button onClick={handleStartScan} disabled={startScan.isPending} className="mt-4 gap-2">
                <Play className="h-4 w-4" />
                Iniciar Primeira Varredura
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {scans.map((scan) => (
                <div
                  key={scan.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg border hover:border-primary/50 transition-colors cursor-pointer group gap-4"
                  onClick={() => setLocation(`/firewall-scans/${scan.id}`)}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                      {scan.status === ScanStatus.completed ? (
                        <CheckCircle className="h-4 w-4 text-success" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant={SCAN_STATUS_VARIANT[scan.status]} className="text-xs">
                          {SCAN_STATUS_LABEL[scan.status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(scan.startedAt), "dd 'de' MMM 'de' yyyy 'as' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                  {scan.status === ScanStatus.completed && (
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className="font-bold text-success">{scan.passedChecks}</p>
                        <p className="text-xs text-muted-foreground">Aprovados</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-destructive">{scan.failedChecks}</p>
                        <p className="text-xs text-muted-foreground">Reprovados</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end pt-4 border-t">
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <Button variant="ghost" className="text-destructive hover:text-destructive gap-2" onClick={() => setIsDeleteDialogOpen(true)}>
            <Trash2 className="h-4 w-4" />
            Remover Firewall
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remover Firewall</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja remover <strong>{fw.name}</strong>? Todos os historicos de varredura serao excluidos permanentemente.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteFirewall.isPending}>
                {deleteFirewall.isPending ? "Removendo..." : "Remover"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
