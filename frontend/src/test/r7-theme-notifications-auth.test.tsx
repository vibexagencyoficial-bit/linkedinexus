/**
 * Testes R7: tema duplo, sino de notificações e sessão/401.
 * - Tema: padrão ESCURO, alternância aplica/remove a classe `dark` e persiste.
 * - Notificações: eventos REAIS (listActivity), badge de não lidas, marcar lidas.
 * - Sessão: token salvo é restaurado na montagem (sem 401 no primeiro fetch) e
 *   um 401 global (`vibex:unauthorized`) limpa a sessão e leva ao login.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import React from "react";

// --- mocks hoisted ---
const apiMocks = vi.hoisted(() => ({
  listActivity: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listActivity: apiMocks.listActivity,
    setToken: apiMocks.setToken,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));

const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));

import { ThemeProvider, useTheme } from "@/lib/theme-context";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { AuthProvider, useAuth } from "@/lib/auth-context";

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>Alternar tema</button>
    </div>
  );
}

function AuthProbe() {
  const { user } = useAuth();
  return <span data-testid="user">{user?.name ?? "sem-sessao"}</span>;
}

function SessionDisplayer() {
  // A sessão é restaurada de forma síncrona na montagem do AuthProvider:
  // o consumidor enxerga o usuário JÁ no primeiro render (sem effect).
  return <AuthProbe />;
}

const NOW = Date.now();
const EVENTS = [
  {
    id: "ev-1",
    event_type: "message.sent",
    description: "Mensagem enviada para Marina",
    entity_type: "message",
    created_at: new Date(NOW - 2 * 60000).toISOString(),
    payload: { contact_name: "Marina Duarte", message_body: "Olá Marina, tudo bem?" },
  },
  {
    id: "ev-2",
    event_type: "reply.detected",
    description: "Pediro respondeu",
    entity_type: "message",
    created_at: new Date(NOW - 60 * 60000).toISOString(),
    payload: { recipient_name: "Pediro", reply_body: "Obrigado pelo contato!" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

describe("Tema duplo (escuro primeiro, claro depois)", () => {
  it("padrão é ESCURO: aplica a classe dark e persiste a escolha", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme").textContent).toBe("dark");
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(localStorage.getItem("vibex_theme")).toBe("dark");
  });

  it("alternar troca para claro (remove .dark) e persiste; voltar restaura o escuro", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /alternar tema/i }));
    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("light");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("vibex_theme")).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: /alternar tema/i }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(localStorage.getItem("vibex_theme")).toBe("dark");
  });

  it("respeita a preferência salva: light salvo não é sobrescrito pelo padrão", async () => {
    localStorage.setItem("vibex_theme", "light");
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("light");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("Sino de notificações (eventos reais do sistema)", () => {
  it("mostra o badge de não lidas e lista os eventos reais ao abrir", async () => {
    apiMocks.listActivity.mockResolvedValue({ activity: EVENTS });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy(); // badge com 2 não lidas
    });

    fireEvent.click(screen.getByRole("button", { name: /notificações/i }));
    expect(screen.getByText("Mensagem enviada")).toBeTruthy();
    expect(screen.getByText("Resposta recebida")).toBeTruthy();
    expect(screen.getByText(/Marina/i)).toBeTruthy();
  });

  it("marcar todas como lidas zera o badge", async () => {
    apiMocks.listActivity.mockResolvedValue({ activity: EVENTS });

    render(<NotificationBell />);
    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /notificações/i }));
    fireEvent.click(screen.getByRole("button", { name: /marcar lidas/i }));

    await waitFor(() => {
      expect(screen.queryByText("2")).toBeNull();
    });
    expect(localStorage.getItem("vibex_notifications_last_seen")).toBeTruthy();
  });

  it("sem eventos: vazio honesto, sem notificação inventada", async () => {
    apiMocks.listActivity.mockResolvedValue({ activity: [] });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: /notificações/i }));

    await waitFor(() => {
      expect(screen.getByText("Nenhuma notificação")).toBeTruthy();
    });
  });
});

describe("Sessão e 401 (conexão com o backend não pode falhar em silêncio)", () => {
  it("token salvo é restaurado sincronamente (api.setToken na montagem) e o perfil sobe no mount", async () => {
    localStorage.setItem(
      "vibex_auth_token",
      "eyJhbGciOiJI.eyJzdWIi.assinatura"
    );
    localStorage.setItem("vibex_auth_user", JSON.stringify({ name: "Lucas", email: "l@vibexcorp.com" }));

    render(
      <AuthProvider>
        <SessionDisplayer />
      </AuthProvider>
    );

    // Token: sincrono, antes de qualquer fetch de filho (fix do 401).
    expect(apiMocks.setToken).toHaveBeenCalledWith("eyJhbGciOiJI.eyJzdWIi.assinatura");
    // Perfil: sobe no mount (renderização igual à do servidor no primeiro
    // paint evita erro de hidratação no card do usuário).
    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("Lucas");
    });
  });

  it("evento global de 401 limpa a sessão e leva ao login", async () => {
    localStorage.setItem("vibex_auth_token", "token-expirado");
    localStorage.setItem(
      "vibex_auth_user",
      JSON.stringify({ name: "Lucas", email: "l@vibexcorp.com" })
    );

    render(
      <AuthProvider>
        <SessionDisplayer />
      </AuthProvider>
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("vibex:unauthorized", { detail: { code: "HTTP_401", message: "expired" } })
      );
    });

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/login");
    });
    expect(localStorage.getItem("vibex_auth_token")).toBeNull();
    expect(localStorage.getItem("vibex_auth_user")).toBeNull();
  });
});
