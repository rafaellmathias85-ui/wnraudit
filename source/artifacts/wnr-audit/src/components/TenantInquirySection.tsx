import { useState, type ReactElement } from "react";
import {
  useCreateTenantInquiry,
  useListTenantInquiries,
  useListTenantLicenses,
  getListTenantInquiriesQueryKey,
  getListTenantLicensesQueryKey,
  type TenantInquiry,
  type ErrorResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Sparkles, MessageSquare, Loader2, AlertCircle, KeyRound, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface Props {
  tenantId: string;
  tenantStatus: string;
}

const SUGGESTIONS = [
  "Como habilito o portal do cliente no Microsoft Intune?",
  "Quero exigir MFA para todos os usuários administradores. Como configuro no Entra ID?",
  "Como ativar o Microsoft Defender para Endpoint nos dispositivos gerenciados?",
  "Quais políticas de DLP posso aplicar no Exchange Online?",
  "Como bloquear acesso de aplicativos legados (Legacy Authentication)?",
];

function renderMarkdownLite(text: string): ReactElement {
  const lines = text.split("\n");
  const elements: ReactElement[] = [];
  let listBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;

  const flushList = (key: number) => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`l-${key}`} className="list-disc pl-6 space-y-1 my-2">
          {listBuffer.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      listBuffer = [];
    }
  };

  const flushCode = (key: number) => {
    if (codeBuffer.length > 0) {
      elements.push(
        <pre key={`c-${key}`} className="bg-muted/50 border rounded p-3 text-xs font-mono overflow-x-auto my-2">
          <code>{codeBuffer.join("\n")}</code>
        </pre>,
      );
      codeBuffer = [];
    }
  };

  lines.forEach((raw, i) => {
    const line = raw;
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode(i);
        inCode = false;
      } else {
        flushList(i);
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeBuffer.push(line);
      return;
    }
    if (line.startsWith("### ")) {
      flushList(i);
      elements.push(
        <h4 key={i} className="text-base font-semibold mt-4 mb-1">
          {line.slice(4)}
        </h4>,
      );
    } else if (line.startsWith("## ")) {
      flushList(i);
      elements.push(
        <h3 key={i} className="text-lg font-bold mt-4 mb-2 text-primary">
          {line.slice(3)}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      flushList(i);
      elements.push(
        <h2 key={i} className="text-xl font-bold mt-4 mb-2">
          {line.slice(2)}
        </h2>,
      );
    } else if (line.startsWith("> ")) {
      flushList(i);
      elements.push(
        <blockquote key={i} className="border-l-4 border-primary pl-3 italic text-muted-foreground my-2">
          {renderInline(line.slice(2))}
        </blockquote>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      listBuffer.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (/^\s*\d+\.\s+/.test(line)) {
      listBuffer.push(line.replace(/^\s*\d+\.\s+/, ""));
    } else if (line.trim() === "") {
      flushList(i);
      elements.push(<div key={`s-${i}`} className="h-2" />);
    } else {
      flushList(i);
      elements.push(
        <p key={i} className="my-1 leading-relaxed">
          {renderInline(line)}
        </p>,
      );
    }
  });
  flushList(lines.length);
  flushCode(lines.length);

  return <>{elements}</>;
}

function renderInline(text: string): ReactElement {
  const parts: Array<ReactElement | string> = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={key++} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = regex.lastIndex;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return <>{parts}</>;
}

export function TenantInquirySection({ tenantId, tenantStatus }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");

  const isConnected = tenantStatus === "connected";

  const { data: licenses, isPending: licensesLoading } = useListTenantLicenses(
    tenantId,
    {
      query: {
        enabled: isConnected,
        queryKey: getListTenantLicensesQueryKey(tenantId),
      },
    },
  );

  const { data: inquiries } = useListTenantInquiries(tenantId, {
    query: {
      enabled: isConnected,
      queryKey: getListTenantInquiriesQueryKey(tenantId),
    },
  });

  const createInquiry = useCreateTenantInquiry({
    mutation: {
      onSuccess: () => {
        setQuestion("");
        queryClient.invalidateQueries({
          queryKey: getListTenantInquiriesQueryKey(tenantId),
        });
        toast({
          title: "Resposta gerada",
          description: "A consulta foi processada com sucesso.",
        });
      },
      onError: (err: ErrorResponse | unknown) => {
        const msg =
          (err as ErrorResponse)?.error ?? "Falha ao processar consulta";
        toast({
          title: "Erro na consulta",
          description: msg,
          variant: "destructive",
        });
      },
    },
  });

  const handleSubmit = () => {
    if (question.trim().length < 3) return;
    createInquiry.mutate({
      tenantId,
      data: { question: question.trim() },
    });
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Consultas Inteligentes
          </CardTitle>
          <CardDescription>
            Conecte o tenant para fazer consultas sobre licenças e configurações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Tenant não conectado</AlertTitle>
            <AlertDescription>
              É necessário conectar o tenant antes de fazer consultas.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const activeSkus = (licenses?.skus ?? []).filter(
    (s) => s.consumedUnits > 0 || s.prepaidUnits > 0,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Consultas Inteligentes
          </CardTitle>
          <CardDescription>
            Faça perguntas sobre serviços Microsoft 365 — o sistema verifica as
            licenças do tenant e responde com um passo a passo de configuração nos
            consoles administrativos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Textarea
              placeholder="Ex: Como habilito o portal do cliente no Intune?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              disabled={createInquiry.isPending}
              className="resize-none"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuestion(s)}
                  disabled={createInquiry.isPending}
                  className="text-xs px-3 py-1 rounded-full border border-border hover:border-primary hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <Button
                onClick={handleSubmit}
                disabled={
                  createInquiry.isPending || question.trim().length < 3
                }
                className="gap-2"
              >
                {createInquiry.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Consultando licenças e gerando resposta...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Enviar consulta
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                Licenças identificadas no tenant
              </span>
              {licensesLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>
            {licensesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            ) : activeSkus.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Nenhuma licença ativa identificada.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {activeSkus.map((sku) => (
                  <Badge
                    key={sku.skuId}
                    variant="outline"
                    className="bg-primary/5 border-primary/30 text-foreground"
                    title={`${sku.skuPartNumber} — ${sku.consumedUnits}/${sku.prepaidUnits} usuários`}
                  >
                    {sku.displayName ?? sku.skuPartNumber}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({sku.consumedUnits}/{sku.prepaidUnits})
                    </span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Histórico de consultas
          </CardTitle>
          <CardDescription>
            {inquiries && inquiries.length > 0
              ? `${inquiries.length} consulta(s) realizadas para este tenant.`
              : "Nenhuma consulta realizada ainda."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!inquiries || inquiries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground mb-3 opacity-20" />
              <p className="text-sm text-muted-foreground max-w-sm">
                Faça sua primeira consulta acima para ver as respostas aqui.
              </p>
            </div>
          ) : (
            <Accordion
              type="single"
              collapsible
              defaultValue={inquiries[0]?.id}
              className="w-full"
            >
              {inquiries.map((inq: TenantInquiry) => (
                <AccordionItem key={inq.id} value={inq.id}>
                  <AccordionTrigger className="text-left hover:no-underline">
                    <div className="flex flex-col items-start text-left flex-1 mr-4">
                      <span className="font-medium text-sm leading-snug">
                        {inq.question}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        {inq.serviceDetected && (
                          <Badge variant="secondary" className="text-xs">
                            {inq.serviceDetected}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {format(
                            new Date(inq.createdAt),
                            "dd 'de' MMM 'de' yyyy 'às' HH:mm",
                            { locale: ptBR },
                          )}
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="prose prose-sm max-w-none text-sm pt-2 pb-4 px-1">
                      {renderMarkdownLite(inq.answer)}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
