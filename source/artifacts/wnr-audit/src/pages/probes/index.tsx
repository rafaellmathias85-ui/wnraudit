import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useListTenants } from "@workspace/api-client-react";
import {
  Plus, Cpu, Wifi, WifiOff, Clock, Download, Trash2, Copy, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
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

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const STATUS_CONFIG = {
  pending: { label: "Aguardando", variant: "secondary" as const, icon: Clock },
  online: { label: "Online", variant: "default" as const, icon: Wifi },
  offline: { label: "Offline", variant: "outline" as const, icon: WifiOff },
};

export default function ProbesList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Probe | null>(null);
  const [newProbeResult, setNewProbeResult] = useState<{ id: string; probeToken: string; displayName: string } | null>(null);
  const [clienteMode, setClienteMode] = useState<"tenant" | "avulso">("tenant");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [displayName, setDisplayName] = useState("");

  const { data: tenants = [] } = useListTenants();

  const { data: probes = [], isLoading } = useQuery<Probe[]>({
    queryKey: ["probes"],
    queryFn: () => apiFetch("/probes"),
    refetchInterval: 30_000,
  });

  const createProbe = useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ id: string; probeToken: string; displayName: string }>("/probes", {
        method: "POST",
        body: JSON.stringify({ displayName: name }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["probes"] });
      setIsNewOpen(false);
      setDisplayName("");
      setSelectedTenantId("");
      setClienteMode("tenant");
      setNewProbeResult(data);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  function getEffectiveName(): string {
    if (clienteMode === "tenant") {
      const t = tenants.find((t) => t.id === selectedTenantId);
      return t?.displayName ?? "";
    }
    return displayName.trim();
  }

  function handleCreate() {
    const name = getEffectiveName();
    if (name.length >= 2) createProbe.mutate(name);
  }

  const deleteProbe = useMutation({
    mutationFn: (id: string) => apiFetch(`/probes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["probes"] });
      setDeleteTarget(null);
      toast({ title: "Probe removido" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro ao excluir", description: e.message }),
  });

  function downloadScript(probe: Probe) {
    window.open(`/api/probes/${probe.id}/download`, "_blank");
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token).then(() => {
      toast({ title: "Token copiado" });
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-6 w-6 text-primary" />
            Security Probes
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Agentes instalados na rede interna para varredura de servidores e firewalls on-premise.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setIsNewOpen(true)}>
          <Plus className="h-4 w-4" />
          Novo Probe
        </Button>
      </div>

      {/* Info banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4 px-5 text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Como funciona</p>
          <p>
            Instale o probe em uma máquina Windows dentro da rede do cliente. Ele realiza
            varreduras de portas e verificações de segurança nos servidores e firewalls
            cadastrados, enviando os resultados para o WNR Audit via HTTPS.
          </p>
          <p className="text-xs mt-1">
            Isolamento total do RMM WinnerTI — diretório, tarefas agendadas e token são
            completamente independentes.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : probes.length === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <Cpu className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">Nenhum probe instalado</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
              Crie um probe, baixe o instalador e execute em uma máquina Windows dentro da rede do cliente.
            </p>
            <Button className="mt-6 gap-2" onClick={() => setIsNewOpen(true)}>
              <Plus className="h-4 w-4" />
              Novo Probe
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {probes.map((probe) => {
            const cfg = STATUS_CONFIG[probe.status];
            const Icon = cfg.icon;
            return (
              <Card key={probe.id} className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{probe.displayName}</span>
                        <Badge variant={cfg.variant} className="gap-1">
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap">
                        {probe.hostname && <span className="font-mono text-xs">{probe.hostname}</span>}
                        {probe.ipAddress && <span className="font-mono text-xs">{probe.ipAddress}</span>}
                        {probe.os && <span>{probe.os}</span>}
                        {probe.agentVersion && <span>v{probe.agentVersion}</span>}
                        {probe.lastSeenAt ? (
                          <span>
                            Último contato:{" "}
                            {format(new Date(probe.lastSeenAt), "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                        ) : (
                          <span className="text-warning">Ainda não conectou</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => downloadScript(probe)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Baixar instalador
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(probe)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New probe dialog */}
      <Dialog open={isNewOpen} onOpenChange={(v) => { setIsNewOpen(v); if (!v) { setClienteMode("tenant"); setSelectedTenantId(""); setDisplayName(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Security Probe</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <RadioGroup
              value={clienteMode}
              onValueChange={(v) => { setClienteMode(v as "tenant" | "avulso"); setSelectedTenantId(""); setDisplayName(""); }}
              className="gap-3"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="tenant" id="mode-tenant" />
                <Label htmlFor="mode-tenant" className="cursor-pointer font-normal">
                  Cliente cadastrado no sistema (tenant)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="avulso" id="mode-avulso" />
                <Label htmlFor="mode-avulso" className="cursor-pointer font-normal">
                  Cliente avulso (sem cadastro)
                </Label>
              </div>
            </RadioGroup>

            {clienteMode === "tenant" ? (
              <div className="space-y-2">
                <Label>Selecione o tenant *</Label>
                {tenants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum tenant cadastrado. Use "Cliente avulso".</p>
                ) : (
                  <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Nome do cliente *</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex: Probe — Cliente ACME"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Identifique em qual local/cliente este probe será instalado.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreate}
              disabled={createProbe.isPending || getEffectiveName().length < 2}
            >
              {createProbe.isPending ? "Criando..." : "Criar Probe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token reveal dialog (shown only once after creation) */}
      <Dialog open={!!newProbeResult} onOpenChange={(v) => { if (!v) setNewProbeResult(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Probe criado — salve o token</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning-foreground">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
              <p>
                O token abaixo é exibido <strong>apenas uma vez</strong>. Ele já está embutido
                no script de instalação — baixe o script agora e não é necessário copiá-lo manualmente.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Token do probe</Label>
              <div className="flex gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
                  {newProbeResult?.probeToken}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => newProbeResult && copyToken(newProbeResult.probeToken)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => newProbeResult && downloadScript({ id: newProbeResult.id, displayName: newProbeResult.displayName } as Probe)}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Baixar instalador
            </Button>
            <Button onClick={() => setNewProbeResult(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover probe</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Tem certeza que deseja remover o probe{" "}
            <span className="font-semibold text-foreground">"{deleteTarget?.displayName}"</span>?
            O agente instalado na máquina do cliente perderá autenticação e parará de fazer checkin.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={deleteProbe.isPending}
              onClick={() => deleteTarget && deleteProbe.mutate(deleteTarget.id)}
            >
              {deleteProbe.isPending ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
