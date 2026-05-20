import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetSecurityCenterSummary,
  useListSecurityCenterEvents,
  getGetSecurityCenterSummaryQueryKey,
  getListSecurityCenterEventsQueryKey,
  Severity,
  SecurityEventSource,
} from "@workspace/api-client-react";

type SecurityCenterEventSource = SecurityEventSource;
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeverityBadge } from "@/components/ui/severity-badge";
import {
  Activity,
  Download,
  ShieldAlert,
  Filter,
  ExternalLink as ExternalLinkIcon,
  Search,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const SOURCE_LABEL: Record<SecurityCenterEventSource, string> = {
  m365: "Microsoft 365",
  firewall: "Firewall",
  server: "Servidor",
  external: "Externo",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  info: "Info",
};

export default function SecurityCenter() {
  const [, setLocation] = useLocation();
  const [source, setSource] = useState<SecurityCenterEventSource | "all">("all");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [q, setQ] = useState("");

  const params = useMemo(
    () => ({
      ...(source !== "all" ? { source } : {}),
      ...(severity !== "all" ? { severity } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
      limit: 500,
    }),
    [source, severity, q],
  );

  const { data: summary, isLoading: loadingSummary } = useGetSecurityCenterSummary({
    query: { queryKey: getGetSecurityCenterSummaryQueryKey() },
  });
  const { data: events, isLoading: loadingEvents } = useListSecurityCenterEvents(params, {
    query: { queryKey: getListSecurityCenterEventsQueryKey(params) },
  });

  const downloadPdf = () => {
    const url = new URL(
      `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/reports/security-center`,
    );
    if (source !== "all") url.searchParams.set("source", source);
    if (severity !== "all") url.searchParams.set("severity", severity);
    if (q.trim()) url.searchParams.set("q", q.trim());
    window.open(url.toString(), "_blank");
  };

  const goToDetail = (detailUrl: string) => {
    setLocation(detailUrl);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-3">
            <Activity className="h-7 w-7 text-primary" />
            Security Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Painel consolidado de eventos de segurança — Microsoft 365, dispositivos e exposição externa.
          </p>
        </div>
        <Button onClick={downloadPdf} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar PDF
        </Button>
      </div>

      {loadingSummary ? (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
          <Card>
            <CardContent className="p-4">
              <p className="text-3xl font-bold text-destructive">{summary.criticalCount}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Críticas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-3xl font-bold text-warning">{summary.highCount}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Altas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-3xl font-bold">{summary.mediumCount}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Médias</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-3xl font-bold text-muted-foreground">{summary.lowCount}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Baixas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-3xl font-bold">{summary.totalEvents}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Total aberto</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {summary && summary.bySource.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Eventos por origem</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {summary.bySource.map((s) => (
                  <div key={s.source} className="flex items-center justify-between text-sm">
                    <span>{SOURCE_LABEL[s.source]}</span>
                    <Badge variant="secondary">{s.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top categorias</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.topCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados.</p>
              ) : (
                <div className="space-y-2">
                  {summary.topCategories.map((c) => (
                    <div key={c.category} className="flex items-center justify-between text-sm">
                      <span className="truncate">{c.category}</span>
                      <Badge variant="secondary">{c.count}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Eventos
          </CardTitle>
          <CardDescription>Use os filtros para refinar; o PDF exportado segue os mesmos filtros.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Origem</Label>
              <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="m365">Microsoft 365</SelectItem>
                  <SelectItem value="firewall">Firewall</SelectItem>
                  <SelectItem value="server">Servidor</SelectItem>
                  <SelectItem value="external">Externo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Severidade</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="critical">Crítica</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Título, controle, recurso..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
          </div>

          {loadingEvents ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !events || events.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldAlert className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Nenhum evento corresponde aos filtros aplicados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severidade</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Alvo</TableHead>
                    <TableHead>Detectado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow
                      key={`${e.source}-${e.id}`}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => goToDetail(e.detailUrl)}
                    >
                      <TableCell>
                        <SeverityBadge severity={e.severity} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{SOURCE_LABEL[e.source]}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5 max-w-md">
                          <p className="font-medium text-sm truncate">{e.title}</p>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-mono">{e.controlId}</span> • {e.category}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5 max-w-xs">
                          <p className="text-sm truncate">{e.targetName}</p>
                          {e.affectedResource && (
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {e.affectedResource}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(e.detectedAt), "dd/MM HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        <ExternalLinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {events?.length ?? 0} {events?.length === 1 ? "evento" : "eventos"} listados
            {(events?.length ?? 0) >= 500 ? " (limite de 500 atingido — refine os filtros)" : ""}
          </p>
        </CardContent>
      </Card>

      {/* Marcador para suprimir warning de lint sobre tipo importado mas não usado em algumas builds */}
      <span hidden>{SEVERITY_LABEL.critical}</span>
    </div>
  );
}
