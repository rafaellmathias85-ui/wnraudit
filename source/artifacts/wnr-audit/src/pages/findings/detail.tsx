import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  useGetFinding, 
  useUpdateFindingStatus,
  getGetFindingQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Clock, ShieldAlert, Server, CheckCircle, Info, FileJson, Link as LinkIcon, Edit, Navigation, ExternalLink, Copy, Check } from "lucide-react";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { FindingStatus } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export default function FindingDetail({ findingId }: { findingId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [note, setNote] = useState("");
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<FindingStatus | null>(null);
  const [pathCopied, setPathCopied] = useState(false);

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    });
  };

  const parseRemediationSteps = (text: string): string[] => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+\./.test(line))
      .map((line) => line.replace(/^\d+\.\s*/, ""));
  };

  const { data: finding, isLoading } = useGetFinding(findingId, {
    query: { enabled: !!findingId, queryKey: getGetFindingQueryKey(findingId) }
  });

  const updateStatus = useUpdateFindingStatus();

  const handleUpdateStatus = (status: FindingStatus) => {
    setPendingStatus(status);
    setIsUpdateOpen(true);
  };

  const confirmUpdateStatus = () => {
    if (!pendingStatus) return;
    
    updateStatus.mutate(
      { findingId, data: { status: pendingStatus, note: note || undefined } },
      {
        onSuccess: () => {
          toast({
            title: "Status atualizado",
            description: "O status da vulnerabilidade foi atualizado com sucesso.",
          });
          queryClient.invalidateQueries({ queryKey: getGetFindingQueryKey(findingId) });
          setIsUpdateOpen(false);
          setNote("");
          setPendingStatus(null);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Erro ao atualizar",
            description: "Não foi possível atualizar o status.",
          });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[300px]" />
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-[200px]" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold">Vulnerabilidade não encontrada</h2>
        <p className="text-muted-foreground mt-2">A descoberta solicitada não existe.</p>
        <Link href="/dashboard">
          <Button className="mt-6">Voltar para Dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href={`/scans/${finding.scanId}`}>
            <Button variant="ghost" size="icon" className="rounded-full mt-1">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">{finding.controlId}</Badge>
              <SeverityBadge severity={finding.severity} />
              <StatusBadge status={finding.status} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">{finding.title}</h1>
            <div className="flex flex-wrap items-center text-sm text-muted-foreground gap-x-4 gap-y-2 mt-2">
              <div className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">{finding.tenantName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>{finding.category}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Detectado em {format(new Date(finding.detectedAt), "dd MMM yyyy, HH:mm", { locale: ptBR })}</span>
              </div>
            </div>
          </div>
        </div>
        
        <Dialog open={isUpdateOpen} onOpenChange={setIsUpdateOpen}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="shrink-0 gap-2">
                <Edit className="h-4 w-4" />
                <span className="hidden sm:inline">Atualizar Status</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleUpdateStatus(FindingStatus.open)}>
                Marcar como Aberta
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleUpdateStatus(FindingStatus.resolved)}>
                Marcar como Resolvida
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleUpdateStatus(FindingStatus.ignored)}>
                Marcar como Ignorada
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Atualizar Status</DialogTitle>
              <DialogDescription>
                Deseja alterar o status para <strong>{pendingStatus === FindingStatus.open ? "Aberta" : pendingStatus === FindingStatus.resolved ? "Resolvida" : "Ignorada"}</strong>?
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <label className="text-sm font-medium mb-2 block">Nota (opcional)</label>
              <Textarea 
                placeholder="Adicione um comentário justificando a alteração de status..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsUpdateOpen(false)}>Cancelar</Button>
              <Button onClick={confirmUpdateStatus} disabled={updateStatus.isPending}>
                {updateStatus.isPending ? "Atualizando..." : "Confirmar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                Descrição
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 prose prose-sm dark:prose-invert max-w-none">
              <p className="text-base">{finding.description}</p>
              
              <h4 className="text-foreground font-semibold mt-6 mb-2">Fundamento (Rationale)</h4>
              <p>{finding.rationale}</p>

              {finding.affectedResource && (
                <>
                  <h4 className="text-foreground font-semibold mt-6 mb-2">Recurso Afetado</h4>
                  <div className="bg-muted p-3 rounded-md font-mono text-xs overflow-x-auto">
                    {finding.affectedResource}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {finding.configPath && (
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-3 border-b border-primary/20">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Navigation className="h-5 w-5 text-primary" />
                  Caminho de Configuração
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">Onde aplicar a correção no console Microsoft</p>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3 rounded-md bg-background border p-3">
                  <code className="flex-1 text-sm font-mono text-foreground break-all leading-relaxed">
                    {finding.configPath}
                  </code>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyPath(finding.configPath!)}
                      title="Copiar caminho"
                    >
                      {pathCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                {finding.references?.find(r => r.startsWith("http")) && (
                  <a
                    href={finding.references.find(r => r.startsWith("http"))}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-3 flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    Abrir documentação oficial Microsoft
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-success" />
                Passos para Remediação
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {parseRemediationSteps(finding.remediation).length > 0 ? (
                <ol className="space-y-3">
                  {parseRemediationSteps(finding.remediation).map((step, idx) => (
                    <li key={idx} className="flex gap-3">
                      <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                        {idx + 1}
                      </span>
                      <span className="text-sm leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="whitespace-pre-wrap text-sm">{finding.remediation}</p>
              )}
            </CardContent>
          </Card>

          {finding.evidence && (
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-muted-foreground" />
                  Evidência (JSON)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <pre className="bg-muted p-4 rounded-md font-mono text-xs overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify(finding.evidence, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg">Informações</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">CIS Benchmark</span>
                <span className="font-mono">{finding.controlId}</span>
              </div>
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Categoria</span>
                <span>{finding.category}</span>
              </div>
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Status Atual</span>
                <StatusBadge status={finding.status} className="mt-1" />
              </div>
            </CardContent>
          </Card>

          {finding.references && finding.references.length > 0 && (
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-lg flex items-center gap-2">
                  <LinkIcon className="h-5 w-5 text-muted-foreground" />
                  Referências
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <ul className="space-y-3">
                  {finding.references.map((ref, idx) => (
                    <li key={idx}>
                      <a 
                        href={ref} 
                        target="_blank" 
                        rel="noreferrer noopener"
                        className="text-sm text-primary hover:underline flex items-start gap-2 break-all"
                      >
                        <span className="shrink-0 mt-0.5">•</span>
                        {ref}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
