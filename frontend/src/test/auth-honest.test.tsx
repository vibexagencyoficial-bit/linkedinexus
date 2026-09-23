/**
 * D — TDD red: auth sem backdoor.
 *
 * Contrato do PRD-honestidade-conexao §2 Fase D:
 * - login() propaga o erro real da API (401) e NÃO cria sessão local;
 * - nenhum token "demo_token_vibex_2026"/"auth_tok_" é guardado;
 * - nenhuma sessão demo é criada no boot (sem usuário fictício);
 * - logout limpa o estado mesmo com API fora (honesto: sem sessão local).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    login: mocks.login,
    logout: mocks.logout,
    setToken: mocks.setToken,
  },
}));

// Router do Next: push observável sem navegar de verdade.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => "/login",
}));

import { AuthProvider, useAuth } from "@/lib/auth-context";

function Probe() {
  const { user, token, login, logout } = useAuth();
  const [loginError, setLoginError] = useState<string | null>(null);
  return (
    <div>
      <span data-testid="user">{user ? user.email : "no-user"}</span>
      <span data-testid="token">{token ?? "no-token"}</span>
      <span data-testid="login-error">{loginError ?? "no-error"}</span>
      <button
        onClick={() => {
          setLoginError(null);
          login("alguem@x.com", "errada").catch((e: Error) =>
            setLoginError(e.message)
          );
        }}
      >
        do-login
      </button>
      <button onClick={() => logout()}>do-logout</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("D — auth sem backdoor", () => {
  it("login com 401 NÃO cria sessão local nem guarda token", async () => {
    mocks.login.mockRejectedValue(new Error("AUTH_INVALID_CREDENTIALS: invalid email or password"));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText("do-login"));

    await waitFor(() => {
      expect(mocks.login).toHaveBeenCalledWith("alguem@x.com", "errada");
    });
    // O erro propaga (login rejeita) em vez de cair em fallback silencioso:
    await waitFor(() => {
      expect(screen.getByTestId("login-error").textContent).toContain(
        "AUTH_INVALID_CREDENTIALS"
      );
    });
    expect(screen.getByTestId("user").textContent).toBe("no-user");
    expect(screen.getByTestId("token").textContent).toBe("no-token");
    expect(localStorage.getItem("vibex_auth_token")).toBeNull();
    expect(localStorage.getItem("vibex_auth_user")).toBeNull();
    // Nenhum token demo guardado:
    expect(mocks.setToken).not.toHaveBeenCalledWith("demo_token_vibex_2026", expect.anything());
  });

  it("boot sem sessão salva NÃO cria usuário demo", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("no-user");
    });
    expect(screen.getByTestId("token").textContent).toBe("no-token");
    expect(localStorage.getItem("vibex_auth_token")).toBeNull();
  });

  it("login válido guarda a sessão real e navega", async () => {
    const realUser = {
      id: "u1",
      organization_id: "o1",
      email: "admin@vibexcorp.com",
      name: "Admin",
      role: "owner",
    };
    mocks.login.mockResolvedValue({ token: "jwt-real", user: realUser });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText("do-login"));

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("admin@vibexcorp.com");
    });
    expect(screen.getByTestId("token").textContent).toBe("jwt-real");
    expect(routerPush).toHaveBeenCalledWith("/");
  });
});
