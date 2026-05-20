import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetServer,
  useListServerScans,
  useStartServerScan,
  useDeleteServer,
  getGetServerQueryKey,
  getListServerScansQueryKey,
  ServerOs,
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
  ArrowLeft, HardDrive, Play, Clock, CheckCircle, ExternalLink, Trash2, Wifi, Server, Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

export default function ServerDetail({ deviceId }: { deviceId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const { data: srv, isLoading: loadingSrv } = useGetServer(deviceId, {
    query: { enabled: !!deviceId, queryKey: getGetServerQueryKey(deviceId) },
  });

  const { data: scans, isLoading: loadingScans } = useListServerScans(deviceId, {
    query: { enabled: !!deviceId, queryKey: getListServerScansQueryKey(deviceId) },
  });

  const startScan = useStartServerScan();
  const deleteServer = useDeleteServer();

  const handleStartScan = () => {
    startScan.mutate(
      { deviceId },
      {
        onSuccess: () => {
          toast({ title: "Varredura iniciada", description: "A auditoria do servidor foi iniciada." });
          queryClient.invalidateQueries({ queryKey: getListServerScansQueryKey(deviceId) });
          queryClient.invalidateQueries({ queryKey: getGetServerQueryKey(deviceId) });
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
    deleteServer.mutate(
      { deviceId },
      {
        onSuccess: () => {
          toast({ title: "Servidor removido", description: "Dispositivo excluido com sucesso." });
          setLocation("/servers");
        },
        onError: () => {
          toast({ variant: "destructive", title: "Erro ao remover", description: "Nao foi possivel remover." });
        },
      }
    );
  };

  if (loadingSrv) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[300px]" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!srv) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Servidor nao encontrado.</p>
        <Link href="/servers">
          <Button variant="link" className="mt-4">Voltar para Servidores</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/servers">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-display font-bold tracking-tight">{srv.name}</h1>
            <Badge variant="outline">{OS_LABELS[srv.os]}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 font-mono">{srv.hostname}</p>
        </div>
        <Button onClick={handleStartScan} disabled={startScan.isPending} className="gap-2">
          <Play className="h-4 w-4" />
          {startScan.isPending ? "Iniciando..." : "Iniciar Varredura"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {srv.ipAddress && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Wifi className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Endereco IP</p>
                <p className="font-mono font-medium">{srv.ipAddress}</p>
              </div>
            </CardContent>
          </Card>
        )}
        {srv.osVersion && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Server className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Versao do SO</p>
                <p className="font-medium">{srv.osVersion}</p>
              </div>
            </CardContent>
          </Card>
        )}
        {srv.role && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Tag className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Funcao</p>
                <p className="font-medium">{srv.role}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {srv.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{srv.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historico de Varreduras</CardTitle>
          <CardDescription>Auditorias CIS realizadas neste servidor</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingScans ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !scans || scans.length === 0 ? (
            <div className="text-center py-12">
              <HardDrive className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
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
                  onClick={() => setLocation(`/server-scans/${scan.id}`)}
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
                      <Badge variant={SCAN_STATUS_VARIANT[scan.status]} className="text-xs">
                        {SCAN_STATUS_LABEL[scan.status]}
                      </Badge>
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
            Remover Servidor
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remover Servidor</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja remover <strong>{srv.name}</strong>? Todo o historico de varreduras sera excluido permanentemente.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteServer.isPending}>
                {deleteServer.isPending ? "Removendo..." : "Remover"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
