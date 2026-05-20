import { useEffect } from "react";
import {
  Switch,
  Route,
  Router as WouterRouter,
  useLocation,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignIn, SignUp, Show } from "@clerk/react";

const SignedIn = ({ children }: { children: React.ReactNode }) => (
  <Show when="signed-in">{children}</Show>
);
const SignedOut = ({ children }: { children: React.ReactNode }) => (
  <Show when="signed-out">{children}</Show>
);
import { ptBR } from "@clerk/localizations";

import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import TenantsList from "@/pages/tenants/list";
import NewTenant from "@/pages/tenants/new";
import TenantDetail from "@/pages/tenants/detail";
import ScanDetail from "@/pages/scans/detail";
import FindingDetail from "@/pages/findings/detail";
import FirewallsList from "@/pages/firewalls/list";
import NewFirewall from "@/pages/firewalls/new";
import FirewallDetail from "@/pages/firewalls/detail";
import ServersList from "@/pages/servers/list";
import NewServer from "@/pages/servers/new";
import ServerDetail from "@/pages/servers/detail";
import DeviceScanDetail from "@/pages/device-scans/detail";
import { DeviceType } from "@workspace/api-client-react";
import AccessPending from "@/pages/access-pending";
import UsersList from "@/pages/users/list";
import ExternalList from "@/pages/external/list";
import NewExternal from "@/pages/external/new";
import ExternalDetail from "@/pages/external/detail";
import ExternalScanDetail from "@/pages/external-scans/detail";
import SecurityCenter from "@/pages/security-center";

import { AppShell } from "@/components/layout/app-shell";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

function PublicOnly({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <>
      <SignedOut>{children}</SignedOut>
      <SignedIn>
        <RedirectTo to="/dashboard" setLocation={setLocation} />
      </SignedIn>
    </>
  );
}

function HomeRoute() {
  return (
    <>
      <SignedOut>
        <Home />
      </SignedOut>
      <SignedIn>
        <RedirectTo to="/dashboard" />
      </SignedIn>
    </>
  );
}

function GatedShell({
  children,
  requireSuperAdmin = false,
}: {
  children: React.ReactNode;
  requireSuperAdmin?: boolean;
}) {
  const { data: me, isLoading, error } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: 0 },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="space-y-3 w-full max-w-md">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-muted-foreground">
          Não foi possível carregar seus dados. Recarregue a página.
        </p>
      </div>
    );
  }

  if (me.status !== "active") {
    return <AccessPending status={me.status as "pending" | "blocked"} />;
  }

  if (requireSuperAdmin && me.role !== "super_admin") {
    return (
      <AppShell isSuperAdmin={false}>
        <div className="text-center py-16">
          <p className="text-muted-foreground">
            Você não tem permissão para acessar esta área.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell isSuperAdmin={me.role === "super_admin"}>{children}</AppShell>
  );
}

function AuthenticatedRoute({
  children,
  requireSuperAdmin = false,
}: {
  children: React.ReactNode;
  requireSuperAdmin?: boolean;
}) {
  return (
    <>
      <SignedIn>
        <GatedShell requireSuperAdmin={requireSuperAdmin}>{children}</GatedShell>
      </SignedIn>
      <SignedOut>
        <RedirectTo to="/" />
      </SignedOut>
    </>
  );
}

function RedirectTo({
  to,
  setLocation: providedSetLocation,
}: {
  to: string;
  setLocation?: (path: string) => void;
}) {
  const [, defaultSetLocation] = useLocation();
  const setLocation = providedSetLocation ?? defaultSetLocation;
  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);
  return null;
}

