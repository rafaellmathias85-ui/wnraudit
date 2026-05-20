import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateTenant, useGetTenantOAuthUrl, getGetTenantOAuthUrlQueryKey, CloudScope, type ErrorResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Server, Key, Copy, Check, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const formSchema = z.object({
  displayName: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  microsoftTenantId: z.string().min(5, "Tenant ID ou domínio é obrigatório"),
  primaryDomain: z.string().optional(),
  scope: z.nativeEnum(CloudScope),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewTenant() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createTenant = useCreateTenant();
  const { data: oauthData } = useGetTenantOAuthUrl(createdTenantId || "", {
    query: {
      enabled: !!createdTenantId,
      queryKey: getGetTenantOAuthUrlQueryKey(createdTenantId || ""),
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: "",
      microsoftTenantId: "",
      primaryDomain: "",
      scope: CloudScope.m365,
    },
  });

  function onSubmit(data: FormValues) {
    createTenant.mutate(
      {
        data: {
          displayName: data.displayName,
          microsoftTenantId: data.microsoftTenantId,
          primaryDomain: data.primaryDomain || undefined,
          scope: data.scope,
        },
      },
      {
        onSuccess: (tenant) => {
          toast({
            title: "Tenant registrado",
            description: "O ambiente foi conectado com sucesso. Inicie a primeira varredura.",
          });
          setLocation(`/tenants/${tenant.id}`);
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Erro ao registrar",
            description: (error.data as ErrorResponse | undefined)?.error || "Ocorreu um erro inesperado.",
          });
        },
      }
    );
  }

  const copyToClipboard = () => {
    if (oauthData?.url) {
      navigator.clipboard.writeText(oauthData.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "URL copiada",
        description: "Link de autorização copiado para a área de transferência.",
      });
    }
  };

  if (createdTenantId) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center gap-4">
          <Link href="/tenants">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Autorização Necessária</h1>
            <p className="text-muted-foreground mt-1">Conceda permissão de administrador para iniciar as varreduras.</p>
          </div>
        </div>

        <Card className="border-primary/20">
          <CardHeader className="bg-primary/5 pb-8">
            <div className="mx-auto w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mb-4">
              <Key className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-center text-xl">Autorizar Acesso ao Microsoft</CardTitle>
            <CardDescription className="text-center max-w-lg mx-auto text-base">
              Para que possamos auditar seu ambiente, você precisa conceder consentimento de administrador para o nosso aplicativo no Microsoft Entra ID.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-8 space-y-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Instruções:</h3>
              <ol className="list-decimal list-inside space-y-3 text-muted-foreground ml-2">
                <li>Copie o link de autorização abaixo ou clique em "Abrir link de autorização".</li>
                <li>Faça login com uma conta de <strong>Administrador Global</strong> do tenant Microsoft.</li>
                <li>Revise as permissões de leitura solicitadas (não faremos alterações no seu ambiente).</li>
                <li>Clique em "Aceitar" para concluir o processo.</li>
                <li>Após autorizar, você poderá iniciar a primeira varredura.</li>
              </ol>
            </div>

            <div className="space-y-2">
              <FormLabel>Link de Autorização</FormLabel>
              <div className="flex items-center gap-2">
                <Input 
                  readOnly 
                  value={oauthData?.url || "Gerando link..."} 
                  className="font-mono text-sm bg-muted"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={copyToClipboard}
                  disabled={!oauthData?.url}
                  className="shrink-0"
                >
                  {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between bg-muted/30 py-4">
            <Button variant="outline" onClick={() => setLocation(`/tenants/${createdTenantId}`)}>
              Pular por enquanto
            </Button>
            <Button 
              disabled={!oauthData?.url} 
              onClick={() => oauthData?.url && window.open(oauthData.url, "_blank")}
              className="gap-2"
            >
              Abrir Link de Autorização <ExternalLink className="h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/tenants">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Novo Tenant</h1>
          <p className="text-muted-foreground mt-1">Registre um ambiente Microsoft para auditoria de segurança.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalhes do Ambiente</CardTitle>
          <CardDescription>
            Insira as informações do tenant Microsoft que deseja conectar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome de Exibição</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Contoso Corp" {...field} />
                    </FormControl>
                    <FormDescription>
                      Um nome amigável para identificar este ambiente na plataforma.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="microsoftTenantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tenant ID (Microsoft)</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: 8d90... ou contoso.onmicrosoft.com" {...field} />
                    </FormControl>
                    <FormDescription>
                      O GUID do Tenant ou o domínio principal (onmicrosoft.com).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="primaryDomain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Domínio Principal (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: contoso.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Escopo da Auditoria</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o escopo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={CloudScope.m365}>Microsoft 365</SelectItem>
                          <SelectItem value={CloudScope.azure}>Azure</SelectItem>
                          <SelectItem value={CloudScope.both}>Ambos (M365 + Azure)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="pt-4 flex justify-end">
                <Button type="submit" disabled={createTenant.isPending} className="w-full sm:w-auto">
                  {createTenant.isPending ? "Registrando..." : "Registrar Tenant"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
