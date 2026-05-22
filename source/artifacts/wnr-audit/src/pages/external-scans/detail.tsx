import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Loader2, Send, XCircle, ShieldAlert, ShieldCheck, CheckCircle, Globe } from "lucide-react";
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
      const res = await fetch(`/api/device-findings/${findingId}/remediation-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
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
    "Como corrigir este problema no servidor web?",
    "Qual é o impacto real desta vulnerabilidade?",
    "Como validar que a correção foi aplicada?",
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

export default function ExternalScanDetail({ scanId }: { scanId: string }) {
  const [, setLocation] = useLocation();
  const [openChatId, setOpenChatId] = useState<string | null>(null);

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
              Análise da superfície externa identificou os pontos abaixo. Use o assistente IA para orientação de remediação.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {SEVERITY_ORDER.map((severity) => {
                const items = failed.filter((c) => c.severity === severity);
                if (items.length === 0) return null;
                return items.map((c) => (
                  <div
                    key={c.controlId + (c.affectedResource ?? "")}
                    className="rounded-lg border border-destructive/20 bg-destructive/5 p-4"
                  >
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
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
                      {c.findingId && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                          onClick={() => setOpenChatId(openChatId === c.findingId ? null : (c.findingId ?? null))}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          Consultar IA
                          {openChatId === c.findingId ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </Button>
                      )}
                    </div>
                    {c.findingId && openChatId === c.findingId && (
                      <ControlChat findingId={c.findingId} />
                    )}
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
