import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/apiFetch";

type CaptureStyle = "m365" | "hr" | "financial" | "it" | "generic";

// ─── Formulário Microsoft 365 ────────────────────────────────────────────────

function M365Form({ onSubmit, onInteract }: { onSubmit: () => void; onInteract: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [step, setStep] = useState<"email" | "password">("email");

  return (
    <div style={{ minHeight: "100vh", background: "#f3f3f3", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Segoe UI, Arial, sans-serif" }}>
      <div style={{ background: "#fff", padding: "44px 44px 36px", width: "440px", maxWidth: "96vw", boxShadow: "0 2px 6px rgba(0,0,0,.12)" }}>
        <svg width="108" height="24" viewBox="0 0 108 24" style={{ marginBottom: 24 }}>
          <rect x="0" y="0" width="11" height="11" fill="#f25022"/>
          <rect x="12" y="0" width="11" height="11" fill="#7fba00"/>
          <rect x="0" y="12" width="11" height="11" fill="#00a4ef"/>
          <rect x="12" y="12" width="11" height="11" fill="#ffb900"/>
          <text x="28" y="17" fontSize="20" fontWeight="600" fill="#333">Microsoft</text>
        </svg>

        {step === "email" ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16, color: "#1f1f1f" }}>Entrar</h1>
            <input
              type="email"
              placeholder="E-mail, telefone ou Skype"
              value={user}
              onChange={(e) => { onInteract(); setUser(e.target.value); }}
              style={{ width: "100%", padding: "8px 0", border: "none", borderBottom: "1px solid #767676", outline: "none", fontSize: 15, marginBottom: 24, boxSizing: "border-box" }}
              autoFocus
            />
            <button
              onClick={() => user.trim() && setStep("password")}
              style={{ background: "#0078d4", color: "#fff", border: "none", padding: "8px 20px", fontSize: 15, cursor: "pointer", float: "right" }}
            >
              Próximo
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <span style={{ fontSize: 13, color: "#333" }}>{user}</span>
              <button onClick={() => setStep("email")} style={{ background: "none", border: "none", color: "#0078d4", cursor: "pointer", fontSize: 12 }}>Alterar</button>
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: "#1f1f1f" }}>Inserir senha</h2>
            <input
              type="password"
              placeholder="Senha"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pass.trim() && onSubmit()}
              style={{ width: "100%", padding: "8px 0", border: "none", borderBottom: "1px solid #767676", outline: "none", fontSize: 15, marginBottom: 8, boxSizing: "border-box" }}
              autoFocus
            />
            <div style={{ marginBottom: 24 }}>
              <a href="#" style={{ color: "#0078d4", fontSize: 13 }} onClick={(e) => e.preventDefault()}>Esqueceu a senha?</a>
            </div>
            <button
              onClick={() => pass.trim() && onSubmit()}
              style={{ background: "#0078d4", color: "#fff", border: "none", padding: "8px 20px", fontSize: 15, cursor: "pointer", float: "right" }}
            >
              Entrar
            </button>
          </>
        )}
        <div style={{ clear: "both", paddingTop: 32, fontSize: 12, color: "#666" }}>
          <a href="#" style={{ color: "#0078d4" }} onClick={(e) => e.preventDefault()}>Criar conta</a>
          {" · "}
          <a href="#" style={{ color: "#0078d4" }} onClick={(e) => e.preventDefault()}>Privacidade</a>
          {" · "}
          <a href="#" style={{ color: "#0078d4" }} onClick={(e) => e.preventDefault()}>Termos de uso</a>
        </div>
      </div>
    </div>
  );
}

// ─── Formulário RH ───────────────────────────────────────────────────────────

