import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListExternalAssets,
  useDeleteExternalAsset,
  getListExternalAssetsQueryKey,
  ExternalAssetKind,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Globe, Plus, Wifi, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const KIND_LABEL: Record<ExternalAssetKind, string> = {
  firewall: "Firewall",
  server: "Servidor",
  web: "Website",
  api: "API",
  other: "Outro",
};

type AssetSummary = { id: string; name: string };

export default function ExternalList() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<AssetSummary | null>(null);

  const { data, isLoading } = useListExternalAssets({
    query: { queryKey: getListExternalAssetsQueryKey() },
  });

  const deleteAsset = useDeleteExternalAsset();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-3">
            <Globe className="h-7 w-7 text-primary" />
            Superfície Externa
          </h1>
          <p className="text-muted-foreground mt-1">
            Audite ativos públicos (IP, DDNS, domínios) sem precisar de credenciais.
          </p>
        </div>
        <Link href="/external/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Novo ativo
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center gap-4">
            <Globe className="h-12 w-12 text-muted-foreground opacity-40" />
            <div>
              <p className="font-medium">Nenhum ativo cadastrado</p>
              <p className="text-sm text-muted-foreground mt-1">
                Cadastre um IP público ou DDNS para iniciar a primeira varredura.
              </p>
            </div>
            <Link href="/external/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Cadastrar primeiro ativo
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((asset) => (
            <Card
              key={asset.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setLocation(`/external/${asset.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{asset.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {asset.host}
                      {asset.port ? `:${asset.port}` : ""}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline">{KIND_LABEL[asset.kind]}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: asset.id, name: asset.name }); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p className="flex items-center gap-2">
                  <Wifi className="h-3.5 w-3.5" />
                  {asset.lastScanAt
                    ? `Última: ${format(new Date(asset.lastScanAt), "dd/MM HH:mm", { locale: ptBR })}`
                    : "Nunca varrido"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir ativo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Tem certeza que deseja excluir o ativo{" "}
            <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span>?
            Todos os scans e descobertas associadas serão removidos permanentemente.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteAsset.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteAsset.mutate(
                  { assetId: deleteTarget.id },
                  {
                    onSuccess: () => {
                      setDeleteTarget(null);
                      toast({ title: "Ativo excluído" });
                    },
                    onError: () => toast({ variant: "destructive", title: "Erro ao excluir" }),
                  },
                );
              }}
            >
              {deleteAsset.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
