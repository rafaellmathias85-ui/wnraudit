import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Mail, Trash2, Pencil, FlaskConical, CheckCircle2, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type SmtpConfig = {
  id: string;
  displayName: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  status: "pending" | "verified" | "failed";
  lastTestedAt: string | null;
  createdAt: string;
};

type SmtpForm = {
  displayName: string;
  email: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
};

const EMPTY_FORM: SmtpForm = {
  displayName: "",
  email: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPass: "",
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

const STATUS_CONFIG = {
  pending:  { label: "Pendente",   variant: "secondary" as const, Icon: Clock },
  verified: { label: "Verificado", variant: "default"   as const, Icon: CheckCircle2 },
  failed:   { label: "Falhou",     variant: "destructive" as const, Icon: XCircle },
};

export default function PhishingSmtp() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SmtpConfig | null>(null);
  const [form, setForm] = useState<SmtpForm>(EMPTY_FORM);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: configs = [], isLoading } = useQuery<SmtpConfig[]>({
    queryKey: ["phishing-smtp"],
    queryFn: () => apiFetch("/phishing/smtp"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["phishing-smtp"] });

  const saveMutation = useMutation({
    mutationFn: (data: SmtpForm) => {
      const body = { ...data, smtpPort: Number(data.smtpPort) };
      if (editing) {
        const payload: Record<string, unknown> = { ...body };
        if (!data.smtpPass) delete payload.smtpPass;
        return apiFetch(`/phishing/smtp/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      return apiFetch("/phishing/smtp", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      invalidate();
      closeDialog();
      toast({ title: editing ? "Configuração atualizada" : "Configuração criada", description: "Clique em Testar para validar a conexão." });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/phishing/smtp/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro ao excluir", description: e.message }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean; status: string; error?: string }>(`/phishing/smtp/${id}/test`, { method: "POST" }),
    onMutate: (id) => setTestingId(id),
    onSettled: () => setTestingId(null),
    onSuccess: (data) => {
      invalidate();
      if (data.ok) {
        toast({ title: "Conexão bem-sucedida", description: "E-mail SMTP verificado e pronto para uso." });
      } else {
        toast({ variant: "destructive", title: "Falha na conexão", description: data.error ?? "Verifique as credenciais e tente novamente." });
      }
    },
    onError: (e: Error) => {
      invalidate();
      toast({ variant: "destructive", title: "Falha na conexão", description: e.message });
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(cfg: SmtpConfig) {
    setEditing(cfg);
    setForm({
      displayName: cfg.displayName,
      email: cfg.email,
      smtpHost: cfg.smtpHost,
      smtpPort: String(cfg.smtpPort),
      smtpUser: cfg.smtpUser,
      smtpPass: "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  const isFormValid =
    form.displayName.trim() &&
    form.email.trim() &&
    form.smtpHost.trim() &&
    form.smtpUser.trim() &&
    (editing ? true : form.smtpPass.trim());

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Configurações SMTP</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie os e-mails remetentes usados nas campanhas de phishing.
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Adicionar SMTP
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : configs.length === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg">Nenhuma conta SMTP configurada</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
              Adicione ao menos um e-mail SMTP para poder disparar campanhas de phishing.
            </p>
            <Button className="mt-6 gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Adicionar SMTP
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((cfg) => {
            const st = STATUS_CONFIG[cfg.status];
            const isTesting = testingId === cfg.id;
            return (
              <Card key={cfg.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{cfg.displayName}</span>
                        <Badge variant={st.variant} className="gap-1">
                          <st.Icon className="h-3 w-3" />
                          {st.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{cfg.email}</p>
                      <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                        <span>{cfg.smtpHost}:{cfg.smtpPort}</span>
                        <span>Usuário: {cfg.smtpUser}</span>
                        {cfg.lastTestedAt && (
                          <span>
                            Testado em {format(new Date(cfg.lastTestedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={isTesting}
                        onClick={() => testMutation.mutate(cfg.id)}
                      >
                        <FlaskConical className="h-3.5 w-3.5" />
                        {isTesting ? "Testando..." : "Testar"}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(cfg)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(cfg.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar configuração SMTP" : "Nova configuração SMTP"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome de exibição *</Label>
              <Input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Ex: TI Winner — Phishing"
              />
            </div>
            <div className="space-y-2">
              <Label>E-mail do remetente *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="phishing@seudominio.com.br"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>Servidor SMTP *</Label>
                <Input
                  value={form.smtpHost}
                  onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Porta *</Label>
                <Input
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => setForm((f) => ({ ...f, smtpPort: e.target.value }))}
                  placeholder="587"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Usuário SMTP *</Label>
              <Input
                value={form.smtpUser}
                onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))}
                placeholder="seu@email.com"
              />
            </div>
            <div className="space-y-2">
              <Label>{editing ? "Nova senha (deixe em branco para manter)" : "Senha SMTP *"}</Label>
              <Input
                type="password"
                value={form.smtpPass}
                onChange={(e) => setForm((f) => ({ ...f, smtpPass: e.target.value }))}
                placeholder={editing ? "••••••••" : "Senha ou app password"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button
              disabled={!isFormValid || saveMutation.isPending}
              onClick={() => saveMutation.mutate(form)}
            >
              {saveMutation.isPending ? "Salvando..." : editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
