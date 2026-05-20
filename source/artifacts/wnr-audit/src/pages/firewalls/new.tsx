import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateFirewall, FirewallManufacturer, type ErrorResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const MANUFACTURER_OPTIONS = [
  { value: FirewallManufacturer.cisco, label: "Cisco" },
  { value: FirewallManufacturer.fortinet, label: "Fortinet" },
  { value: FirewallManufacturer.sophos, label: "Sophos" },
  { value: FirewallManufacturer.ubiquiti, label: "Ubiquiti" },
  { value: FirewallManufacturer["tp-link"], label: "TP-Link" },
  { value: FirewallManufacturer.pfsense, label: "pfSense" },
  { value: FirewallManufacturer.checkpoint, label: "Check Point" },
  { value: FirewallManufacturer["palo-alto"], label: "Palo Alto Networks" },
  { value: FirewallManufacturer.meraki, label: "Cisco Meraki" },
  { value: FirewallManufacturer.other, label: "Outro" },
];

const formSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  manufacturer: z.nativeEnum(FirewallManufacturer),
  model: z.string().optional(),
  ipAddress: z.string().optional(),
  firmwareVersion: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewFirewall() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createFirewall = useCreateFirewall();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      manufacturer: FirewallManufacturer.fortinet,
      model: "",
      ipAddress: "",
      firmwareVersion: "",
      location: "",
      notes: "",
    },
  });

  function onSubmit(data: FormValues) {
    createFirewall.mutate(
      { data },
      {
        onSuccess: (fw) => {
          toast({
            title: "Firewall cadastrado",
            description: "Inicie a primeira varredura para identificar vulnerabilidades.",
          });
          setLocation(`/firewalls/${fw.id}`);
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
        <Link href="/firewalls">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Novo Firewall</h1>
          <p className="text-muted-foreground mt-1">Cadastre um firewall on-premise para varredura de segurança.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informações do Dispositivo</CardTitle>
          <CardDescription>
            Preencha os dados do firewall. Quanto mais informações, mais precisa será a varredura.
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
                        <Input placeholder="Ex: FW-Matriz-01" {...field} />
                      </FormControl>
                      <FormDescription>Nome interno para identificar este dispositivo.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="manufacturer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fabricante</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o fabricante" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MANUFACTURER_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Modelo (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: FortiGate 100F" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ipAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Endereco IP (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 192.168.1.1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="firmwareVersion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Versao do Firmware (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 7.4.3" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Localizacao (Opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Rack 02 — Matriz SP" {...field} />
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
                        placeholder="Informacoes adicionais sobre o dispositivo..."
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
                <Button type="submit" disabled={createFirewall.isPending} className="w-full sm:w-auto">
                  {createFirewall.isPending ? "Cadastrando..." : "Cadastrar Firewall"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
