import { useState } from "react";
import {
  useListUsers,
  useApproveUser,
  useBlockUser,
  useDeleteUser,
  useInviteUser,
  getListUsersQueryKey,
  UserStatus,
  UserRole,
  type ErrorResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Users, UserPlus, Check, Ban, Trash2, ShieldCheck } from "lucide-react";

const STATUS_LABEL: Record<UserStatus, string> = {
  pending: "Aguardando",
  active: "Ativo",
  blocked: "Bloqueado",
};

const STATUS_VARIANT: Record<UserStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  active: "outline",
  blocked: "destructive",
};

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super Admin",
  user: "Usuário",
};

export default function UsersList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });

  const approveMutation = useApproveUser();
  const blockMutation = useBlockUser();
  const deleteMutation = useDeleteUser();
  const inviteMutation = useInviteUser();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const onApprove = (userId: string) => {
    approveMutation.mutate(
      { userId },
      {
        onSuccess: () => {
          toast({ title: "Usuário aprovado", description: "Acesso liberado." });
          refresh();
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Erro ao aprovar",
            description: (err.data as ErrorResponse | undefined)?.error || "Tente novamente.",
          }),
      },
    );
  };

  const onBlock = (userId: string) => {
    blockMutation.mutate(
      { userId },
      {
        onSuccess: () => {
          toast({ title: "Usuário bloqueado" });
          refresh();
        },
        onError: () =>
          toast({ variant: "destructive", title: "Erro ao bloquear" }),
      },
    );
  };

  const onDelete = (userId: string) => {
    deleteMutation.mutate(
      { userId },
      {
        onSuccess: () => {
          toast({ title: "Usuário removido" });
          setConfirmDeleteId(null);
          refresh();
        },
        onError: () =>
          toast({ variant: "destructive", title: "Erro ao remover" }),
      },
    );
  };

  const onInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate(
      { data: { email: inviteEmail.trim(), fullName: inviteName.trim() || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Convite registrado", description: "Usuário criado em estado pendente." });
          setInviteEmail("");
          setInviteName("");
          setInviteOpen(false);
          refresh();
        },
        onError: (err) =>
          toast({
            variant: "destructive",
            title: "Erro ao convidar",
            description: (err.data as ErrorResponse | undefined)?.error || "Tente novamente.",
          }),
      },
    );
  };

  const userToDelete = data?.find((u) => u.id === confirmDeleteId);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-3">
            <Users className="h-7 w-7 text-primary" />
            Usuários
          </h1>
          <p className="text-muted-foreground mt-1">
            Aprove novos cadastros, gerencie acessos e convide pessoas para o WNR-Audit.
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" />
              Convidar usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={onInvite} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Convidar novo usuário</DialogTitle>
                <DialogDescription>
                  Cria um registro pendente. Quando a pessoa entrar com esse e-mail, o acesso já estará pré-autorizado.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">E-mail</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    required
                    placeholder="cliente@empresa.com.br"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-name">Nome (opcional)</Label>
                  <Input
                    id="invite-name"
                    placeholder="Nome completo"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? "Enviando..." : "Convidar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todos os usuários</CardTitle>
          <CardDescription>
            {data?.length ?? 0} {data?.length === 1 ? "registro" : "registros"} no total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !data || data.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              Nenhum usuário cadastrado ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Cadastrado</TableHead>
                    <TableHead>Último acesso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{u.fullName || u.email}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                          {u.organizationName && (
                            <span className="text-xs text-muted-foreground">{u.organizationName}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm">
                          {u.role === UserRole.super_admin && (
                            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                          )}
                          {ROLE_LABEL[u.role]}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(u.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.lastLoginAt
                          ? format(new Date(u.lastLoginAt), "dd/MM HH:mm", { locale: ptBR })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {u.status === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => onApprove(u.id)}
                              disabled={approveMutation.isPending}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Aprovar
                            </Button>
                          )}
                          {u.status === "active" && u.role !== UserRole.super_admin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1 text-destructive hover:text-destructive"
                              onClick={() => onBlock(u.id)}
                              disabled={blockMutation.isPending}
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Bloquear
                            </Button>
                          )}
                          {u.status === "blocked" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => onApprove(u.id)}
                              disabled={approveMutation.isPending}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Reativar
                            </Button>
                          )}
                          {u.role !== UserRole.super_admin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setConfirmDeleteId(u.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover <strong>{userToDelete?.email}</strong>? Todos os dados associados serão excluídos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && onDelete(confirmDeleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Removendo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
