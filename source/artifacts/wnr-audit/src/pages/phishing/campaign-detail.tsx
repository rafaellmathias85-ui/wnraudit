import React, { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle2, Users, MousePointerClick, Eye, AlertTriangle, Send, ShieldCheck, Plus, Building2, XCircle, Clock, FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { apiFetch, apiBase } from "@/lib/apiFetch";

type Event = { id: string; eventType: string; occurredAt: string; humanVerified?: boolean };
type Target = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeDepartment: string | null;
  sentAt: string | null;
  events: Event[];
};
type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  senderName: string;
  senderEmail: string;
  tenantId: string | null;
  tenantDisplayName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  targets: Target[];
};
type Employee = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  tenantId: string | null;
  tenantDisplayName: string | null;
};
type Template = { id: string; name: string; subject: string };

const EVENT_CONFIG: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  sent:      { label: "Enviado",               color: "text-muted-foreground", Icon: Send },
  opened:    { label: "Abriu o e-mail",         color: "text-blue-600",        Icon: Eye },
  clicked:   { label: "Clicou no link",         color: "text-orange-600",      Icon: MousePointerClick },
  submitted: { label: "Submeteu credenciais",   color: "text-destructive",     Icon: AlertTriangle },
  reported:  { label: "Reportou como suspeito", color: "text-green-600",       Icon: ShieldCheck },
  pending:   { label: "Aguardando envio",       color: "text-muted-foreground", Icon: Clock },
  failed:    { label: "Falha no envio",         color: "text-destructive",     Icon: XCircle },
};

function getTargetStatus(target: Target): string {
  // submitted/clicked/opened require humanVerified=true to exclude ATP scanner signals.
  // reported does NOT require humanVerified: it demands explicit navigation to the training
  // page + clicking "Confirmar Reporte" — a flow scanners cannot replicate.
  if (target.events.some((ev) => ev.eventType === "submitted" && ev.humanVerified === true)) return "submitted";
  if (target.events.some((ev) => ev.eventType === "clicked" && ev.humanVerified === true)) return "clicked";
  if (target.events.some((ev) => ev.eventType === "reported")) return "reported";
  if (target.events.some((ev) => ev.eventType === "opened" && ev.humanVerified === true)) return "opened";
  if (target.events.some((ev) => ev.eventType === "failed")) return "failed";
  if (target.sentAt) return "sent";
  return "pending";
}

