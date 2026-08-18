import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Bot, CheckCircle, ChevronDown, ChevronUp, Loader2, Send, XCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { SeverityBadge } from "@/components/ui/severity-badge";

const SEVERITY_ORDER: Severity[] = [
  Severity.critical,
  Severity.high,
  Severity.medium,
  Severity.low,
];

type ChatMessage = { role: "user" | "assistant"; content: string };

function renderAiText(text: string): React.ReactNode {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      out.push(<p key={i} className="font-semibold text-sm mt-2 mb-0.5">{line.slice(4)}</p>);
    } else if (line.startsWith("## ")) {
      out.push(<p key={i} className="font-bold text-sm mt-3 mb-1">{line.slice(3)}</p>);
    } else if (line.startsWith("# ")) {
      out.push(<p key={i} className="font-bold text-base mt-3 mb-1">{line.slice(2)}</p>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      out.push(<p key={i} className="text-sm ml-3 before:content-['•'] before:mr-1.5 before:text-muted-foreground">{renderInline(line.slice(2))}</p>);
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/)?.[1];
      out.push(<p key={i} className="text-sm ml-3">{num}. {renderInline(line.replace(/^\d+\.\s/, ""))}</p>);
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      out.push(<pre key={i} className="bg-muted rounded p-2 text-xs font-mono overflow-x-auto my-1 whitespace-pre-wrap">{codeLines.join("\n")}</pre>);
    } else if (line.startsWith("> ")) {
      out.push(<p key={i} className="text-sm border-l-2 border-primary pl-2 text-muted-foreground italic">{line.slice(2)}</p>);
    } else if (line.trim() === "") {
      out.push(<div key={i} className="h-1.5" />);
    } else {
      out.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    }
  }
  return <div className="space-y-0.5">{out}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="bg-muted px-1 rounded font-mono text-xs">{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function ControlChat({ findingId }: { findingId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setIsLoading(true);
    try {
      const data = await apiFetch<{ message?: string }>(`/device-findings/${findingId}/remediation-chat`, {
        method: "POST",
        body: JSON.stringify({ messages: next }),
      });
      if (data.message) {
        setMessages([...next, { role: "assistant", content: data.message }]);
      }
    } catch {
      setMessages([...next, { role: "assistant", content: "Falha ao conectar à IA. Tente novamente." }]);
    } finally {
      setIsLoading(false);
    }
  }

  const SUGGESTIONS = [
    "Como verificar se a correção foi aplicada?",
    "Existe um risco imediato para minha rede?",
    "Como implementar via linha de comando?",
  ];

  return (
    <div className="border-t border-primary/20 mt-3 pt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium text-primary">Assistente de Remediação IA</span>
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              className="text-xs px-2 py-1 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="space-y-2 mb-2 max-h-64 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {m.role === "assistant" ? renderAiText(m.content) : m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Pergunte sobre como corrigir esta vulnerabilidade..."
          className="resize-none text-xs min-h-[60px]"
          rows={2}
        />
        <Button size="icon" onClick={() => sendMessage()} disabled={!input.trim() || isLoading} className="self-end shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function DeviceScanContent({ scanId, deviceType }: { scanId: string; deviceType: DeviceType }) {
  const [, setLocation] = useLocation();
  const [openChatId, setOpenChatId] = useState<string | null>(null);

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
        <p className="text-muted-foreground">Varredura não encontrada.</p>
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
            {format(new Date(scan.startedAt), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
            {scan.completedAt &&
              ` • Concluída em ${format(new Date(scan.completedAt), "HH:mm")}`}
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
            <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">Crítico+Alto</p>
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
              Vulnerabilidades identificadas que precisam de atenção imediata. Use o assistente IA para obter orientação de remediação.
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
                    className="rounded-lg border border-destructive/20 bg-destructive/5 p-4"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                        <div className="space-y-1 flex-1">
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
                      {control.findingId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                          onClick={() => setOpenChatId(openChatId === control.findingId ? null : (control.findingId ?? null))}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          Consultar IA
                          {openChatId === control.findingId ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </Button>
                      )}
                    </div>
                    {control.findingId && openChatId === control.findingId && (
                      <ControlChat findingId={control.findingId} />
                    )}
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