function HRForm({ onSubmit, onInteract }: { onSubmit: () => void; onInteract: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  return (
    <div style={{ minHeight: "100vh", background: "#f0f4f0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif" }}>
      <div style={{ background: "#2e7d32", color: "#fff", width: "100%", textAlign: "center", padding: "18px 0", fontSize: 18, fontWeight: 600, letterSpacing: 1, marginBottom: 32 }}>
        RH — Portal do Colaborador
      </div>
      <div style={{ background: "#fff", padding: "36px 40px", width: "380px", maxWidth: "94vw", borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,.10)" }}>
        <h2 style={{ fontSize: 18, marginBottom: 24, color: "#2e7d32", textAlign: "center" }}>Acesso ao Portal</h2>
        <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 4 }}>Matrícula / CPF</label>
        <input
          type="text"
          placeholder="Ex: 12345 ou 000.000.000-00"
          value={user}
          onChange={(e) => { onInteract(); setUser(e.target.value); }}
          style={{ width: "100%", padding: "9px 12px", border: "1px solid #ccc", borderRadius: 3, fontSize: 14, marginBottom: 16, boxSizing: "border-box" }}
        />
        <label style={{ fontSize: 13, color: "#555", display: "block", marginBottom: 4 }}>Senha</label>
        <input
          type="password"
          placeholder="Senha de acesso"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && user.trim() && pass.trim() && onSubmit()}
          style={{ width: "100%", padding: "9px 12px", border: "1px solid #ccc", borderRadius: 3, fontSize: 14, marginBottom: 24, boxSizing: "border-box" }}
        />
        <button
          onClick={() => user.trim() && pass.trim() && onSubmit()}
          style={{ background: "#2e7d32", color: "#fff", border: "none", width: "100%", padding: "10px 0", fontSize: 15, borderRadius: 3, cursor: "pointer" }}
        >
          Acessar Portal
        </button>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <a href="#" style={{ color: "#2e7d32", fontSize: 12 }} onClick={(e) => e.preventDefault()}>Esqueci minha senha</a>
        </div>
      </div>
      <div style={{ marginTop: 20, fontSize: 11, color: "#888" }}>© Departamento de Recursos Humanos — Acesso restrito</div>
    </div>
  );
}

// ─── Formulário Financeiro ───────────────────────────────────────────────────

function FinancialForm({ onSubmit, onInteract }: { onSubmit: () => void; onInteract: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  return (
    <div style={{ minHeight: "100vh", background: "#0d2137", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 32, color: "#fff", fontWeight: 700, letterSpacing: 2 }}>💼 Portal Financeiro</div>
        <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>Acesso seguro — ambiente corporativo</div>
      </div>
      <div style={{ background: "#1e3a5f", padding: "36px 40px", width: "380px", maxWidth: "94vw", borderRadius: 6, border: "1px solid #2d4a6e" }}>
        <h2 style={{ fontSize: 16, marginBottom: 24, color: "#e2e8f0", textAlign: "center", fontWeight: 400 }}>Identificação do usuário</h2>
        <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>CPF / CNPJ</label>
        <input
          type="text"
          placeholder="000.000.000-00"
          value={user}
          onChange={(e) => { onInteract(); setUser(e.target.value); }}
          style={{ width: "100%", padding: "10px 12px", background: "#0d2137", border: "1px solid #2d4a6e", borderRadius: 3, fontSize: 14, color: "#fff", marginBottom: 16, boxSizing: "border-box" }}
        />
        <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Senha</label>
        <input
          type="password"
          placeholder="••••••••"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && user.trim() && pass.trim() && onSubmit()}
          style={{ width: "100%", padding: "10px 12px", background: "#0d2137", border: "1px solid #2d4a6e", borderRadius: 3, fontSize: 14, color: "#fff", marginBottom: 24, boxSizing: "border-box" }}
        />
        <button
          onClick={() => user.trim() && pass.trim() && onSubmit()}
          style={{ background: "#1d6fa3", color: "#fff", border: "none", width: "100%", padding: "11px 0", fontSize: 15, borderRadius: 3, cursor: "pointer", letterSpacing: 0.5 }}
        >
          Acessar Conta
        </button>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <a href="#" style={{ color: "#60a5fa", fontSize: 12 }} onClick={(e) => e.preventDefault()}>Esqueci a senha</a>
          {" · "}
          <a href="#" style={{ color: "#60a5fa", fontSize: 12 }} onClick={(e) => e.preventDefault()}>Primeiro acesso</a>
        </div>
      </div>
      <div style={{ marginTop: 20, fontSize: 11, color: "#475569" }}>Conexão segura SSL • Departamento Financeiro</div>
    </div>
  );
}

// ─── Formulário TI ───────────────────────────────────────────────────────────