export default function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddTargetsOpen, setIsAddTargetsOpen] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [isDispatchOpen, setIsDispatchOpen] = useState(false);
  const [dispatchTemplateId, setDispatchTemplateId] = useState<string>("");
  const [filterTenantId, setFilterTenantId] = useState<string>("all");

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: ["phishing-campaign", campaignId],
    queryFn: () => apiFetch(`/phishing/campaigns/${campaignId}`),
    // Poll while campaign is active and emails are still being dispatched
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (data.status !== "active") return false;
      const allSent = data.targets.length > 0 && data.targets.every((t) => t.sentAt);
      return allSent ? false : 3_000;
    },
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["phishing-employees"],
    queryFn: () => apiFetch("/phishing/employees"),
    enabled: isAddTargetsOpen,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["phishing-templates"],
    queryFn: () => apiFetch("/phishing/templates"),
    enabled: isDispatchOpen,
  });

  const dispatch = useMutation({
    mutationFn: (templateId: string) =>
      apiFetch(`/phishing/campaigns/${campaignId}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ templateId: templateId || undefined }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phishing-campaign", campaignId] });
      setIsDispatchOpen(false);
      toast({ title: "Campanha disparada", description: "E-mails sendo enviados em segundo plano." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro ao disparar", description: e.message }),
  });

  const complete = useMutation({
    mutationFn: () => apiFetch(`/phishing/campaigns/${campaignId}/complete`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phishing-campaign", campaignId] });
      toast({ title: "Campanha concluída" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const addTargets = useMutation({
    mutationFn: (employeeIds: string[]) =>
      apiFetch(`/phishing/campaigns/${campaignId}/targets`, {
        method: "POST",
        body: JSON.stringify({ employeeIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phishing-campaign", campaignId] });
      setIsAddTargetsOpen(false);
      setSelectedEmployees([]);
      toast({ title: "Alvos adicionados" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!campaign) return null;

  const targets = campaign.targets ?? [];
  const sentCount = targets.filter((t) => t.sentAt).length;
  // All counts use only human-verified events (humanVerified=true) to exclude
  // Microsoft ATP / quarantine scanner signals that load pixels or follow links.
  const hv = (e: Event) => e.humanVerified === true;
  const openedCount = targets.filter((t) =>
    t.events.some((e) => hv(e) && ["opened", "clicked", "submitted"].includes(e.eventType)) ||
    t.events.some((e) => e.eventType === "reported")
  ).length;
  const clickedCount = targets.filter((t) => t.events.some((e) => hv(e) && ["clicked", "submitted"].includes(e.eventType))).length;
  const submittedCount = targets.filter((t) => t.events.some((e) => hv(e) && e.eventType === "submitted")).length;
  const reportedCount = targets.filter((t) => t.events.some((e) => e.eventType === "reported")).length;

  // Human-confirmed actions — only events flagged humanVerified. These exclude
  // security-scanner / Safe Links signals, giving the real click/submit numbers.
  const humanClickedCount = targets.filter((t) =>
    t.events.some((e) => e.humanVerified && ["clicked", "submitted"].includes(e.eventType)),
  ).length;
  const humanSubmittedCount = targets.filter((t) =>
    t.events.some((e) => e.humanVerified && e.eventType === "submitted"),
  ).length;
  const scannerClickedCount = Math.max(clickedCount - humanClickedCount, 0);
  const isHumanTarget = (t: Target) =>
    t.events.some((e) => e.humanVerified && ["clicked", "submitted"].includes(e.eventType));

  const existingEmployeeIds = new Set(targets.map((t) => t.employeeId));

  // Unique tenants from employees list for the filter dropdown
  const tenantOptions = Array.from(
    new Map(
      employees
        .filter((e) => e.tenantId && e.tenantDisplayName)
        .map((e) => [e.tenantId!, { id: e.tenantId!, name: e.tenantDisplayName! }]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const availableEmployees = employees.filter((e) => {
    if (existingEmployeeIds.has(e.id)) return false;
    // If campaign is scoped to a tenant, respect that scope
    if (campaign.tenantId && e.tenantId && e.tenantId !== campaign.tenantId) return false;
    // Apply the user's tenant filter selection
    if (filterTenantId === "none") return !e.tenantId;
    if (filterTenantId !== "all") return e.tenantId === filterTenantId;
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link href="/phishing">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-display font-bold">{campaign.name}</h1>
            {campaign.tenantDisplayName && (
              <Badge variant="outline" className="gap-1">
                <Building2 className="h-3 w-3" />
                {campaign.tenantDisplayName}
              </Badge>
            )}
          </div>
          {campaign.description && <p className="text-muted-foreground text-sm">{campaign.description}</p>}
        </div>
        <div className="flex gap-2">
          {campaign.status === "draft" && (
            <>
              {/* Add targets dialog */}
              <Dialog
                open={isAddTargetsOpen}
                onOpenChange={(open) => {
                  setIsAddTargetsOpen(open);
                  if (!open) { setSelectedEmployees([]); setFilterTenantId("all"); }
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Adicionar Alvos
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Selecionar Funcionários</DialogTitle>
                  </DialogHeader>

                  {/* Client filter — only shown when campaign has no fixed tenant scope */}
                  {!campaign.tenantId && tenantOptions.length > 0 && (
                    <div className="px-1">
                      <Label className="text-xs text-muted-foreground mb-1 block">Filtrar por cliente</Label>
                      <Select value={filterTenantId} onValueChange={(v) => { setFilterTenantId(v); setSelectedEmployees([]); }}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Todos os clientes" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os clientes</SelectItem>
                          {tenantOptions.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              <span className="flex items-center gap-1.5">
                                <Building2 className="h-3 w-3 text-muted-foreground" />
                                {t.name}
                              </span>
                            </SelectItem>
                          ))}
                          <SelectItem value="none">Sem cliente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {campaign.tenantDisplayName && (
                    <p className="text-xs text-muted-foreground px-1">
                      Mostrando funcionários de <strong>{campaign.tenantDisplayName}</strong>.
                    </p>
                  )}

                  <div className="max-h-72 overflow-y-auto space-y-2 py-2">
                    {availableEmployees.length === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-6">
                        Nenhum funcionário disponível para este filtro.
                        <Link href="/phishing/employees"><Button variant="link" size="sm">Cadastrar funcionários</Button></Link>
                      </p>
                    ) : (
                      availableEmployees.map((e) => (
                        <label key={e.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEmployees.includes(e.id)}
                            onChange={(ev) =>
                              setSelectedEmployees((prev) =>
                                ev.target.checked ? [...prev, e.id] : prev.filter((id) => id !== e.id),
                              )
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{e.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {e.email}{e.department ? ` · ${e.department}` : ""}
                              {e.tenantDisplayName && filterTenantId === "all" && (
                                <span className="ml-1 text-muted-foreground/60">· {e.tenantDisplayName}</span>
                              )}
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddTargetsOpen(false)}>Cancelar</Button>
                    <Button
                      onClick={() => addTargets.mutate(selectedEmployees)}
                      disabled={selectedEmployees.length === 0 || addTargets.isPending}
                    >
                      Adicionar ({selectedEmployees.length})
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Dispatch dialog — choose template before sending */}
              <Dialog open={isDispatchOpen} onOpenChange={(open) => { setIsDispatchOpen(open); if (open) setDispatchTemplateId(""); }}>
                <DialogTrigger asChild>
                  <Button className="gap-2" disabled={targets.length === 0}>
                    <Send className="h-4 w-4" />
                    Disparar Campanha
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Confirmar Disparo</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <p className="text-sm text-muted-foreground">
                      Serão enviados e-mails de phishing simulado para{" "}
                      <strong>{targets.length} alvo(s)</strong>. Escolha o template antes de disparar.
                    </p>
                    <div className="space-y-2">
                      <Label>Template de e-mail</Label>
                      <Select value={dispatchTemplateId} onValueChange={setDispatchTemplateId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um template…" />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {dispatchTemplateId && (
                        <p className="text-xs text-muted-foreground">
                          Assunto: <em>{templates.find((t) => t.id === dispatchTemplateId)?.subject}</em>
                        </p>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDispatchOpen(false)}>Cancelar</Button>
                    <Button
                      onClick={() => dispatch.mutate(dispatchTemplateId)}
                      disabled={!dispatchTemplateId || dispatch.isPending}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {dispatch.isPending ? "Disparando…" : "Disparar"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          {campaign.status === "active" && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
            >
              <CheckCircle2 className="h-4 w-4" />
              Concluir Campanha
            </Button>
          )}
          {(campaign.status === "active" || campaign.status === "completed") && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={async () => {
                const res = await fetch(`${apiBase}/api/phishing/campaigns/${campaignId}/report`, { credentials: "include" });
                if (!res.ok) { toast({ variant: "destructive", title: "Erro ao gerar relatório" }); return; }
                const html = await res.text();
                const win = window.open("", "_blank");
                win?.document.open();
                win?.document.write(html);
                win?.document.close();
              }}
            >
              <FileText className="h-4 w-4" />
              Gerar Relatório
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Enviados", value: sentCount, icon: Send, color: "text-muted-foreground" },
          { label: "Abriram", value: openedCount, icon: Eye, color: "text-blue-600" },
          { label: "Clicaram", value: clickedCount, icon: MousePointerClick, color: "text-orange-600" },
          { label: "Submeteram", value: submittedCount, icon: AlertTriangle, color: "text-destructive" },
          { label: "Reportaram", value: reportedCount, icon: ShieldCheck, color: "text-success" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <s.icon className={`h-5 w-5 mx-auto mb-1 ${s.color}`} />
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Human-confirmed actions — separated from the detected metrics above */}
      <Card className="border-red-200">
        <CardHeader className="pb-2 border-b">
          <CardTitle className="text-sm flex items-center gap-2 text-red-700">
            <MousePointerClick className="h-4 w-4" />
            Ações Humanas Confirmadas
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Apenas interações reais de pessoas. Não inclui scanners de segurança nem a
            detonação do Microsoft Safe Links (que inflam "Abriram" e "Clicaram" acima).
            Use estes números para a análise de risco real.
          </p>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center rounded-md border border-red-200 border-l-[3px] border-l-red-600 py-3">
              <div className="text-2xl font-bold text-red-700">{humanClickedCount}</div>
              <div className="text-xs text-muted-foreground">Cliques humanos</div>
            </div>
            <div className="text-center rounded-md border border-red-200 border-l-[3px] border-l-red-800 py-3">
              <div className="text-2xl font-bold text-red-900">{humanSubmittedCount}</div>
              <div className="text-xs text-muted-foreground">Submissões humanas</div>
            </div>
            <div className="text-center rounded-md border border-green-200 border-l-[3px] border-l-green-600 py-3">
              <div className="text-2xl font-bold text-green-700">{reportedCount}</div>
              <div className="text-xs text-muted-foreground">Reportaram</div>
            </div>
            <div className="text-center rounded-md border border-slate-200 border-l-[3px] border-l-slate-500 py-3">
              <div className="text-2xl font-bold text-slate-600">{scannerClickedCount}</div>
              <div className="text-xs text-muted-foreground">Cliques de scanner</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Targets table */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Alvos da Campanha ({targets.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {targets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Nenhum alvo ainda. Adicione funcionários à campanha.
            </div>
          ) : (
            <div className="divide-y">
              {targets.map((t) => {
                const status = getTargetStatus(t);
                const cfg = EVENT_CONFIG[status] ?? EVENT_CONFIG.pending;
                return (
                  <div key={t.id} className="flex items-center justify-between px-6 py-3 hover:bg-muted/30">
                    <div>
                      <div className="text-sm font-medium">{t.employeeName}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.employeeEmail}{t.employeeDepartment ? ` · ${t.employeeDepartment}` : ""}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-0.5">
                      <div className={`flex items-center gap-1 text-sm font-medium ${cfg.color}`}>
                        <cfg.Icon className="h-3.5 w-3.5" />
                        {cfg.label}
                      </div>
                      {isHumanTarget(t) ? (
                        <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 gap-1 h-5">
                          <MousePointerClick className="h-3 w-3" />
                          Humano confirmado
                        </Badge>
                      ) : (
                        (status === "clicked" || status === "opened") && (
                          <span className="text-[11px] text-muted-foreground">
                            Detectado por scanner (não humano)
                          </span>
                        )
                      )}
                      {t.sentAt && (
                        <div className="text-xs text-muted-foreground">
                          Enviado em {format(new Date(t.sentAt), "dd/MM HH:mm", { locale: ptBR })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
