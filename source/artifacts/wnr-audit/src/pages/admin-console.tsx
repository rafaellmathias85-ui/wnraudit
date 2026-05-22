import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  AppWindow,
  Ban,
  CheckCircle2,
  Download,
  Eye,
  ExternalLink,
  FileSearch,
  FileText,
  FolderOpen,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type Tenant = {
  id: string;
  microsoftTenantId: string;
  displayName: string;
  primaryDomain: string | null;
  status: "pending" | "connected" | "error" | "disconnected";
};

type GraphList<T> = { value: T[] };

type DirectoryUser = {
  id: string;
  displayName: string | null;
  userPrincipalName: string;
  mail: string | null;
  accountEnabled: boolean;
  jobTitle: string | null;
  department: string | null;
};

type DirectoryGroup = {
  id: string;
  displayName: string | null;
  mail: string | null;
  mailEnabled: boolean;
  securityEnabled: boolean;
  description: string | null;
};

type DirectoryApplication = {
  id: string;
  appId: string;
  displayName: string | null;
  signInAudience: string | null;
  createdDateTime: string | null;
};

type PermissionStatus = {
  roles: string[];
  requiredRoles: string[];
  missingRoles: string[];
  ready: boolean;
};

type TenantFile = {
  id: string;
  name: string;
  webUrl: string | null;
  size: number | null;
  lastModifiedDateTime: string | null;
  mimeType: string | null;
  isFolder: boolean;
  driveId: string | null;
  siteId: string | null;
  path: string | null;
};

type FilePreview = {
  getUrl?: string;
  postUrl?: string;
  postParameters?: string;
};

type AdminEntity = "user" | "group" | "application";
type DialogMode = "create" | "edit" | "password" | "member";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 204) return null as T;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

function queryKey(tenantId: string | null, scope: string, extra?: string) {
  return ["admin-console", tenantId, scope, extra ?? ""];
}

function StatusBadge({ tenant }: { tenant: Tenant }) {
  if (tenant.status === "connected") {
    return <Badge className="bg-success hover:bg-success/80">Conectado</Badge>;
  }
  return <Badge variant="outline">Indisponivel</Badge>;
}

