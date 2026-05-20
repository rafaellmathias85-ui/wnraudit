import { Link, useLocation } from "wouter";
import {
  useGetFirewallScan,
  useGetServerScan,
  getGetFirewallScanQueryKey,
  getGetServerScanQueryKey,
  Severity,
  ScanStatus,
  DeviceType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, CheckCircle, XCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { SeverityBadge } from "@/components/ui/severity-badge";

const SEVERITY_ORDER: Severity[] = [
  Severity.critical,
  Severity.high,
  Severity.medium,
  Severity.low,
];

function DeviceScanContent({ scanId, deviceType }: { scanId: string; deviceType: DeviceType }) {
  const [, setLocation] = useLocation();

  const fwQuery = useGetFirewallScan(scanId, {
    query: { enabled: deviceType === DeviceType.firewall, queryKey: getGetFirewallScanQueryKey(scanId) },
  });
  const srvQuery = useGetServerScan(scanId, {
    query: { enabled: deviceType === DeviceType.server, queryKey: getGetServerScanQueryKey(scanId) },
  });

  const { data: scan, isLoading } = deviceType === DeviceType.firewall ? fwQuery : srvQuery;

  const backPath = deviceType === DeviceType.firewall
    ? `/firewalls/${scan?.deviceId ?? ""}`
    : `/servers/${scan?.deviceId ?? ""}`;

  const backListPath = deviceType === DeviceType.firewall ? "/firewalls" : "/servers";

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
        <p className="text-muted-foreground">Varredura nao encontrada.</p>
        <Link href={backListPath}>
          <Button variant="link" className="mt-4">Voltar</Button>
        </Link>
      </div>
    );
  }

  const complianceScore =
    scan.totalChecks > 0 ? Math.round((scan.passedChecks / scan.totalChecks) * 100) : 0;

  const failedControls = (scan.controls ?? []).filter((c) => c.status === "failed");
  const passedControls = (scan.controls ?? []).filter((c) => c.status === "passed");

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-destructive";
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        {scan.deviceId ? (
          <Link href={backPath}>
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
        ) : (
          <Link href={backListPath}>
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
        )}
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">
            Varredura — {scan.deviceName}
          </h1>
          <p className="text-muted-foreground mt-1">
            {format(new Date(scan.startedAt), "dd 'de' MMMM 'de' yyyy 'as' HH:mm", { locale: ptBR })}
            {scan.completedAt &&
              ` • Concluida em ${format(new Date(scan.completedAt), "HH:mm")}`}
          </p>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className={`text-4xl font-bold font-display ${getScoreColor(complianceScore)}`}>
              {complianceScore}%
            </p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Score CIS</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-4xl font-bold text-success">{scan.passedChecks}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Aprovados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-4xl font-bold text-destructive">{scan.failedChecks}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Reprovados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-4xl font-bold text-destructive">{scan.criticalCount + scan.highCount}</p>
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Critico+Alto</p>
          </CardContent>
        </Card>
      </div>

      {failedControls.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Controles Reprovados ({failedControls.length})
            </CardTitle>
            <CardDescription>
              Vulnerabilidades identificadas que precisam de atencao imediata
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {SEVERITY_ORDER.map((severity) => {
                const controls = failedControls.filter((c) => c.severity === severity);
                if (controls.length === 0) return null;
                return controls.map((control) => (
                  <div
                    key={control.controlId}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg border border-destructive/20 bg-destructive/5 gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{control.controlId}</span>
                          <SeverityBadge severity={control.severity} />
                          <Badge variant="outline" className="text-xs">{control.category}</Badge>
                        </div>
                        <p className="font-medium text-sm">{control.title}</p>
                        {control.affectedResource && (
                          <p className="text-xs text-muted-foreground font-mono">{control.affectedResource}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{control.recommendation}</p>
                      </div>
                    </div>
                  </div>
                ));
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-success" />
            Todos os Controles Avaliados ({scan.totalChecks})
          </CardTitle>
          <CardDescription>Lista completa de controles CIS verificados nesta varredura</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...failedControls, ...passedControls].map((control) => (
              <div
                key={control.controlId}
                className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-lg border gap-3 ${
                  control.status === "passed"
                    ? "border-success/20 bg-success/5"
                    : "border-destructive/20 bg-destructive/5"
                }`}
              >
                <div className="flex items-start gap-3">
                  {control.status === "passed" ? (
                    <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{control.controlId}</span>
                      <SeverityBadge severity={control.severity} />
                      <Badge variant="outline" className="text-xs">{control.category}</Badge>
                    </div>
                    <p className="text-sm font-medium">{control.title}</p>
                    {control.status === "failed" && control.recommendation && (
                      <p className="text-xs text-muted-foreground">{control.recommendation}</p>
                    )}
                  </div>
                </div>
                <Badge
                  variant={control.status === "passed" ? "outline" : "destructive"}
                  className="shrink-0 text-xs"
                >
                  {control.status === "passed" ? "Aprovado" : "Reprovado"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DeviceScanDetail({
  scanId,
  deviceType,
}: {
  scanId: string;
  deviceType: DeviceType;
}) {
  return <DeviceScanContent scanId={scanId} deviceType={deviceType} />;
}
