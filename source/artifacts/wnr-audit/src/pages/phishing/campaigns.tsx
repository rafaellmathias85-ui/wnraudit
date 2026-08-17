import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Mail, Users, MousePointerClick, ChevronRight, Play, CheckCircle2, FileText, Building2, Settings2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "completed" | "paused";
  senderName: string;
  senderEmail: string;
  tenantId: string | null;
  tenantDisplayName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  targetCount: number;
  clickCount: number;
};

type Tenant = { id: string; displayName: string; primaryDomain: string | null; status: string };
type SmtpConfig = { id: string; displayName: string; email: string; status: string };

const STATUS_CONFIG = {
  draft: { label: "Rascunho", variant: "secondary" as const },
  active: { label: "Ativa", variant: "default" as const },
  completed: { label: "Concluída", variant: "outline" as const },
  paused: { label: "Pausada", variant: "secondary" as const },
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

export default function PhishingCampaigns() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    senderName: "Suporte TI",
    senderEmail: "",
    authorizationNote: "",
    tenantId: "",
  });

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["phishing-campaigns"],
    queryFn: () => apiFetch("/phishing/campaigns"),
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["tenants"],
    queryFn: () => apiFetch("/tenants"),
  });
  const connectedTenants = tenants.filter((t) => t.status === "connected");

  const { data: smtpConfigs = [] } = useQuery<SmtpConfig[]>({
    queryKey: ["phishing-smtp"],
    queryFn: () => apiFetch("/phishing/smtp"),
  });
  const verifiedSmtp = smtpConfigs.filter((s) => s.status === "verified");

  const createCampaign = useMutation({
    mutationFn: (data: typeof form) =>
      apiFetch("/phishing/campaigns", {
        method: "POST",
        body: JSON.stringify({ ...data, tenantId: data.tenantId || null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phishing-campaigns"] });
      setIsNewOpen(false);
      setForm({ name: "", description: "", senderName: "Suporte TI", senderEmail: "", authorizationNote: "", tenantId: "" });
      toast({ title: "Campanha criada", description: "A campanha foi criada em modo rascunho." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const deleteCampaign = useMutation({
    mutationFn: (id: string) => apiFetch(`/phishing/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["phishing-campaigns"] }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Simulação de Phishing</h1>
          <p className="text-muted-foreground text-sm mt-1">Crie campanhas para testar e treinar funcionários contra ataques de phishing.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/phishing/smtp">
            <Button variant="outline" className="gap-2">
              <Settings2 className="h-4 w-4" />
              SMTP
            </Button>
          </Link>
          <Link href="/phishing/employees">
            <Button variant="outline" className="gap-2">
              <Users className="h-4 w-4" />
              Funcionários
            </Button>
          </Link>
          <Link href="/phishing/templates">
            <Button variant="outline" className="gap-2">
              <FileText className="h-4 w-4" />
              Templates
            </Button>
          </Link>
          <Dialog open={isNewOpen} onOpenChange={setIsNewOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Nova Campanha
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nova Campanha de Phishing</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Cliente (tenant Microsoft)</Label>
                  <Select value={form.tenantId} onValueChange={(v) => setForm((f) => ({ ...f, tenantId: v === "none" ? "" : v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem cliente específico</SelectItem>
                      {connectedTenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.displayName}{t.primaryDomain ? ` (${t.primaryDomain})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Associar a um cliente filtra os funcionários disponíveis para essa campanha.</p>
                </div>
                <div className="space-y-2">
                  <Label>Nome da campanha *</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Teste Q2 2025 — Microsoft 365" />
                </div>
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Objetivo da campanha" />
                </div>
                <div className="space-y-2">
                  <Label>E-mail remetente (SMTP) *</Label>
                  {verifiedSmtp.length === 0 ? (
                    <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                      Nenhum SMTP verificado.{" "}
                      <Link href="/phishing/smtp" className="text-primary underline-offset-4 hover:underline">
                        Cadastre um e-mail SMTP
                      </Link>{" "}
                      antes de criar campanhas.
                    </div>
                  ) : (
                    <Select
                      value={form.senderEmail}
                      onValueChange={(v) => {
                        const cfg = verifiedSmtp.find((s) => s.email === v);
                        setForm((f) => ({ ...f, senderEmail: v, senderName: cfg?.displayName ?? f.senderName }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o e-mail remetente..." />
                      </SelectTrigger>
                      <SelectContent>
                        {verifiedSmtp.map((s) => (
                          <SelectItem key={s.id} value={s.email}>
                            {s.displayName} &lt;{s.email}&gt;
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Nome do remetente *</Label>
                  <Input
                    value={form.senderName}
                    onChange={(e) => setForm((f) => ({ ...f, senderName: e.target.value }))}
                    placeholder="Ex: Suporte TI, Microsoft Security..."
                  />
                  <p className="text-xs text-muted-foreground">Nome exibido no campo "De:" do e-mail recebido pelo alvo.</p>
                </div>
                <div className="space-y-2">
                  <Label>Nota de autorização * (mín. 10 caracteres)</Label>
                  <Textarea
                    rows={3}
                    value={form.authorizationNote}
                    onChange={(e) => setForm((f) => ({ ...f, authorizationNote: e.target.value }))}
                    placeholder="Ex: Autorizado pela gerência de TI em reunião de 22/05/2025 para teste de conscientização dos colaboradores do cliente ACME LTDA."
                  />
                  <p className="text-xs text-muted-foreground">Esta nota é exigida por questões legais. A campanha só pode ser executada com autorização explícita documentada.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsNewOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => createCampaign.mutate(form)}
                  disabled={createCampaign.isPending || !form.name || !form.senderEmail || !form.senderName || form.authorizationNote.length < 10}
                >
                  {createCampaign.isPending ? "Criando..." : "Criar Campanha"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">Nenhuma campanha ainda</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
              Crie sua primeira campanha de phishing simulado para medir a vulnerabilidade dos funcionários.
            </p>
            <Button className="mt-6 gap-2" onClick={() => setIsNewOpen(true)}>
              <Plus className="h-4 w-4" />
              Nova Campanha
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const cfg = STATUS_CONFIG[c.status];
            const clickRate = c.targetCount > 0 ? Math.round((c.clickCount / c.targetCount) * 100) : 0;
            return (
              <Card key={c.id} className="hover:border-primary/40 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{c.name}</span>
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        {c.tenantDisplayName && (
                          <Badge variant="outline" className="gap-1 text-xs">
                            <Building2 className="h-3 w-3" />
                            {c.tenantDisplayName}
                          </Badge>
                        )}
                      </div>
                      {c.description && <p className="text-sm text-muted-foreground truncate mt-0.5">{c.description}</p>}
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{c.targetCount} alvos</span>
                        <span className="flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" />{clickRate}% clicaram</span>
                        <span>Criada {format(new Date(c.createdAt), "dd MMM yyyy", { locale: ptBR })}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.status === "active" && (
                        <Badge variant="default" className="gap-1 animate-pulse">
                          <Play className="h-3 w-3" />
                          Ativa
                        </Badge>
                      )}
                      {c.status === "completed" && (
                        <Badge variant="outline" className="gap-1 text-success border-success/30">
                          <CheckCircle2 className="h-3 w-3" />
                          Concluída
                        </Badge>
                      )}
                      <Link href={`/phishing/campaigns/${c.id}`}>
                        <Button variant="ghost" size="icon">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
