import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Cpu, Plus, Trash2, Download, Copy, Check, Wifi, WifiOff, Clock } from "lucide-react";
import { apiFetch, apiBase } from "@/lib/apiFetch";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Probe = {
  id: string;
  displayName: string;
  hostname: string | null;
  ipAddress: string | null;
  os: string | null;
  agentVersion: string | null;
  status: "pending" | "online" | "offline";
  lastSeenAt: string | null;
  createdAt: string;
};

function StatusBadge({ status }: { status: Probe["status"] }) {
  if (status === "online") return <Badge className="gap-1 bg-success hover:bg-success/80"><Wifi className="h-3 w-3" />Online</Badge>;
  if (status === "offline") return <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" />Offline</Badge>;
  return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Aguardando</Badge>;
}

export default function ProbesList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: probes = [], isLoading } = useQuery<Probe[]>({
    queryKey: ["probes"],
    queryFn: () => apiFetch("/probes"),
    refetchInterval: 30_000,
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      apiFetch<Probe & { probeToken: string }>("/probes", {
        method: "POST",
        body: JSON.stringify({ displayName: name }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["probes"] });
      setIsNewOpen(false);
      setDisplayName("");
      setNewToken(data.probeToken);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/probes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["probes"] });
      setDeleteId(null);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro ao remover", description: e.message }),
  });

  const copyToken = () => {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Security Probes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Agentes instalados na rede do cliente para varreduras internas via PowerShell.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setIsNewOpen(true)}>
          <Plus className="h-4 w-4" />
          Novo Probe
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={isNewOpen} onOpenChange={setIsNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Security Probe</DialogTitle>
            <DialogDescription>
              Um script PowerShell será gerado com um token único. Execute-o como Administrador na máquina do cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Nome do probe *</Label>
            <Input
              placeholder="Ex: Sede - Servidor Principal"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && displayName.trim() && create.mutate(displayName.trim())}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => displayName.trim() && create.mutate(displayName.trim())}
              disabled={!displayName.trim() || create.isPending}
            >
              {create.isPending ? "Criando..." : "Criar Probe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token reveal dialog */}
      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Probe criado — salve o token</DialogTitle>
            <DialogDescription>
              Copie o token abaixo. Ele será necessário ao executar o instalador.
              Este token não será exibido novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Token do probe</Label>
              <div className="flex gap-2">
                <Input readOnly value={newToken ?? ""} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyToken}>
                  {tokenCopied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="rounded border bg-muted p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Como instalar</p>
              <p className="text-xs text-muted-foreground">1. Feche este diálogo e clique em <strong>Instalar</strong> na lista para baixar o script assinado com o token embutido.</p>
              <p className="text-xs text-muted-foreground">2. Execute no cliente como <strong>Administrador</strong>:</p>
              <code className="block text-xs font-mono bg-background rounded px-2 py-1 mt-1">
                .\ Instalar_WNRAudit_Probe.ps1
              </code>
              <p className="text-xs text-muted-foreground mt-1">O token já está embutido no arquivo baixado — não é necessário passar parâmetros.</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewToken(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover probe?</DialogTitle>
            <DialogDescription>
              O probe será desregistrado e não poderá mais se comunicar com o sistema. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && del.mutate(deleteId)}
              disabled={del.isPending}
            >
              {del.isPending ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : probes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Cpu className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">Nenhum probe registrado</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
              Crie um probe e execute o script PowerShell gerado como Administrador na máquina do cliente.
              O agente realiza varreduras de segurança na rede interna automaticamente.
            </p>
            <Button className="mt-4 gap-2" onClick={() => setIsNewOpen(true)}>
              <Plus className="h-4 w-4" />
              Criar Primeiro Probe
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {probes.map((probe) => (
            <Card key={probe.id} className={probe.status === "online" ? "border-success/30" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-sm truncate flex-1">{probe.displayName}</span>
                  <StatusBadge status={probe.status} />
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {probe.hostname && (
                  <p className="text-xs text-muted-foreground font-mono truncate">{probe.hostname}</p>
                )}
                {probe.ipAddress && (
                  <p className="text-xs text-muted-foreground">{probe.ipAddress}</p>
                )}
                {probe.os && (
                  <p className="text-xs text-muted-foreground truncate">{probe.os}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {probe.lastSeenAt
                    ? `Visto ${formatDistanceToNow(new Date(probe.lastSeenAt), { addSuffix: true, locale: ptBR })}`
                    : "Nunca conectado"}
                </p>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 flex-1"
                    onClick={() => window.open(`${apiBase}/api/probes/${probe.id}/download`, "_blank", "noopener")}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Instalar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteId(probe.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
