import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ShieldCheck, BookOpen, ChevronRight, Check, X } from "lucide-react";

type QuizQuestion = { question: string; options: string[]; correctIndex: number };
type Module = {
  id: string;
  title: string;
  description: string;
  contentMarkdown: string;
  moduleType: string;
  videoUrl: string | null;
  quizQuestions: QuizQuestion[] | null;
};
type TrainingData = { employeeName: string; modules: Module[] };

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) return undefined as T;
  return res.json();
}

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="text-2xl font-bold mt-6 mb-3">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-xl font-semibold mt-5 mb-2 text-primary">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-base font-semibold mt-4 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith("- ")) {
      elements.push(<li key={i} className="ml-4 list-disc text-sm leading-relaxed">{renderInline(line.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<li key={i} className="ml-4 list-decimal text-sm leading-relaxed">{renderInline(line.replace(/^\d+\.\s/, ""))}</li>);
    } else if (line.startsWith("> ")) {
      elements.push(<blockquote key={i} className="border-l-4 border-primary pl-4 my-2 text-sm italic text-muted-foreground">{line.slice(2)}</blockquote>);
    } else if (line.startsWith("|")) {
      elements.push(<div key={i} className="font-mono text-xs bg-muted p-1 rounded">{line}</div>);
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    }
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="bg-muted px-1 rounded font-mono text-xs">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function QuizSection({ questions, onComplete }: { questions: QuizQuestion[]; onComplete: (score: number) => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const score = submitted
    ? questions.filter((q, i) => answers[i] === q.correctIndex).length
    : 0;

  function handleSubmit() {
    if (Object.keys(answers).length < questions.length) return;
    setSubmitted(true);
    const pct = Math.round((questions.filter((q, i) => answers[i] === q.correctIndex).length / questions.length) * 100);
    onComplete(pct);
  }

  return (
    <div className="space-y-6 mt-4">
      {questions.map((q, qi) => (
        <div key={qi} className="space-y-3">
          <p className="font-medium text-sm">{qi + 1}. {q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const selected = answers[qi] === oi;
              const isCorrect = q.correctIndex === oi;
              let cls = "border rounded-md p-3 text-sm cursor-pointer transition-colors";
              if (!submitted) {
                cls += selected ? " border-primary bg-primary/5" : " hover:border-muted-foreground/40";
              } else {
                if (isCorrect) cls += " border-success bg-success/5 text-success";
                else if (selected && !isCorrect) cls += " border-destructive bg-destructive/5";
              }
              return (
                <label key={oi} className={cls}>
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name={`q${qi}`}
                      disabled={submitted}
                      checked={selected}
                      onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                      className="hidden"
                    />
                    <div className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${selected ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                      {selected && <div className="h-2 w-2 rounded-full bg-white" />}
                    </div>
                    {opt}
                    {submitted && isCorrect && <Check className="h-4 w-4 text-success ml-auto" />}
                    {submitted && selected && !isCorrect && <X className="h-4 w-4 text-destructive ml-auto" />}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {!submitted ? (
        <Button onClick={handleSubmit} disabled={Object.keys(answers).length < questions.length} className="w-full">
          Enviar respostas
        </Button>
      ) : (
        <div className={`p-4 rounded-md text-center ${score === questions.length ? "bg-success/10 border border-success/30" : "bg-muted"}`}>
          <div className="text-2xl font-bold">{score}/{questions.length}</div>
          <div className="text-sm text-muted-foreground mt-1">
            {score === questions.length ? "Parabéns! Respostas todas corretas." : "Revise os conteúdos e tente lembrar dessas dicas na próxima vez."}
          </div>
        </div>
      )}
    </div>
  );
}

// Confirmation screen shown when user came via the report-email footer link
function ReportedConfirmation({ employeeName }: { employeeName?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="text-7xl">✅</div>
        <h1 className="text-2xl font-bold text-green-700">Reporte registrado com sucesso!</h1>
        {employeeName && (
          <p className="text-muted-foreground text-sm">Olá, {employeeName}</p>
        )}
        <p className="text-muted-foreground leading-relaxed">
          Você identificou corretamente um <strong className="text-foreground">e-mail de phishing simulado</strong> e
          tomou a ação correta reportando-o ao departamento de TI.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Isso é exatamente o comportamento que esperamos. Parabéns pela atenção à segurança!
        </p>
        <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-5 py-2.5 rounded-full text-sm font-semibold border border-green-200">
          <ShieldCheck className="h-4 w-4" />
          Ação correta registrada
        </div>
      </div>
    </div>
  );
}

export default function PhishingTraining({ token }: { token: string }) {
  const search = useSearch();
  const action = new URLSearchParams(search).get("action"); // "report" when from report-email link

  const [activeModuleIdx, setActiveModuleIdx] = useState(0);
  const [completedModules, setCompletedModules] = useState<Set<string>>(new Set());
  const [reportDone, setReportDone] = useState(false);

  const { data, isLoading } = useQuery<TrainingData>({
    queryKey: ["phishing-training", token],
    queryFn: () => apiFetch(`/phishing/training/${token}`),
  });

  const recordCompletion = useMutation({
    mutationFn: ({ moduleId, score }: { moduleId: string; score?: number }) =>
      apiFetch(`/awareness/modules/${moduleId}/complete`, {
        method: "POST",
        body: JSON.stringify({ employeeId: "anonymous", score }),
      }),
  });

  // Fire events via POST (JavaScript-only — scanners cannot execute this)
  useEffect(() => {
    if (action === "report") {
      // Came from the email footer "reportar" link → record opened + reported
      fetch(`/api/phishing/track/${token}/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      })
        .then(() => setReportDone(true))
        .catch(() => setReportDone(true));
    } else {
      // Came from the phishing link button → record opened + clicked
      fetch(`/api/phishing/track/${token}/arrived`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    }
  }, [token, action]);

  // Show report confirmation screen (with loading state while POST fires)
  if (action === "report") {
    if (!reportDone || isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <Skeleton className="h-64 w-full max-w-md" />
        </div>
      );
    }
    return <ReportedConfirmation employeeName={data?.employeeName} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    );
  }

  const modules = data?.modules ?? [];
  const activeModule = modules[activeModuleIdx];

  return (
    <div className="min-h-screen bg-background">
      {/* Alert banner */}
      <div className="bg-orange-500 text-white px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-start gap-3">
          <AlertTriangle className="h-6 w-6 shrink-0 mt-0.5" />
          <div>
            <strong className="text-lg">Você clicou em um link de simulação de phishing!</strong>
            <p className="text-sm opacity-90 mt-1">
              Isso foi um teste de segurança autorizado pelo seu departamento de TI. Nenhum dado foi capturado.
              Reserve alguns minutos para revisar o conteúdo de treinamento abaixo.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3 mt-2">
          <ShieldCheck className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Treinamento de Segurança</h1>
            {data?.employeeName && <p className="text-muted-foreground text-sm">Olá, {data.employeeName}</p>}
          </div>
        </div>

        {modules.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Módulos de treinamento serão disponibilizados em breve.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            {/* Module list */}
            <div className="space-y-1">
              {modules.map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => setActiveModuleIdx(i)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                    i === activeModuleIdx ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                  }`}
                >
                  {completedModules.has(m.id) ? (
                    <Check className="h-3.5 w-3.5 text-success shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="leading-tight">{m.title}</span>
                </button>
              ))}
            </div>

            {/* Active module content */}
            {activeModule && (
              <Card>
                <CardHeader className="border-b pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{activeModule.title}</CardTitle>
                    {completedModules.has(activeModule.id) && (
                      <Badge variant="outline" className="text-success border-success/30 gap-1">
                        <Check className="h-3 w-3" />
                        Concluído
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{activeModule.description}</p>
                </CardHeader>
                <CardContent className="pt-4">
                  <SimpleMarkdown content={activeModule.contentMarkdown} />

                  {activeModule.quizQuestions && activeModule.quizQuestions.length > 0 && (
                    <div className="mt-6 pt-6 border-t">
                      <h3 className="font-semibold mb-4">Teste seus conhecimentos</h3>
                      <QuizSection
                        questions={activeModule.quizQuestions}
                        onComplete={(score) => {
                          setCompletedModules((s) => new Set([...s, activeModule.id]));
                          recordCompletion.mutate({ moduleId: activeModule.id, score });
                        }}
                      />
                    </div>
                  )}

                  {(!activeModule.quizQuestions || activeModule.quizQuestions.length === 0) && !completedModules.has(activeModule.id) && (
                    <Button
                      className="mt-6 w-full"
                      onClick={() => {
                        setCompletedModules((s) => new Set([...s, activeModule.id]));
                        recordCompletion.mutate({ moduleId: activeModule.id });
                      }}
                    >
                      Marcar como lido
                    </Button>
                  )}

                  {activeModuleIdx < modules.length - 1 && completedModules.has(activeModule.id) && (
                    <Button variant="outline" className="mt-3 w-full" onClick={() => setActiveModuleIdx(activeModuleIdx + 1)}>
                      Próximo módulo →
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {completedModules.size === modules.length && modules.length > 0 && (
          <Card className="border-success bg-success/5">
            <CardContent className="py-8 text-center">
              <ShieldCheck className="h-12 w-12 mx-auto text-success mb-3" />
              <h2 className="text-lg font-bold">Treinamento concluído!</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Você completou todos os módulos de segurança. Obrigado por contribuir com a segurança da empresa.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
