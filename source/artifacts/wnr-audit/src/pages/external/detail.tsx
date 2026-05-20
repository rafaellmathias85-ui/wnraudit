import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetExternalAsset,
  useListExternalAssetScans,
  useStartExternalAssetScan,
  useDeleteExternalAsset,
  getGetExternalAssetQueryKey,
  getListExternalAssetScansQueryKey,
  ExternalAssetKind,
  ScanStatus,
  type ErrorResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  Globe,
  Play,
  Trash2,
  Clock,
  CheckCircle,
  ExternalLink,
  Wifi,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const KIND_LABEL: Record<ExternalAssetKind, string> = {
  firewall: "Firewall",
  server: "Servidor",
  web: "Website",
  api: "API",
  other: "Outro",
};

const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  pending: "Aguardando",
  running: "Em andamento",
  completed: "Concluída",
  failed: "Falha",
};

const SCAN_STATUS_VARIANT: Record<ScanStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "default",
  completed: "outline",
  failed: "destructive",
};

export default function ExternalDetail({ assetId }: { assetId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: asset, isLoading } = useGetExternalAsset(assetId, {
    query: { enabled: !!assetId, queryKey: getGetExternalAssetQueryKey(assetId) },
  });
  const { data: scans, isLoading: loadingScans } = useListExternalAssetScans(assetId, {
    query: { enabled: !!assetId, queryKey: getListExternalAssetScansQueryKey(assetId) },
  });

  const startScan = useStartExternalAssetScan();
  const deleteAsset = useDeleteExternalAsset();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListExternalAssetScansQueryKey(assetId) });
    queryClient.invalidateQueries({ queryKey: getGetExternalAssetQueryKey(assetId) });
  };

  const handleStartScan = () => {
    startScan.mutate(
      { assetId },
      {
        onSuccess: () => {
          toast({
            title: "Varredura iniciada",
            description: "A análise pode demorar alguns minutos.",
          });
          refresh();
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Erro ao iniciar",
            description: (err.data as ErrorResponse | undefined)?.error || "Tente novamente.",
          }),
      },
    );
  };

  const handleDelete = () => {
    deleteAsset.mutate(
      { assetId },
      {
        onSuccess: () => {
          toast({ title: "Ativo removido" });
          setLocation("/external");
        },
        onError: () => toast({ variant: "destructive", title: "Erro ao remover" }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[300px]" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Ativo não encontrado.</p>
        <Link href="/external">
          <Button variant="link" className="mt-4">
            Voltar
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/external">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-display font-bold tracking-tight">{asset.name}</h1>
            <Badge variant="outline">{KIND_LABEL[asset.kind]}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            {asset.host}
            {asset.port ? `:${asset.port}` : ""}
          </p>
        </div>
        <Button onClick={handleStartScan} disabled={startScan.isPending} className="gap-2">
          <Play className="h-4 w-4" />
          {startScan.isPending ? "Iniciando..." : "Iniciar varredura"}
        </Button>
      </div>

      {asset.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{asset.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de varreduras</CardTitle>
          <CardDescription>
            Análises de exposição executadas neste ativo
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingScans ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !scans || scans.length === 0 ? (
            <div className="text-center py-12">
              <Wifi className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">Nenhuma varredura realizada.</p>
              <Button onClick={handleStartScan} disabled={startScan.isPending} className="mt-4 gap-2">
                <Play className="h-4 w-4" />
                Iniciar primeira varredura
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {scans.map((scan) => (
                <div
                  key={scan.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg border hover:border-primary/50 transition-colors cursor-pointer group gap-4"
                  onClick={() => setLocation(`/external-scans/${scan.id}`)}
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
                        {format(new Date(scan.startedAt), "dd 'de' MMM 'de' yyyy 'às' HH:mm", {
                          locale: ptBR,
                        })}
                      </p>
                    </div>
                  </div>
                  {scan.status === ScanStatus.completed && (
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className="font-bold text-success">{scan.passedChecks}</p>
                        <p className="text-xs text-muted-foreground">OK</p>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-destructive">{scan.failedChecks}</p>
                        <p className="text-xs text-muted-foreground">Falhas</p>
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
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive gap-2"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            Remover ativo
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remover ativo</DialogTitle>
              <DialogDescription>
                Tem certeza que deseja remover <strong>{asset.name}</strong>? Todo o histórico será excluído.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleteAsset.isPending}>
                {deleteAsset.isPending ? "Removendo..." : "Remover"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
