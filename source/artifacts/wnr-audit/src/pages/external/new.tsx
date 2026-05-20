import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateExternalAsset,
  getListExternalAssetsQueryKey,
  ExternalAssetKind,
  type ErrorResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const KIND_OPTIONS: { value: ExternalAssetKind; label: string }[] = [
  { value: "firewall", label: "Firewall" },
  { value: "server", label: "Servidor" },
  { value: "web", label: "Website" },
  { value: "api", label: "API" },
  { value: "other", label: "Outro" },
];

export default function NewExternal() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateExternalAsset();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ExternalAssetKind>("firewall");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [notes, setNotes] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        data: {
          name: name.trim(),
          kind,
          host: host.trim(),
          port: port ? Number(port) : null,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: (asset) => {
          toast({ title: "Ativo cadastrado", description: "Pronto para iniciar a varredura." });
          queryClient.invalidateQueries({ queryKey: getListExternalAssetsQueryKey() });
          setLocation(`/external/${asset.id}`);
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Erro ao cadastrar",
            description: (err.data as ErrorResponse | undefined)?.error || "Tente novamente.",
          }),
      },
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/external">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-3">
            <Globe className="h-7 w-7 text-primary" />
            Novo ativo externo
          </h1>
          <p className="text-muted-foreground mt-1">
            Cadastre um IP público ou DDNS para análise de exposição.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados do ativo</CardTitle>
          <CardDescription>
            A varredura faz apenas testes não invasivos: portas TCP comuns, certificado TLS, cabeçalhos HTTP e DNS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome do ativo *</Label>
              <Input
                id="name"
                required
                placeholder="Ex: Firewall principal — Matriz"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="kind">Tipo *</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as ExternalAssetKind)}>
                  <SelectTrigger id="kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Porta específica (opcional)</Label>
                <Input
                  id="port"
                  type="number"
                  min="1"
                  max="65535"
                  placeholder="Ex: 443"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="host">Host (IP, DDNS ou domínio) *</Label>
              <Input
                id="host"
                required
                placeholder="200.10.20.30 ou cliente.dyndns.org"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Se omitir a porta, varremos as portas mais comuns (HTTP/HTTPS, SSH, RDP, SMTP, bancos, etc).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                rows={3}
                placeholder="Contexto, contato técnico, janela de manutenção, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Link href="/external">
                <Button type="button" variant="outline">
                  Cancelar
                </Button>
              </Link>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Salvando..." : "Cadastrar ativo"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