export default function AdminConsole() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState<string>("");
  const [userSearch, setUserSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [folderStack, setFolderStack] = useState<Array<{ id: string; driveId: string; name: string }>>([]);
  const [activeTab, setActiveTab] = useState("users");
  const [dialog, setDialog] = useState<{
    entity: AdminEntity;
    mode: DialogMode;
    item?: DirectoryUser | DirectoryGroup | DirectoryApplication;
  } | null>(null);
  const [secretText, setSecretText] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<{
    file: TenantFile;
    preview: FilePreview | null;
  } | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ["admin-console", "tenants"],
    queryFn: () => apiFetch<Tenant[]>("/admin-console/tenants"),
  });

  const tenants = tenantsQuery.data ?? [];
  const connectedTenants = tenants.filter((t) => t.status === "connected");
  const selectedTenant = tenants.find((t) => t.id === tenantId) ?? null;

  useEffect(() => {
    if (!tenantId && connectedTenants[0]) {
      setTenantId(connectedTenants[0].id);
    }
  }, [connectedTenants, tenantId]);

  useEffect(() => {
    setFolderStack([]);
  }, [tenantId]);

  const usersQuery = useQuery({
    queryKey: queryKey(tenantId || null, "users", userSearch),
    enabled: Boolean(tenantId) && activeTab === "users",
    queryFn: () =>
      apiFetch<GraphList<DirectoryUser>>(
        `/admin-console/tenants/${tenantId}/users${userSearch.trim() ? `?search=${encodeURIComponent(userSearch.trim())}` : ""}`,
      ),
  });

  const groupsQuery = useQuery({
    queryKey: queryKey(tenantId || null, "groups"),
    enabled: Boolean(tenantId) && activeTab === "groups",
    queryFn: () => apiFetch<GraphList<DirectoryGroup>>(`/admin-console/tenants/${tenantId}/groups`),
  });

  const appsQuery = useQuery({
    queryKey: queryKey(tenantId || null, "applications"),
    enabled: Boolean(tenantId) && activeTab === "applications",
    queryFn: () =>
      apiFetch<GraphList<DirectoryApplication>>(`/admin-console/tenants/${tenantId}/applications`),
  });

  const permissionsQuery = useQuery({
    queryKey: queryKey(tenantId || null, "permissions"),
    enabled: Boolean(tenantId),
    queryFn: () => apiFetch<PermissionStatus>(`/admin-console/tenants/${tenantId}/permissions`),
  });

  const filesQuery = useQuery({
    queryKey: queryKey(tenantId || null, "files", fileSearch.trim()),
    enabled: Boolean(tenantId) && activeTab === "files" && fileSearch.trim().length >= 2,
    queryFn: () =>
      apiFetch<GraphList<TenantFile>>(
        `/admin-console/tenants/${tenantId}/files/search?q=${encodeURIComponent(fileSearch.trim())}`,
      ),
  });

  const currentFolder = folderStack[folderStack.length - 1] ?? null;
  const browseQuery = useQuery({
    queryKey: queryKey(tenantId || null, "files-browse", currentFolder?.id ?? ""),
    enabled: Boolean(tenantId) && activeTab === "files" && Boolean(currentFolder),
    queryFn: () =>
      apiFetch<GraphList<TenantFile>>(
        `/admin-console/tenants/${tenantId}/files/browse?driveId=${encodeURIComponent(currentFolder!.driveId)}&itemId=${encodeURIComponent(currentFolder!.id)}`,
      ),
  });

  const refreshActive = () => {
    const scope =
      activeTab === "users"
        ? "users"
        : activeTab === "groups"
          ? "groups"
          : activeTab === "applications"
            ? "applications"
            : "files";
    queryClient.invalidateQueries({ queryKey: queryKey(tenantId || null, scope) });
    queryClient.invalidateQueries({ queryKey: queryKey(tenantId || null, "permissions") });
    if (scope === "users") {
      queryClient.invalidateQueries({ queryKey: queryKey(tenantId || null, scope, userSearch) });
    }
    if (scope === "files") {
      queryClient.invalidateQueries({ queryKey: queryKey(tenantId || null, scope, fileSearch.trim()) });
    }
  };

  const mutation = useMutation({
    mutationFn: async (opts: { method: string; path: string; body?: unknown }) =>
      apiFetch<unknown>(opts.path, {
        method: opts.method,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }),
    onSuccess: () => {
      refreshActive();
      setDialog(null);
      toast({ title: "Operacao concluida" });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Falha no Admin Console",
        description: error instanceof Error ? error.message : "Nao foi possivel executar a acao.",
      });
    },
  });

  const users = usersQuery.data?.value ?? [];
  const groups = groupsQuery.data?.value ?? [];
  const applications = appsQuery.data?.value ?? [];
  const isInFolder = folderStack.length > 0;
  const activeFilesQuery = isInFolder ? browseQuery : filesQuery;
  const files = activeFilesQuery.data?.value ?? [];
  const permissions = permissionsQuery.data ?? null;
  const busy = mutation.isPending;

  const previewMutation = useMutation({
    mutationFn: async (file: TenantFile) => {
      if (!tenantId) throw new Error("Selecione um tenant.");
      if (!file.driveId) throw new Error("Este item nao tem driveId para preview.");
      const preview = await apiFetch<FilePreview>(`/admin-console/tenants/${tenantId}/files/preview`, {
        method: "POST",
        body: JSON.stringify({ driveId: file.driveId, itemId: file.id }),
      });
      return { file, preview };
    },
    onSuccess: (result) => setFilePreview(result),
    onError: (error) =>
      toast({
        variant: "destructive",
        title: "Falha ao abrir preview",
        description: error instanceof Error ? error.message : "Nao foi possivel abrir o arquivo.",
      }),
  });

  const downloadMutation = useMutation({
    mutationFn: async (file: TenantFile) => {
      if (!tenantId) throw new Error("Selecione um tenant.");
      if (!file.driveId) throw new Error("Este item nao tem driveId para download.");
      const params = new URLSearchParams({ driveId: file.driveId, itemId: file.id });
      if (file.webUrl) params.set("webUrl", file.webUrl);
      const result = await apiFetch<{ downloadUrl: string }>(
        `/admin-console/tenants/${tenantId}/files/download?${params}`,
      );
      return result.downloadUrl;
    },
    onSuccess: (url) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: (error) =>
      toast({
        variant: "destructive",
        title: "Falha ao baixar arquivo",
        description: error instanceof Error ? error.message : "Nao foi possivel obter o link de download.",
      }),
  });

  const consentMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Selecione um tenant.");
      return apiFetch<{ authUrl: string }>(`/tenants/${tenantId}/provision/oauth/start`, {
        method: "POST",
      });
    },
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Nao foi possivel iniciar o consentimento",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    },
  });

  const tenantOptions = useMemo(
    () =>
      tenants.map((tenant) => (
        <option key={tenant.id} value={tenant.id} disabled={tenant.status !== "connected"}>
          {tenant.displayName} {tenant.primaryDomain ? `(${tenant.primaryDomain})` : ""}
        </option>
      )),
    [tenants],
  );

  const submitDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog || !tenantId) return;

    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();

    if (dialog.entity === "user") {
      if (dialog.mode === "create") {
        mutation.mutate({
          method: "POST",
          path: `/admin-console/tenants/${tenantId}/users`,
          body: {
            displayName: value("displayName"),
            userPrincipalName: value("userPrincipalName"),
            mailNickname: value("mailNickname"),
            password: value("password"),
          },
        });
        return;
      }

      if (dialog.mode === "edit" && dialog.item) {
        mutation.mutate({
          method: "PATCH",
          path: `/admin-console/tenants/${tenantId}/users/${encodeURIComponent(dialog.item.id)}`,
          body: {
            displayName: value("displayName"),
            jobTitle: value("jobTitle"),
            department: value("department"),
          },
        });
        return;
      }

      if (dialog.mode === "password" && dialog.item) {
        mutation.mutate({
          method: "PATCH",
          path: `/admin-console/tenants/${tenantId}/users/${encodeURIComponent(dialog.item.id)}`,
          body: { password: value("password") },
        });
      }
    }

    if (dialog.entity === "group") {
      if (dialog.mode === "create") {
        mutation.mutate({
          method: "POST",
          path: `/admin-console/tenants/${tenantId}/groups`,
          body: {
            displayName: value("displayName"),
            mailNickname: value("mailNickname"),
            description: value("description"),
          },
        });
        return;
      }

      if (dialog.mode === "edit" && dialog.item) {
        mutation.mutate({
          method: "PATCH",
          path: `/admin-console/tenants/${tenantId}/groups/${encodeURIComponent(dialog.item.id)}`,
          body: { displayName: value("displayName"), description: value("description") },
        });
        return;
      }

      if (dialog.mode === "member" && dialog.item) {
        mutation.mutate({
          method: "POST",
          path: `/admin-console/tenants/${tenantId}/groups/${encodeURIComponent(dialog.item.id)}/members`,
          body: { userId: value("userId") },
        });
      }
    }

    if (dialog.entity === "application") {
      if (dialog.mode === "create") {
        mutation.mutate({
          method: "POST",
          path: `/admin-console/tenants/${tenantId}/applications`,
          body: { displayName: value("displayName") },
        });
        return;
      }

      if (dialog.mode === "edit" && dialog.item) {
        mutation.mutate({
          method: "PATCH",
          path: `/admin-console/tenants/${tenantId}/applications/${encodeURIComponent(dialog.item.id)}`,
          body: { displayName: value("displayName") },
        });
        return;
      }

      if (dialog.mode === "password" && dialog.item) {
        apiFetch<{ secretText: string }>(
          `/admin-console/tenants/${tenantId}/applications/${encodeURIComponent(dialog.item.id)}/passwords`,
          {
            method: "POST",
            body: JSON.stringify({ displayName: value("displayName") }),
          },
        )
          .then((result) => {
            setSecretText(result.secretText);
            setDialog(null);
            toast({ title: "Client secret gerado" });
          })
          .catch((error) =>
            toast({
              variant: "destructive",
              title: "Falha ao gerar segredo",
              description: error instanceof Error ? error.message : "Tente novamente.",
            }),
          );
      }
    }
  };

  const deleteItem = (entity: AdminEntity, id: string, label: string) => {
    if (!tenantId) return;
    if (!window.confirm(`Confirma a exclusao de ${label}? Esta acao ocorre no tenant real.`)) return;

    const path =
      entity === "user"
        ? `/admin-console/tenants/${tenantId}/users/${encodeURIComponent(id)}`
        : entity === "group"
          ? `/admin-console/tenants/${tenantId}/groups/${encodeURIComponent(id)}`
          : `/admin-console/tenants/${tenantId}/applications/${encodeURIComponent(id)}`;

    mutation.mutate({ method: "DELETE", path });
  };

  const toggleUser = (user: DirectoryUser) => {
    if (!tenantId) return;
    mutation.mutate({
      method: "PATCH",
      path: `/admin-console/tenants/${tenantId}/users/${encodeURIComponent(user.id)}`,
      body: { accountEnabled: !user.accountEnabled },
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-3">
            <ShieldCheck className="h-7 w-7 text-primary" />
            Admin Console
          </h1>
          <p className="text-muted-foreground mt-1">
            Execute acoes administrativas nos tenants Microsoft conectados ao WNR-Audit.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="min-w-[280px] space-y-1.5">
            <Label htmlFor="tenant-select">Tenant</Label>
            <select
              id="tenant-select"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
            >
              {tenantOptions}
            </select>
          </div>
          <Button variant="outline" className="gap-2 sm:mt-6" onClick={refreshActive} disabled={!tenantId}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </Button>
        </div>
      </div>

      {tenantsQuery.isLoading ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ) : connectedTenants.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="font-medium">Nenhum tenant conectado disponivel.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Conecte um tenant Microsoft antes de usar o Admin Console.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {selectedTenant && (
            <Card>
              <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{selectedTenant.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedTenant.primaryDomain || selectedTenant.microsoftTenantId}
                  </p>
                </div>
                <StatusBadge tenant={selectedTenant} />
              </CardContent>
            </Card>
          )}

          {permissions && !permissions.ready && (
            <Card className="border-warning/50 bg-warning/5">
              <CardContent className="p-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Permissoes de escrita ainda nao chegaram no token deste tenant</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Seu usuario pode ser Administrador Global, mas o Admin Console executa pelo App WNR-Audit.
                      O token atual ainda nao contem estas roles de aplicacao:
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {permissions.missingRoles.map((role) => (
                        <Badge key={role} variant="outline" className="bg-background font-mono text-[11px]">
                          {role}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Primeiro adicione essas permissoes em Microsoft Graph &gt; Application permissions no App Registration WNR-Audit.
                      Depois clique em atualizar consentimento e entre como Administrador Global.
                    </p>
                  </div>
                </div>
                <Button
                  className="gap-2 lg:mt-1"
                  onClick={() => consentMutation.mutate()}
                  disabled={consentMutation.isPending}
                >
                  {consentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  Atualizar consentimento
                </Button>
              </CardContent>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="users" className="gap-2">
                <Users className="h-4 w-4" />
                Usuarios
              </TabsTrigger>
              <TabsTrigger value="groups" className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                Grupos
              </TabsTrigger>
              <TabsTrigger value="applications" className="gap-2">
                <AppWindow className="h-4 w-4" />
                Aplicativos
              </TabsTrigger>
              <TabsTrigger value="files" className="gap-2">
                <FileSearch className="h-4 w-4" />
                Arquivos
              </TabsTrigger>
            </TabsList>

            <TabsContent value="users">
              <Card>
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>Usuarios do tenant</CardTitle>
                    <CardDescription>Crie, edite, bloqueie, redefina senha ou remova contas.</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9 w-[220px]"
                        placeholder="Buscar por nome ou UPN"
                        value={userSearch}
                        onChange={(event) => setUserSearch(event.target.value)}
                      />
                    </div>
                    <Button className="gap-2" onClick={() => setDialog({ entity: "user", mode: "create" })}>
                      <UserPlus className="h-4 w-4" />
                      Criar
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {usersQuery.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Usuario</TableHead>
                          <TableHead>Cargo</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Acoes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell>
                              <div className="font-medium">{user.displayName || user.userPrincipalName}</div>
                              <div className="text-xs text-muted-foreground">{user.userPrincipalName}</div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {user.jobTitle || user.department || "-"}
                            </TableCell>
                            <TableCell>
                              {user.accountEnabled ? (
                                <Badge variant="outline">Ativo</Badge>
                              ) : (
                                <Badge variant="destructive">Bloqueado</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ entity: "user", mode: "edit", item: user })}>
                                  <Save className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ entity: "user", mode: "password", item: user })}>
                                  <KeyRound className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => toggleUser(user)} disabled={busy}>
                                  {user.accountEnabled ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => deleteItem("user", user.id, user.userPrincipalName)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="groups">
              <Card>
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>Grupos</CardTitle>
                    <CardDescription>Gerencie grupos de seguranca e membros.</CardDescription>
                  </div>
                  <Button className="gap-2" onClick={() => setDialog({ entity: "group", mode: "create" })}>
                    <Plus className="h-4 w-4" />
                    Criar grupo
                  </Button>
                </CardHeader>
                <CardContent>
                  {groupsQuery.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Grupo</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead className="text-right">Acoes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groups.map((group) => (
                          <TableRow key={group.id}>
                            <TableCell>
                              <div className="font-medium">{group.displayName}</div>
                              <div className="text-xs text-muted-foreground">{group.mail || group.description || group.id}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{group.securityEnabled ? "Seguranca" : "Grupo"}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ entity: "group", mode: "edit", item: group })}>
                                  <Save className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ entity: "group", mode: "member", item: group })}>
                                  <UserPlus className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => deleteItem("group", group.id, group.displayName || group.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="applications">
              <Card>
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>Aplicativos registrados</CardTitle>
                    <CardDescription>Crie App Registrations, renomeie e gere client secrets.</CardDescription>
                  </div>
                  <Button className="gap-2" onClick={() => setDialog({ entity: "application", mode: "create" })}>
                    <Plus className="h-4 w-4" />
                    Criar app
                  </Button>
                </CardHeader>
                <CardContent>
                  {appsQuery.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Aplicativo</TableHead>
                          <TableHead>Client ID</TableHead>
                          <TableHead className="text-right">Acoes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {applications.map((app) => (
                          <TableRow key={app.id}>
                            <TableCell>
                              <div className="font-medium">{app.displayName}</div>
                              <div className="text-xs text-muted-foreground">{app.signInAudience || "AzureADMyOrg"}</div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{app.appId}</TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ entity: "application", mode: "edit", item: app })}>
                                  <Save className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ entity: "application", mode: "password", item: app })}>
                                  <KeyRound className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => deleteItem("application", app.id, app.displayName || app.appId)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="files">
              <Card>
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle>Arquivos do tenant</CardTitle>
                    <CardDescription>
                      Busque arquivos em Teams, grupos Microsoft 365 e bibliotecas SharePoint.
                    </CardDescription>
                  </div>
                  <div className="relative w-full md:w-[360px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Buscar por nome, extensão ou conteúdo"
                      value={fileSearch}
                      onChange={(event) => {
                        setFileSearch(event.target.value);
                        if (folderStack.length > 0) setFolderStack([]);
                      }}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  {isInFolder && (
                    <div className="flex items-center gap-1 flex-wrap mb-4 text-sm">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-muted-foreground"
                        onClick={() => setFolderStack([])}
                      >
                        <Search className="h-3 w-3" />
                        Busca
                      </Button>
                      {folderStack.map((folder, i) => (
                        <Fragment key={folder.id}>
                          <span className="text-muted-foreground">/</span>
                          <Button
                            size="sm"
                            variant={i === folderStack.length - 1 ? "secondary" : "ghost"}
                            className="h-7"
                            onClick={() => setFolderStack((prev) => prev.slice(0, i + 1))}
                          >
                            {folder.name}
                          </Button>
                        </Fragment>
                      ))}
                    </div>
                  )}
                  {!isInFolder && fileSearch.trim().length < 2 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <FileSearch className="h-10 w-10 text-muted-foreground opacity-40" />
                      <p className="font-medium mt-3">Digite pelo menos 2 caracteres para buscar.</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        A busca consulta arquivos acessíveis via Microsoft Graph no tenant selecionado.
                      </p>
                    </div>
                  ) : activeFilesQuery.isLoading ? (
                    <Skeleton className="h-48 w-full" />
                  ) : activeFilesQuery.isError ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <AlertTriangle className="h-10 w-10 text-destructive opacity-80" />
                      <p className="font-medium mt-3">Erro ao buscar arquivos.</p>
                      <p className="text-sm text-muted-foreground mt-1 max-w-lg">
                        {activeFilesQuery.error instanceof Error
                          ? activeFilesQuery.error.message
                          : "Tente novamente ou verifique as permissões do tenant."}
                      </p>
                    </div>
                  ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <FileText className="h-10 w-10 text-muted-foreground opacity-40" />
                      <p className="font-medium mt-3">Nenhum arquivo encontrado.</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Verifique o termo de busca ou as permissões Sites.Read.All e Files.Read.All.
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Arquivo</TableHead>
                          <TableHead className="w-20">Tipo</TableHead>
                          <TableHead className="w-36">Modificado</TableHead>
                          <TableHead className="w-28 text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {files.map((file) => {
                          const ext = !file.isFolder && file.name.includes(".")
                            ? file.name.split(".").pop()?.toUpperCase()
                            : null;
                          return (
                            <TableRow key={`${file.driveId}-${file.id}`}>
                              <TableCell>
                                <div className="flex items-start gap-3">
                                  {file.isFolder ? (
                                    <FolderOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                  ) : (
                                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-medium truncate">{file.name}</div>
                                    <div className="text-xs text-muted-foreground max-w-xs truncate">
                                      {file.path || file.webUrl || file.id}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-mono text-[11px]">
                                  {file.isFolder ? "Pasta" : ext || "Arquivo"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {file.lastModifiedDateTime
                                  ? new Date(file.lastModifiedDateTime).toLocaleDateString("pt-BR")
                                  : "-"}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-1">
                                  {file.isFolder && file.driveId ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Abrir pasta"
                                      onClick={() =>
                                        setFolderStack((prev) => [
                                          ...prev,
                                          { id: file.id, driveId: file.driveId!, name: file.name },
                                        ])
                                      }
                                    >
                                      <FolderOpen className="h-4 w-4" />
                                    </Button>
                                  ) : (
                                    <>
                                      {file.driveId && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          title="Visualizar"
                                          onClick={() => previewMutation.mutate(file)}
                                          disabled={previewMutation.isPending}
                                        >
                                          <Eye className="h-4 w-4" />
                                        </Button>
                                      )}
                                      {file.driveId && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          title="Baixar"
                                          onClick={() => downloadMutation.mutate(file)}
                                          disabled={downloadMutation.isPending}
                                        >
                                          <Download className="h-4 w-4" />
                                        </Button>
                                      )}
                                    </>
                                  )}
                                  {file.webUrl && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Abrir no Microsoft 365"
                                      onClick={() => window.open(file.webUrl!, "_blank", "noopener,noreferrer")}
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      <EntityDialog dialog={dialog} busy={busy} onClose={() => setDialog(null)} onSubmit={submitDialog} />

      <Dialog open={!!secretText} onOpenChange={(open) => !open && setSecretText(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Client secret gerado</DialogTitle>
            <DialogDescription>Copie o valor agora. A Microsoft nao exibira este segredo novamente.</DialogDescription>
          </DialogHeader>
          <Input readOnly value={secretText ?? ""} className="font-mono" />
          <DialogFooter>
            <Button onClick={() => setSecretText(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!filePreview} onOpenChange={(open) => !open && setFilePreview(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{filePreview?.file.name}</DialogTitle>
            <DialogDescription>
              Preview seguro gerado pelo Microsoft Graph para o tenant selecionado.
            </DialogDescription>
          </DialogHeader>
          {filePreview?.preview?.getUrl ? (
            <iframe
              title={filePreview.file.name}
              src={filePreview.preview.getUrl}
              className="h-[70vh] w-full rounded-md border bg-background"
            />
          ) : (
            <div className="rounded-md border p-8 text-center">
              <p className="font-medium">Preview indisponível para este arquivo.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Abra o arquivo diretamente no Microsoft 365.
              </p>
            </div>
          )}
          <DialogFooter>
            {filePreview?.file.webUrl && (
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => window.open(filePreview.file.webUrl!, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="h-4 w-4" />
                Abrir no Microsoft 365
              </Button>
            )}
            <Button type="button" onClick={() => setFilePreview(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntityDialog({
  dialog,
  busy,
  onClose,
  onSubmit,
}: {
  dialog: {
    entity: AdminEntity;
    mode: DialogMode;
    item?: DirectoryUser | DirectoryGroup | DirectoryApplication;
  } | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const title = !dialog
    ? ""
    : dialog.entity === "user"
      ? dialog.mode === "create"
        ? "Criar usuario"
        : dialog.mode === "password"
          ? "Redefinir senha"
          : "Editar usuario"
      : dialog.entity === "group"
        ? dialog.mode === "create"
          ? "Criar grupo"
          : dialog.mode === "member"
            ? "Adicionar membro"
            : "Editar grupo"
        : dialog.mode === "create"
          ? "Criar aplicativo"
          : dialog.mode === "password"
            ? "Gerar client secret"
            : "Editar aplicativo";

  const user = dialog?.entity === "user" ? (dialog.item as DirectoryUser | undefined) : undefined;
  const group = dialog?.entity === "group" ? (dialog.item as DirectoryGroup | undefined) : undefined;
  const app = dialog?.entity === "application" ? (dialog.item as DirectoryApplication | undefined) : undefined;

  return (
    <Dialog open={!!dialog} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              A acao sera executada diretamente no tenant selecionado usando o acesso Microsoft ja conectado.
            </DialogDescription>
          </DialogHeader>

          {dialog?.entity === "user" && dialog.mode === "create" && (
            <div className="grid gap-3">
              <Field name="displayName" label="Nome exibido" required />
              <Field name="userPrincipalName" label="UPN" placeholder="usuario@dominio.com" required />
              <Field name="mailNickname" label="Mail nickname" required />
              <Field name="password" label="Senha temporaria" type="password" required />
            </div>
          )}

          {dialog?.entity === "user" && dialog.mode === "edit" && (
            <div className="grid gap-3">
              <Field name="displayName" label="Nome exibido" defaultValue={user?.displayName ?? ""} required />
              <Field name="jobTitle" label="Cargo" defaultValue={user?.jobTitle ?? ""} />
              <Field name="department" label="Departamento" defaultValue={user?.department ?? ""} />
            </div>
          )}

          {dialog?.entity === "user" && dialog.mode === "password" && (
            <Field name="password" label="Nova senha temporaria" type="password" required />
          )}

          {dialog?.entity === "group" && dialog.mode === "create" && (
            <div className="grid gap-3">
              <Field name="displayName" label="Nome do grupo" required />
              <Field name="mailNickname" label="Mail nickname" required />
              <Field name="description" label="Descricao" />
            </div>
          )}

          {dialog?.entity === "group" && dialog.mode === "edit" && (
            <div className="grid gap-3">
              <Field name="displayName" label="Nome do grupo" defaultValue={group?.displayName ?? ""} required />
              <Field name="description" label="Descricao" defaultValue={group?.description ?? ""} />
            </div>
          )}

          {dialog?.entity === "group" && dialog.mode === "member" && (
            <Field name="userId" label="UPN ou ID do usuario" placeholder="usuario@dominio.com" required />
          )}

          {dialog?.entity === "application" && dialog.mode === "create" && (
            <Field name="displayName" label="Nome do aplicativo" required />
          )}

          {dialog?.entity === "application" && dialog.mode === "edit" && (
            <Field name="displayName" label="Nome do aplicativo" defaultValue={app?.displayName ?? ""} required />
          )}

          {dialog?.entity === "application" && dialog.mode === "password" && (
            <Field name="displayName" label="Nome do segredo" defaultValue="Admin Console" required />
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Executar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required={required} />
    </div>
  );
}
