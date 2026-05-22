import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, BookOpen, Video, HelpCircle, Lock } from "lucide-react";

type QuizQuestion = { question: string; options: string[]; correctIndex: number };
type Module = {
  id: string;
  title: string;
  description: string;
  contentMarkdown: string;
  moduleType: string;
  isBuiltIn: boolean;
  videoUrl: string | null;
  quizQuestions: QuizQuestion[] | null;
};

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) elements.push(<h1 key={i} className="text-2xl font-bold mt-6 mb-3">{line.slice(2)}</h1>);
    else if (line.startsWith("## ")) elements.push(<h2 key={i} className="text-xl font-semibold mt-5 mb-2 text-primary">{line.slice(3)}</h2>);
    else if (line.startsWith("### ")) elements.push(<h3 key={i} className="text-base font-semibold mt-4 mb-1">{line.slice(4)}</h3>);
    else if (line.startsWith("- ")) elements.push(<li key={i} className="ml-4 list-disc text-sm leading-relaxed">{renderInline(line.slice(2))}</li>);
    else if (/^\d+\.\s/.test(line)) elements.push(<li key={i} className="ml-4 list-decimal text-sm leading-relaxed">{renderInline(line.replace(/^\d+\.\s/, ""))}</li>);
    else if (line.startsWith("> ")) elements.push(<blockquote key={i} className="border-l-4 border-primary pl-4 my-2 text-sm italic text-muted-foreground">{line.slice(2)}</blockquote>);
    else if (line.trim() === "") elements.push(<div key={i} className="h-2" />);
    else elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
  }
  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="bg-muted px-1 rounded font-mono text-xs">{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export default function AwarenessModuleDetail({ moduleId }: { moduleId: string }) {
  const { data: module, isLoading } = useQuery<Module>({
    queryKey: ["awareness-module", moduleId],
    queryFn: () => apiFetch(`/awareness/modules/${moduleId}`),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!module) {
    return <div className="text-center py-16 text-muted-foreground">Módulo não encontrado.</div>;
  }

  const TypeIcon = module.moduleType === "video" ? Video : module.moduleType === "quiz" ? HelpCircle : BookOpen;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/awareness">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeIcon className="h-4 w-4 text-primary" />
            <h1 className="text-xl font-display font-bold">{module.title}</h1>
            {module.isBuiltIn && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Lock className="h-2.5 w-2.5" />
                Pré-definido
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{module.description}</p>
        </div>
      </div>

      {module.videoUrl && (
        <Card>
          <CardContent className="p-4">
            <div className="aspect-video rounded-md overflow-hidden bg-black">
              <iframe
                src={module.videoUrl}
                className="w-full h-full"
                allowFullScreen
                title={module.title}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 pb-6">
          <SimpleMarkdown content={module.contentMarkdown} />
        </CardContent>
      </Card>

      {module.quizQuestions && module.quizQuestions.length > 0 && (
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <HelpCircle className="h-4 w-4" />
              Perguntas de Revisão
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-6">
              {module.quizQuestions.map((q, qi) => (
                <div key={qi}>
                  <p className="font-medium text-sm mb-2">{qi + 1}. {q.question}</p>
                  <div className="space-y-1">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className={`text-sm p-2 rounded-md ${oi === q.correctIndex ? "bg-success/10 text-success border border-success/20" : "bg-muted/50"}`}>
                        {oi === q.correctIndex ? "✓ " : "  "}{opt}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
