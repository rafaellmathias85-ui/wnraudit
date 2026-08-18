import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Trash2, Upload, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

type Employee = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  tenantId: string | null;
  tenantDisplayName: string | null;
  createdAt: string;
};
type Tenant = { id: string; displayName: string; primaryDomain: string | null; status: string };

export default function PhishingEmployees() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isSyncOpen, setIsSyncOpen] = useState(false);
  const [syncTenantId, setSyncTenantId] = useState("");
  const [form, setForm] = useState({ name: "", email: "", department: "" });
  const [bulkText, setBulkText] = useState("");
  const [search, setSearch] = useState("");
  const [filterTenantId, setFilterTenantId] = useState("all");

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["phishing-employees"],
    queryFn: () => apiFetch("/phishing/employees"),
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["tenants"],
    queryFn: () => apiFetch("/tenants"),
  });
  const connectedTenants = tenants.filter((t) => t.status === "connected");

  // Unique tenants present in the employee list (for filter dropdown)
  const employeeTenants = Array.from(
    new Map(
      employees
        .filter((e) => e.tenantId && e.tenantDisplayName)
        .map((e) => [e.tenantId!, { id: e.tenantId!, displayName: e.tenantDisplayName! }]),
    ).values(),
  );

  const create = useMutation({
    mutationFn: (data: { name: string; email: string; department?: string }) =>
      apiFetch("/phishing/employees", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phishing-employees"] });
      setIsNewOpen(false);
      setForm({ name: "", email: "", department: "" });
      toast({ title: "Funcionário cadastrado" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const bulkCreate = useMutation({
    mutationFn: (employees: Array<{ name: string; email: string; department?: string }>) =>
      apiFetch("/phishing/employees/bulk", { method: "POST", body: JSON.stringify({ employees }) }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["phishing-employees"] });
      setIsBulkOpen(false);
      setBulkText("");
      toast({ title: `${Array.isArray(data) ? data.length : "?"} funcionários importados` });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  const syncFromTenant = useMutation({
    mutationFn: (tenantId: string) =>
      apiFetch<{ inserted: number; skipped: number; total: number }>(
        `/phishing/employees/sync-from-tenant/${tenantId}`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["phishing-employees"] });
      setIsSyncOpen(false);
      setSyncTenantId("");
      toast({ title: `Sincronização concluída`, description: `${data.inserted} novos funcionários importados, ${data.skipped} já existentes.` });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro na sincronização", description: e.message }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/phishing/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["phishing-employees"] }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Erro", description: e.message }),
  });

  function parseBulkText(text: string) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[;,]/).map((p) => p.trim());
        return { name: parts[0] ?? "", email: parts[1] ?? "", department: parts[2] ?? undefined };
      })
      .filter((e) => e.name && e.email);
  }

  const filtered = employees.filter((e) => {
    const matchesSearch =
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase()) ||
      (e.department ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesTenant =
      filterTenantId === "all" ||
      (filterTenantId === "none" ? !e.tenantId : e.tenantId === filterTenantId);
    return matchesSearch && matchesTenant;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Funcionários</h1>
          <p className="text-muted-foreground text-sm mt-1">Gerencie o diretório de funcionários para campanhas de phishing.</p>
        </div>
        <div className="flex gap-2">
          {/* Importar do Microsoft 365 */}
          <Dialog open={isSyncOpen} onOpenChange={setIsSyncOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" disabled={connectedTenants.length === 0} title={connectedTenants.length === 0 ? "Nenhum tenant Microsoft conectado" : undefined}>
                <RefreshCw className="h-4 w-4" />
                Importar do M365
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Importar Funcionários do Microsoft 365</DialogTitle>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Importa todos os usuários ativos do tenant Microsoft selecionado. Apenas e-mails ainda não cadastrados serão adicionados.
                </p>
                <div className="space-y-2">
                  <Label>Tenant Microsoft (cliente)</Label>
                  <Select value={syncTenantId} onValueChange={setSyncTenantId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {connectedTenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.displayName}{t.primaryDomain ? ` (${t.primaryDomain})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsSyncOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => syncTenantId && syncFromTenant.mutate(syncTenantId)}
                  disabled={!syncTenantId || syncFromTenant.isPending}
                >
                  {syncFromTenant.isPending ? "Importando..." : "Importar usuários"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isBulkOpen} onOpenChange={setIsBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Upload className="h-4 w-4" />
                Importar CSV
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Importar Funcionários</DialogTitle></DialogHeader>
              <div className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Cole uma linha por funcionário no formato:<br/>
                  <code className="bg-muted px-1 rounded text-xs">Nome Completo;email@empresa.com;Departamento</code>
                </p>
                <textarea
                  className="w-full h-48 p-3 rounded-md border bg-background font-mono text-sm resize-none"
                  placeholder={"João Silva;joao@empresa.com;Financeiro\nMaria Santos;maria@empresa.com;RH"}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{parseBulkText(bulkText).length} registros válidos detectados</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsBulkOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => bulkCreate.mutate(parseBulkText(bulkText))}
                  disabled={parseBulkText(bulkText).length === 0 || bulkCreate.isPending}
                >
                  {bulkCreate.isPending ? "Importando..." : `Importar ${parseBulkText(bulkText).length} registros`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isNewOpen} onOpenChange={setIsNewOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" />Novo Funcionário</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo Funcionário</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2"><Label>Nome completo *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
                <div className="space-y-2"><Label>E-mail corporativo *</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
                <div className="space-y-2"><Label>Departamento</Label><Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="Ex: Financeiro, RH, TI" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsNewOpen(false)}>Cancelar</Button>
                <Button onClick={() => create.mutate({ ...form, department: form.department || undefined })} disabled={!form.name || !form.email || create.isPending}>
                  {create.isPending ? "Salvando..." : "Cadastrar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Buscar por nome, e-mail ou departamento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {employeeTenants.length > 0 && (
          <Select value={filterTenantId} onValueChange={setFilterTenantId}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Filtrar por cliente..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              <SelectItem value="none">Sem cliente</SelectItem>
              {employeeTenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              {filtered.length} de {employees.length} funcionários
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                {employees.length === 0 ? "Nenhum funcionário cadastrado ainda." : "Nenhum resultado para a busca."}
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-6 py-3 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{e.name}</span>
                        {e.tenantDisplayName && (
                          <Badge variant="secondary" className="text-xs">{e.tenantDisplayName}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{e.email}{e.department ? ` · ${e.department}` : ""}</div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => del.mutate(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
