import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateServer, ServerOs, type ErrorResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const OS_OPTIONS = [
  { value: ServerOs["windows-server"], label: "Windows Server" },
  { value: ServerOs.ubuntu, label: "Ubuntu Linux" },
  { value: ServerOs.debian, label: "Debian Linux" },
  { value: ServerOs.rhel, label: "Red Hat Enterprise Linux" },
  { value: ServerOs.centos, label: "CentOS" },
  { value: ServerOs["rocky-linux"], label: "Rocky Linux" },
  { value: ServerOs.suse, label: "SUSE Linux" },
  { value: ServerOs.other, label: "Outro" },
];

const formSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  hostname: z.string().min(1, "Hostname e obrigatorio"),
  os: z.nativeEnum(ServerOs),
  osVersion: z.string().optional(),
  ipAddress: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewServer() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createServer = useCreateServer();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      hostname: "",
      os: ServerOs["windows-server"],
      osVersion: "",
      ipAddress: "",
      role: "",
      notes: "",
    },
  });

  function onSubmit(data: FormValues) {
    createServer.mutate(
      { data },
      {
        onSuccess: (srv) => {
          toast({
            title: "Servidor cadastrado",
            description: "Inicie a primeira varredura para identificar vulnerabilidades.",
          });
          setLocation(`/servers/${srv.id}`);
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Erro ao cadastrar",
            description: (error.data as ErrorResponse | undefined)?.error || "Ocorreu um erro inesperado.",
          });
        },
      }
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/servers">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Novo Servidor</h1>
          <p className="text-muted-foreground mt-1">Cadastre um servidor on-premise para varredura de segurança.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informacoes do Servidor</CardTitle>
          <CardDescription>
            Preencha os dados do servidor. Quanto mais informacoes, mais precisa sera a analise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome de Identificacao</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: SRV-DC-01" {...field} />
                      </FormControl>
                      <FormDescription>Nome amigavel para identificar este servidor.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hostname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hostname</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: srv-dc-01.contoso.local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="os"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sistema Operacional</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o SO" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {OS_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="osVersion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Versao do SO (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 2022 / 22.04 LTS" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="ipAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Endereco IP (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 10.0.0.10" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Funcao do Servidor (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Domain Controller, Web, Banco de Dados" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observacoes (Opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Informacoes adicionais..."
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 flex justify-end">
                <Button type="submit" disabled={createServer.isPending} className="w-full sm:w-auto">
                  {createServer.isPending ? "Cadastrando..." : "Cadastrar Servidor"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
