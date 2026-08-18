import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Video, HelpCircle, Lock, ChevronRight, GraduationCap } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

type Module = {
  id: string;
  title: string;
  description: string;
  moduleType: string;
  isBuiltIn: boolean;
  createdAt: string;
};

const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  article: { label: "Artigo", icon: BookOpen, color: "text-blue-600" },
  video: { label: "Vídeo", icon: Video, color: "text-purple-600" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "text-orange-600" },
};

export default function AwarenessModulesList() {
  const { data: modules = [], isLoading } = useQuery<Module[]>({
    queryKey: ["awareness-modules"],
    queryFn: () => apiFetch("/awareness/modules"),
  });

  const builtins = modules.filter((m) => m.isBuiltIn);
  const custom = modules.filter((m) => !m.isBuiltIn);

  function ModuleCard({ m }: { m: Module }) {
    const cfg = TYPE_CONFIG[m.moduleType] ?? TYPE_CONFIG.article;
    return (
      <Card className="hover:border-primary/40 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <cfg.icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
                <span className="font-medium text-sm">{m.title}</span>
                {m.isBuiltIn && (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <Lock className="h-2.5 w-2.5" />
                    Pré-definido
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">{cfg.label}</Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{m.description}</p>
            </div>
            <Link href={`/awareness/${m.id}`}>
              <Button variant="ghost" size="icon" className="shrink-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Conscientização em Segurança</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Módulos de treinamento enviados automaticamente após campanhas de phishing.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : modules.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">Carregando módulos...</h3>
            <p className="text-muted-foreground text-sm mt-1">Os módulos pré-definidos serão criados automaticamente na primeira chamada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {builtins.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Módulos Pré-definidos</h2>
              {builtins.map((m) => <ModuleCard key={m.id} m={m} />)}
            </div>
          )}
          {custom.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Módulos Personalizados</h2>
              {custom.map((m) => <ModuleCard key={m.id} m={m} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
