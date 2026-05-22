import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Eye, Lock } from "lucide-react";

type Template = {
  id: string;
  name: string;
  subject: string;
  category: string;
  isBuiltIn: boolean;
  htmlBody: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  m365: "Microsoft 365",
  financial: "Financeiro",
  hr: "RH",
  it: "TI",
  other: "Outro",
};

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export default function PhishingTemplates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [form, setForm] = useState({ name: "", subject: "", category: "other", htmlBody: "" });

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["phishing-templates"],
    queryFn: () => apiFetch("/phishing/templates"),
  });

  const create = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/phishing/templates", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phishing-templates"] });
      setIsNewOpen(false);
      setForm({ name: "", subject: "", category: "other", htmlBody: "" });
      toast({ title: "Template criado" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/phishing/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["phishing-templates"] }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Templates de Phishing</h1>
          <p className="text-muted-foreground text-sm mt-1">Templates pré-prontos e personalizados para campanhas de simulação.</p>
        </div>
        <Dialog open={isNewOpen} onOpenChange={setIsNewOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Novo Template</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Novo Template</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Nome do template *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2"><Label>Assunto do e-mail *</Label><Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></div>
              <div className="space-y-2">
                <Label>Corpo HTML *</Label>
                <p className="text-xs text-muted-foreground">Use <code className="bg-muted px-1 rounded">{"{{PHISHING_LINK}}"}</code> para o link rastreado e <code className="bg-muted px-1 rounded">{"{{TRACKING_PIXEL}}"}</code> para o pixel de abertura.</p>
                <textarea
                  className="w-full h-48 p-3 rounded-md border bg-background font-mono text-xs resize-y"
                  value={form.htmlBody}
                  onChange={(e) => setForm((f) => ({ ...f, htmlBody: e.target.value }))}
                  placeholder="<div>Seu e-mail aqui... <a href='{{PHISHING_LINK}}'>Clique aqui</a> {{TRACKING_PIXEL}}</div>"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsNewOpen(false)}>Cancelar</Button>
              <Button onClick={() => create.mutate(form)} disabled={!form.name || !form.subject || !form.htmlBody || create.isPending}>
                {create.isPending ? "Salvando..." : "Criar Template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Preview dialog */}
      <Dialog open={!!previewTemplate} onOpenChange={(o) => !o && setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            <p className="text-sm text-muted-foreground mb-2">Assunto: <strong>{previewTemplate?.subject}</strong></p>
            <div className="border rounded-md overflow-hidden" style={{ maxHeight: 400, overflowY: "auto" }}>
              <iframe
                title="preview"
                srcDoc={previewTemplate?.htmlBody ?? ""}
                sandbox="allow-same-origin"
                style={{ width: "100%", minHeight: 350, border: "none" }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className={t.isBuiltIn ? "border-primary/20 bg-primary/3" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {t.isBuiltIn && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <span className="font-medium text-sm leading-tight">{t.name}</span>
                    </div>
                    <Badge variant="outline" className="mt-1 text-xs">{CATEGORY_LABELS[t.category] ?? t.category}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground truncate mb-3">{t.subject}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1 flex-1" onClick={() => setPreviewTemplate(t)}>
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                  {!t.isBuiltIn && (
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => del.mutate(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
