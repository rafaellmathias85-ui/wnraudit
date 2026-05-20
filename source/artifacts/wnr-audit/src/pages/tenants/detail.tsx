import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetTenant,
  useListTenantScans,
  useStartTenantScan,
  useDeleteTenant,
  useConnectTenantWithApp,
  useReconnectTenant,
  useStartOAuthProvision,
  getListTenantScansQueryKey,
  getGetTenantQueryKey,
  type ErrorResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Server,
  Play,
  ShieldAlert,
  Clock,
  Activity,
  ExternalLink,
  Trash2,
  Link2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  ChevronDown,
  Zap,
  Shield,
  Eye,
  EyeOff,
} from "lucide-react";
import { TenantStatus, ScanStatus, type ScanMode } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TenantInquirySection } from "@/components/TenantInquirySection";

type ConnectPhase = "idle" | "connecting" | "completed" | "error";


export default function TenantDetail({ tenantId }: { tenantId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [connectPhase, setConnectPhase] = useState<ConnectPhase>("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [appClientId, setAppClientId] = useState("");
  const [appClientSecret, setAppClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  // Detectar retorno do fluxo OAuth da Microsoft (redirect de callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("oauth_success");
    const oauthError = params.get("oauth_error");
    if (oauthSuccess === "true") {
      setConnectPhase("completed");
      queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
      queryClient.invalidateQueries({ queryKey: getListTenantScansQueryKey(tenantId) });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauthError) {
      setConnectPhase("error");
      setConnectError(decodeURIComponent(oauthError));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [tenantId, queryClient]);

  const { data: tenant, isLoading: loadingTenant } = useGetTenant(tenantId, {
    query: { enabled: !!tenantId, queryKey: getGetTenantQueryKey(tenantId) },
  });
  const { data: scans, isLoading: loadingScans } = useListTenantScans(tenantId, {
    query: { enabled: !!tenantId, queryKey: getListTenantScansQueryKey(tenantId) },
  });

  const startScan = useStartTenantScan();
  const deleteTenant = useDeleteTenant();
  const connectWithApp = useConnectTenantWithApp();
  const startOAuthProvision = useStartOAuthProvision();
  const reconnectTenantMutation = useReconnectTenant();

  const handleOAuthStart = () => {
    setConnectError(null);
    setConnectPhase("connecting");
    startOAuthProvision.mutate(
      { tenantId },
      {
        onSuccess: (data) => {
          window.location.href = data.authUrl;
        },
        onError: (error) => {
          setConnectPhase("error");
          setConnectError((error.data as ErrorResponse | undefined)?.error ?? "Não foi possível iniciar a autenticação com a Microsoft.");
        },
      },
    );
  };

  const handleConnectWithApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appClientId.trim() || !appClientSecret.trim()) return;
    setConnectError(null);
    setConnectPhase("connecting");

    connectWithApp.mutate(
      { tenantId, data: { clientId: appClientId.trim(), clientSecret: appClientSecret.trim() } },
      {
        onSuccess: () => {
          setConnectPhase("completed");
          setAppClientSecret("");
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
          queryClient.invalidateQueries({ queryKey: getListTenantScansQueryKey(tenantId) });
        },
        onError: (error) => {
          setConnectPhase("error");
          setConnectError((error.data as ErrorResponse | undefined)?.error ?? "Erro ao conectar com a Microsoft. Verifique as credenciais.");
        },
      },
    );
  };

  const handleStartScan = (mode: ScanMode = "simple") => {
    startScan.mutate(
      { tenantId, data: { mode } },
      {
        onSuccess: () => {
          const modeLabel = mode === "advanced" ? "avançada" : "simples";
          toast({ title: "Varredura iniciada", description: `A auditoria ${modeLabel} foi iniciada.` });
          queryClient.invalidateQueries({ queryKey: getListTenantScansQueryKey(tenantId) });
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Erro ao iniciar",
            description: (error.data as ErrorResponse | undefined)?.error ?? "Não foi possível iniciar a varredura.",
          });
        },
      },
    );
  };

  const handleReconnect = () => {
    reconnectTenantMutation.mutate(
      { tenantId },
      {
        onSuccess: () => {
          toast({ title: "Reconexão iniciada", description: "Insira as credenciais do App Registration para reconectar o tenant." });
          setConnectPhase("idle");
          setConnectError(null);
          setAppClientId("");
          setAppClientSecret("");
          queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
        },
        onError: () => {
          toast({ variant: "destructive", title: "Erro", description: "Não foi possível iniciar a reconexão." });
        },
      },
    );
  };

  const handleDeleteTenant = () => {
    deleteTenant.mutate(
      { tenantId },
      {
        onSuccess: () => {
          toast({ title: "Tenant excluído", description: "O ambiente foi removido com sucesso." });
          setLocation("/tenants");
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Erro ao excluir",
            description: (error.data as ErrorResponse | undefined)?.error ?? "Não foi possível remover o tenant.",
          });
          setIsDeleteDialogOpen(false);
        },
      },
    );
  };

  const getScanStatusBadge = (status: ScanStatus) => {
    switch (status) {
      case ScanStatus.completed:
        return <Badge variant="default" className="bg-success hover:bg-success/80">Concluída</Badge>;
      case ScanStatus.running:
        return <Badge variant="secondary" className="bg-info hover:bg-info/80 text-info-foreground animate-pulse">Em Andamento</Badge>;
      case ScanStatus.pending:
        return <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>;
      case ScanStatus.failed:
        return <Badge variant="destructive">Falha</Badge>;
      default:
        return null;
    }
  };

  if (loadingTenant || loadingScans) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold">Tenant não encontrado</h2>
        <p className="text-muted-foreground mt-2">O ambiente solicitado não existe ou você não tem acesso.</p>
        <Link href="/tenants"><Button className="mt-6">Voltar para Tenants</Button></Link>
      </div>
    );
  }

  const isPending = tenant.status === TenantStatus.pending;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/tenants">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-display font-bold tracking-tight">{tenant.displayName}</h1>
              {tenant.status === TenantStatus.connected ? (
                <Badge className="bg-success hover:bg-success/80">Conectado</Badge>
              ) : tenant.status === TenantStatus.pending ? (
                <Badge variant="secondary" className="bg-warning text-warning-foreground">Pendente</Badge>
              ) : (
                <Badge variant="outline">Desconectado</Badge>
              )}
            </div>
            <div className="flex items-center text-sm text-muted-foreground gap-2 mt-1">
              <Server className="h-3 w-3" />
              <span>{tenant.primaryDomain || tenant.microsoftTenantId}</span>
              <span className="text-border">•</span>
              <span className="uppercase font-semibold tracking-wider">{tenant.scope}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleReconnect}
            disabled={reconnectTenantMutation.isPending}
            title="Reinicia o processo de autenticação do tenant"
          >
            {reconnectTenantMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Reconectar</span>
          </Button>
          <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Excluir</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Excluir Tenant</DialogTitle>
                <DialogDescription>
                  Tem certeza que deseja excluir o ambiente <strong>{tenant.displayName}</strong>?
                  Esta ação removerá todas as varreduras e vulnerabilidades associadas e não pode ser desfeita.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancelar</Button>
                <Button variant="destructive" onClick={handleDeleteTenant} disabled={deleteTenant.isPending}>
                  {deleteTenant.isPending ? "Excluindo..." : "Confirmar Exclusão"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={startScan.isPending}
                className="gap-2"
              >
                {startScan.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {startScan.isPending ? "Iniciando..." : "Nova Varredura"}
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Tipo de Varredura</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer gap-3 py-3"
                onClick={() => handleStartScan("simple")}
              >
                <Zap className="h-4 w-4 text-warning shrink-0" />
                <div>
                  <p className="font-medium">Simples</p>
                  <p className="text-xs text-muted-foreground">Avaliação probabilística sem credenciais</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-3 py-3"
                onClick={() => handleStartScan("advanced")}
                disabled={tenant.status !== TenantStatus.connected}
              >
                <Shield className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <p className="font-medium">Avançada</p>
                  <p className="text-xs text-muted-foreground">
                    {tenant.status === TenantStatus.connected
                      ? "Consulta real à API Microsoft 365"
                      : "Conecte o tenant primeiro"}
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isPending && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
                <Link2 className="h-5 w-5 text-warning" />
              </div>
              <div>
                <CardTitle>Conectar Tenant Microsoft</CardTitle>
                <CardDescription>
                  Configure um App Registration no Azure AD para habilitar varreduras avançadas de segurança.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">

            {connectPhase !== "completed" && (
              <>
                {/* Error banner */}
                {connectPhase === "error" && connectError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{connectError}</p>
                  </div>
                )}

                {/* Primary: OAuth automático */}
                <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Zap className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Conexão automática</p>
                      <p className="text-sm text-muted-foreground">
                        Clique no botão abaixo e faça login como Administrador Global do tenant <strong>{tenant.displayName}</strong>. As permissões são concedidas automaticamente — sem configuração manual no Azure.
                      </p>
                    </div>
                  </div>
                  <Button
                    className="gap-2 w-full sm:w-auto"
                    onClick={handleOAuthStart}
                    disabled={connectPhase === "connecting"}
                  >
                    {connectPhase === "connecting" && !showManualForm ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />Redirecionando para Microsoft...</>
                    ) : (
                      <><Shield className="h-4 w-4" />Conectar com Microsoft</>
                    )}
                  </Button>
                </div>

                {/* Divisor */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground">ou configure manualmente</span>
                  <div className="flex-1 border-t" />
                </div>

                {/* Secondary: formulário manual */}
                {!showManualForm ? (
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setShowManualForm(true)}
                  >
                    Já tenho um App Registration configurado — inserir credenciais manualmente
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
                      <p className="font-medium flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                        Requisitos do App Registration:
                      </p>
                      <ul className="space-y-1 text-muted-foreground list-disc list-inside pl-1">
                        <li>Tipo de conta: <strong>Contas neste diretório</strong> (single-tenant)</li>
                        <li>Permissões: <strong>Application</strong> (não Delegated) — <span className="font-mono text-[11px] bg-background border rounded px-1">Directory.Read.All</span>, <span className="font-mono text-[11px] bg-background border rounded px-1">User.Read.All</span>, <span className="font-mono text-[11px] bg-background border rounded px-1">Organization.Read.All</span> e demais</li>
                        <li>Admin consent concedido para todas as permissões</li>
                      </ul>
                      <a
                        href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        Criar App Registration no Azure Portal
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>

                    <form onSubmit={handleConnectWithApp} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="app-client-id">Application (Client) ID</Label>
                        <Input
                          id="app-client-id"
                          type="text"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          value={appClientId}
                          onChange={(e) => setAppClientId(e.target.value)}
                          spellCheck={false}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="app-client-secret">Client Secret</Label>
                        <div className="relative">
                          <Input
                            id="app-client-secret"
                            type={showSecret ? "text" : "password"}
                            placeholder="Valor do client secret gerado no Azure Portal"
                            value={appClientSecret}
                            onChange={(e) => setAppClientSecret(e.target.value)}
                            spellCheck={false}
                            required
                            className="pr-10"
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowSecret((v) => !v)}
                            tabIndex={-1}
                          >
                            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">Armazenado criptografado — nunca em texto claro.</p>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          type="submit"
                          className="gap-2"
                          disabled={!appClientId.trim() || !appClientSecret.trim() || connectPhase === "connecting"}
                        >
                          {connectPhase === "connecting" && showManualForm ? (
                            <><Loader2 className="h-4 w-4 animate-spin" />Validando...</>
                          ) : (
                            <><Link2 className="h-4 w-4" />Validar e Conectar</>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowManualForm(false)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  </div>
                )}
              </>
            )}

            {connectPhase === "completed" && (
              <div className="rounded-lg border border-success/40 bg-success/5 p-5">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                  <div>
                    <p className="font-medium text-success">Tenant conectado com sucesso!</p>
                    <p className="text-sm text-muted-foreground">As credenciais foram validadas e armazenadas. O tenant está pronto para varreduras avançadas.</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Críticas Abertas</span>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                <span className="text-3xl font-bold text-destructive font-mono">{tenant.criticalFindingsCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Total Abertas</span>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-warning" />
                <span className="text-3xl font-bold text-warning font-mono">{tenant.openFindingsCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardContent className="p-6 h-full flex flex-col justify-center">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground block">Última Varredura</span>
                {tenant.lastScanAt ? (
                  <span className="text-lg font-medium">
                    {format(new Date(tenant.lastScanAt), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                ) : (
                  <span className="text-lg text-muted-foreground italic">Nenhuma varredura realizada</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <TenantInquirySection tenantId={tenantId} tenantStatus={tenant.status} />

      <Card>
        <CardHeader>
          <CardTitle>Histórico de Varreduras</CardTitle>
          <CardDescription>Acompanhe as auditorias realizadas neste ambiente.</CardDescription>
        </CardHeader>
        <CardContent>
          {!scans || scans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
              <p className="text-lg font-medium">Nenhuma varredura encontrada</p>
              <p className="text-muted-foreground mt-2 max-w-sm">
                {isPending
                  ? "Inicie uma varredura simples agora ou conecte o tenant para habilitar varreduras avançadas."
                  : "Inicie uma nova varredura para identificar vulnerabilidades e configurações inseguras."}
              </p>
              <Button onClick={() => handleStartScan("simple")} className="mt-6 gap-2" disabled={startScan.isPending}>
                <Play className="h-4 w-4" />
                Iniciar Primeira Varredura (Simples)
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {scans.map((scan) => (
                <div
                  key={scan.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg hover:border-primary/50 transition-colors cursor-pointer group"
                  onClick={() => setLocation(`/scans/${scan.id}`)}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium text-base group-hover:text-primary transition-colors">
                        Auditoria de {format(new Date(scan.startedAt), "dd MMM yyyy", { locale: ptBR })}
                      </span>
                      {getScanStatusBadge(scan.status)}
                      {scan.scanMode === "advanced" ? (
                        <Badge variant="outline" className="gap-1 text-primary border-primary/40 bg-primary/5">
                          <Shield className="h-3 w-3" />Avançada
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-warning border-warning/40 bg-warning/5">
                          <Zap className="h-3 w-3" />Simples
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      Iniciada às {format(new Date(scan.startedAt), "HH:mm", { locale: ptBR })}
                      {scan.completedAt && (
                        <>
                          <span className="text-border">•</span>
                          Concluída às {format(new Date(scan.completedAt), "HH:mm", { locale: ptBR })}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-6 mt-4 sm:mt-0 w-full sm:w-auto border-t sm:border-t-0 pt-4 sm:pt-0">
                    <div className="flex gap-4 w-full sm:w-auto justify-between sm:justify-end">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">Checks</span>
                        <span className="font-mono text-sm">{scan.totalChecks}</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">Críticas</span>
                        <span className={`font-mono text-sm ${scan.criticalCount > 0 ? "text-destructive font-bold" : ""}`}>{scan.criticalCount}</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">Altas</span>
                        <span className={`font-mono text-sm ${scan.highCount > 0 ? "text-orange-500 font-bold" : ""}`}>{scan.highCount}</span>
                      </div>
                    </div>
                    <ExternalLink className="h-5 w-5 text-muted-foreground hidden sm:block group-hover:text-primary transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