function Router() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <Switch>
      <Route path="/" component={HomeRoute} />

      <Route path="/sign-in/*?">
        <PublicOnly>
          <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
            <SignIn
              routing="path"
              path={`${basePath}/sign-in`}
              signUpUrl={`${basePath}/sign-up`}
              forceRedirectUrl={`${basePath}/dashboard`}
            />
          </div>
        </PublicOnly>
      </Route>

      <Route path="/sign-up/*?">
        <PublicOnly>
          <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
            <SignUp
              routing="path"
              path={`${basePath}/sign-up`}
              signInUrl={`${basePath}/sign-in`}
              forceRedirectUrl={`${basePath}/dashboard`}
            />
          </div>
        </PublicOnly>
      </Route>

      <Route path="/dashboard">
        <AuthenticatedRoute>
          <Dashboard />
        </AuthenticatedRoute>
      </Route>

      <Route path="/security-center">
        <AuthenticatedRoute>
          <SecurityCenter />
        </AuthenticatedRoute>
      </Route>

      <Route path="/tenants">
        <AuthenticatedRoute>
          <TenantsList />
        </AuthenticatedRoute>
      </Route>

      <Route path="/tenants/new">
        <AuthenticatedRoute>
          <NewTenant />
        </AuthenticatedRoute>
      </Route>

      <Route path="/tenants/:tenantId">
        {(params) => (
          <AuthenticatedRoute>
            <TenantDetail tenantId={params.tenantId as string} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/scans/:scanId">
        {(params) => (
          <AuthenticatedRoute>
            <ScanDetail scanId={params.scanId as string} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/findings/:findingId">
        {(params) => (
          <AuthenticatedRoute>
            <FindingDetail findingId={params.findingId as string} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/firewalls">
        <AuthenticatedRoute>
          <FirewallsList />
        </AuthenticatedRoute>
      </Route>

      <Route path="/firewalls/new">
        <AuthenticatedRoute>
          <NewFirewall />
        </AuthenticatedRoute>
      </Route>

      <Route path="/firewalls/:deviceId">
        {(params) => (
          <AuthenticatedRoute>
            <FirewallDetail deviceId={params.deviceId as string} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/firewall-scans/:scanId">
        {(params) => (
          <AuthenticatedRoute>
            <DeviceScanDetail scanId={params.scanId as string} deviceType={DeviceType.firewall} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/servers">
        <AuthenticatedRoute>
          <ServersList />
        </AuthenticatedRoute>
      </Route>

      <Route path="/servers/new">
        <AuthenticatedRoute>
          <NewServer />
        </AuthenticatedRoute>
      </Route>

      <Route path="/servers/:deviceId">
        {(params) => (
          <AuthenticatedRoute>
            <ServerDetail deviceId={params.deviceId as string} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/server-scans/:scanId">
        {(params) => (
          <AuthenticatedRoute>
            <DeviceScanDetail scanId={params.scanId as string} deviceType={DeviceType.server} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/external">
        <AuthenticatedRoute>
          <ExternalList />
        </AuthenticatedRoute>
      </Route>

      <Route path="/external/new">
        <AuthenticatedRoute>
          <NewExternal />
        </AuthenticatedRoute>
      </Route>

      <Route path="/external/:assetId">
        {(params) => (
          <AuthenticatedRoute>
            <ExternalDetail assetId={params.assetId as string} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/external-scans/:scanId">
        {(params) => (
          <AuthenticatedRoute>
            <ExternalScanDetail scanId={params.scanId as string} />
          </AuthenticatedRoute>
        )}
      </Route>

      <Route path="/users">
        <AuthenticatedRoute requireSuperAdmin>
          <UsersList />
        </AuthenticatedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const proxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  if (!publishableKey) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-destructive font-medium">
          Erro: VITE_CLERK_PUBLISHABLE_KEY não definida.
        </p>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      proxyUrl={proxyUrl || undefined}
      localization={ptBR}
      signInFallbackRedirectUrl={`${basePath}/dashboard`}
      signUpFallbackRedirectUrl={`${basePath}/dashboard`}
      appearance={{
        variables: {
          colorPrimary: "hsl(174, 72%, 42%)",
          colorDanger: "hsl(0, 78%, 60%)",
          colorSuccess: "hsl(142, 70%, 45%)",
          colorWarning: "hsl(38, 92%, 56%)",
          fontFamily: "'Inter', sans-serif",
          borderRadius: "0.625rem",
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
