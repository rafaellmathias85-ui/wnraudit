import { Link, useLocation } from "wouter";
import {
  useGetExternalScan,
  getGetExternalScanQueryKey,
  Severity,
  ScanStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, XCircle, ShieldAlert, ShieldCheck, CheckCircle, Globe } from "lucide-react";
import { SeverityBadge } from "@/components/ui/severity-badge";

const SEVERITY_ORDER: Severity[] = [
  Severity.critical,
  Severity.high,
  Severity.medium,
  Severity.low,
];

export default function ExternalScanDetail({ scanId }: { scanId: string }) {
  const [, setLocation] = useLocation();
  const { data: scan, isLoading } = useGetExternalScan(scanId, {
    query: { enabled: !!scanId, queryKey: getGetExternalScanQueryKey(scanId) },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[300px]" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Varredura não encontrada.</p>
        <Link href="/external">
          <Button variant="link" className="mt-4">
            Voltar
          </Button>
        </Link>
      </div>
    );
  }

  const failed = (scan.controls ?? []).filter((c) => c.status === "failed");

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          onClick={() => setLocation(`/external/${scan.deviceId}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-3">
            <Globe className="h-7 w-7 text-primary" />
            Varredura externa — {scan.deviceName}
          </h1>
          <p className="text-muted-foreground mt-1">
            {format(new Date(scan.startedAt), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", {
              locale: ptBR,
            })}
            {scan.completedAt && ` • Concluída às ${format(new Date(scan.completedAt), "HH:mm")}`}
          </p>
        </div>
      </div>

      {scan.status !== ScanStatus.completed && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {scan.status === ScanStatus.running
              ? "Varredura em andamento — recarregue em alguns instantes."
              : scan.status === ScanStatus.failed
                ? "A varredura falhou. Verifique se o host está acessível e tente novamente."
                : "Aguardando início..."}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-4xl font-bold text-success">{scan.passedChecks}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Verificações OK</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-4xl font-bold text-destructive">{scan.failedChecks}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Vulnerabilidades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-4xl font-bold text-destructive">{scan.criticalCount}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Críticas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-4xl font-bold text-warning">{scan.highCount}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Altas</p>
          </CardContent>
        </Card>
      </div>

      {failed.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Vulnerabilidades encontradas ({failed.length})
            </CardTitle>
            <CardDescription>
              Análise da superfície externa identificou os pontos abaixo. Priorize críticas e altas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {SEVERITY_ORDER.map((severity) => {
                const items = failed.filter((c) => c.severity === severity);
                if (items.length === 0) return null;
                return items.map((c) => (
                  <div
                    key={c.controlId + c.affectedResource}
                    className="flex items-start gap-3 p-4 rounded-lg border border-destructive/20 bg-destructive/5"
                  >
                    <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">{c.controlId}</span>
                        <SeverityBadge severity={c.severity} />
                        <Badge variant="outline" className="text-xs">{c.category}</Badge>
                      </div>
                      <p className="font-medium text-sm">{c.title}</p>
                      {c.affectedResource && (
                        <p className="text-xs text-muted-foreground font-mono break-all">
                          {c.affectedResource}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{c.recommendation}</p>
                    </div>
                  </div>
                ));
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {scan.status === ScanStatus.completed && failed.length === 0 && (
        <Card className="border-success/30">
          <CardContent className="p-6 flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-success" />
            <div>
              <p className="font-medium">Nenhuma vulnerabilidade encontrada</p>
              <p className="text-sm text-muted-foreground">
                Todos os {scan.totalChecks} testes executados passaram.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-success" />
            Findings detalhados ({scan.findings.length})
          </CardTitle>
          <CardDescription>Lista completa de itens detectados nesta análise</CardDescription>
        </CardHeader>
        <CardContent>
          {scan.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum item registrado.
            </p>
          ) : (
            <div className="space-y-2">
              {scan.findings.map((f) => (
                <div
                  key={f.id}
                  className="flex items-start gap-3 p-3 rounded-lg border"
                >
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{f.controlId}</span>
                      <SeverityBadge severity={f.severity} />
                      <Badge variant="outline" className="text-xs">{f.category}</Badge>
                    </div>
                    <p className="text-sm font-medium">{f.title}</p>
                    {f.affectedResource && (
                      <p className="text-xs text-muted-foreground font-mono break-all">
                        {f.affectedResource}
                      </p>
                    )}
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
