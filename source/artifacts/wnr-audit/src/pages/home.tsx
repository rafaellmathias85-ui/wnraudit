import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Shield, Lock, Activity, CheckCircle, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="px-6 py-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-2 text-primary font-display font-bold text-xl">
          <Shield className="h-6 w-6" />
          <span>WNR Audit</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in">
            <Button variant="ghost">Entrar</Button>
          </Link>
          <Link href="/sign-up">
            <Button>Criar Conta</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <section className="py-24 px-6 lg:px-8 max-w-7xl mx-auto w-full text-center">
          <h1 className="text-5xl lg:text-7xl font-display font-bold tracking-tight text-foreground max-w-4xl mx-auto leading-tight">
            Auditoria de segurança <span className="text-primary">contínua</span> para ambientes Microsoft.
          </h1>
          <p className="mt-6 text-xl text-muted-foreground max-w-2xl mx-auto">
            Identifique vulnerabilidades no Microsoft 365 e Azure, valide contra os benchmarks do CIS e proteja os dados dos seus clientes com autoridade.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/sign-up">
              <Button size="lg" className="h-14 px-8 text-lg font-medium group">
                Começar Agora
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="/sign-in">
              <Button size="lg" variant="outline" className="h-14 px-8 text-lg font-medium">
                Acessar Console
              </Button>
            </Link>
          </div>
        </section>

        <section className="py-24 bg-muted/50 px-6 lg:px-8 border-y">
          <div className="max-w-7xl mx-auto">
            <div className="grid md:grid-cols-3 gap-12">
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Lock className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold font-display">Conformidade CIS</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Avaliação automatizada contra as diretrizes do Center for Internet Security para garantir configurações robustas.
                </p>
              </div>
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Activity className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold font-display">Varreduras Contínuas</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Monitore múltiplos tenants em tempo real. Identifique desvios de configuração antes que se tornem incidentes.
                </p>
              </div>
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold font-display">Remediação Clara</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Passo a passo detalhado para corrigir cada vulnerabilidade encontrada, economizando horas de pesquisa.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 px-6 text-center text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} WNR Audit. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}