function ITForm({ onSubmit, onInteract }: { onSubmit: () => void; onInteract: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  return (
    <div style={{ minHeight: "100vh", background: "#111827", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 14, color: "#22c55e", letterSpacing: 3, textTransform: "uppercase" }}>🔒 TI — Atualização de Segurança</div>
        <div style={{ color: "#4b5563", fontSize: 12, marginTop: 6 }}>Autenticação obrigatória para continuar</div>
      </div>
      <div style={{ background: "#1f2937", padding: "32px 36px", width: "380px", maxWidth: "94vw", borderRadius: 4, border: "1px solid #374151" }}>
        <label style={{ fontSize: 11, color: "#22c55e", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 2 }}>Usuário de rede</label>
        <input
          type="text"
          placeholder="domínio\\usuário"
          value={user}
          onChange={(e) => { onInteract(); setUser(e.target.value); }}
          style={{ width: "100%", padding: "9px 10px", background: "#111827", border: "1px solid #374151", borderRadius: 2, fontSize: 13, color: "#d1d5db", marginBottom: 16, boxSizing: "border-box", fontFamily: "monospace" }}
        />
        <label style={{ fontSize: 11, color: "#22c55e", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 2 }}>Senha</label>
        <input
          type="password"
          placeholder="••••••••"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && user.trim() && pass.trim() && onSubmit()}
          style={{ width: "100%", padding: "9px 10px", background: "#111827", border: "1px solid #374151", borderRadius: 2, fontSize: 13, color: "#d1d5db", marginBottom: 24, boxSizing: "border-box", fontFamily: "monospace" }}
        />
        <button
          onClick={() => user.trim() && pass.trim() && onSubmit()}
          style={{ background: "#16a34a", color: "#fff", border: "none", width: "100%", padding: "10px 0", fontSize: 14, borderRadius: 2, cursor: "pointer", letterSpacing: 1, fontFamily: "monospace" }}
        >
          AUTENTICAR
        </button>
      </div>
      <div style={{ marginTop: 16, fontSize: 10, color: "#374151", letterSpacing: 1 }}>DEPARTAMENTO DE TI • ACESSO RESTRITO</div>
    </div>
  );
}

// ─── Formulário Genérico ─────────────────────────────────────────────────────

function GenericForm({ onSubmit, onInteract }: { onSubmit: () => void; onInteract: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "Arial, sans-serif" }}>
      <div style={{ background: "#fff", padding: "40px 44px", width: "400px", maxWidth: "94vw", borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,.08)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>Portal Corporativo</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 28 }}>Faça login para continuar</p>
        <label style={{ fontSize: 13, color: "#374151", display: "block", marginBottom: 4 }}>E-mail / Usuário</label>
        <input
          type="text"
          placeholder="seu@email.com.br"
          value={user}
          onChange={(e) => { onInteract(); setUser(e.target.value); }}
          style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, marginBottom: 16, boxSizing: "border-box" }}
        />
        <label style={{ fontSize: 13, color: "#374151", display: "block", marginBottom: 4 }}>Senha</label>
        <input
          type="password"
          placeholder="Sua senha"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && user.trim() && pass.trim() && onSubmit()}
          style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, marginBottom: 24, boxSizing: "border-box" }}
        />
        <button
          onClick={() => user.trim() && pass.trim() && onSubmit()}
          style={{ background: "#2563eb", color: "#fff", border: "none", width: "100%", padding: "11px 0", fontSize: 15, borderRadius: 6, cursor: "pointer" }}
        >
          Entrar
        </button>
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <a href="#" style={{ color: "#2563eb", fontSize: 13 }} onClick={(e) => e.preventDefault()}>Esqueci minha senha</a>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function PhishingCapture({ token }: { token: string }) {
  const [style, setStyle] = useState<CaptureStyle | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, navigate] = useLocation();
  const interactFired = useRef(false);

  useEffect(() => {
    apiFetch<{ style: CaptureStyle }>(`/phishing/capture-info/${token}`)
      .then((d) => setStyle(d.style ?? "generic"))
      .catch(() => setStyle("generic"));
  }, [token]);

  // Fires once when user types in any form field — proves human interaction.
  // Scanners visit the page but don't type, so this never fires for them.
  const handleInteract = () => {
    if (interactFired.current) return;
    interactFired.current = true;
    apiFetch<void>(`/phishing/track/${token}/interact`, {
      method: "POST",
      body: JSON.stringify({ humanVerified: true }),
    }).catch(() => {});
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    await apiFetch<void>(`/phishing/track/${token}/submit`, {
      method: "POST",
      body: JSON.stringify({ style }),
    }).catch(() => {});
    navigate(`/phishing/training/${token}`);
  };

  if (!style || submitting) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e2e8f0", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (style === "m365")       return <M365Form onSubmit={handleSubmit} onInteract={handleInteract} />;
  if (style === "hr")         return <HRForm onSubmit={handleSubmit} onInteract={handleInteract} />;
  if (style === "financial")  return <FinancialForm onSubmit={handleSubmit} onInteract={handleInteract} />;
  if (style === "it")         return <ITForm onSubmit={handleSubmit} onInteract={handleInteract} />;
  return <GenericForm onSubmit={handleSubmit} onInteract={handleInteract} />;
}
