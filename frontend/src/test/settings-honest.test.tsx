/**
 * A1 — TDD: frontend honesto (settings).
 *
 * Codifica o contrato do PRD-honestidade-conexao §2 Fase A1 + F1 (limites):
 * quando a API falha, a UI NÃO fabrica sucesso — badge NOT CONNECTED, erro
 * real visível e "Configurações Salvas" só aparece com persistência real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { api } from "@/lib/api";

// Hoist seguro: o mock precisa existir antes dos imports do módulo.
const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  getExtensionStatus: vi.fn(),
  connectAccount: vi.fn(),
  getDailyLimits: vi.fn(),
  saveDailyLimits: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getCurrentAccount: mocks.getCurrentAccount,
    getExtensionStatus: mocks.getExtensionStatus,
    connectAccount: mocks.connectAccount,
    getDailyLimits: mocks.getDailyLimits,
    saveDailyLimits: mocks.saveDailyLimits,
  },
}));

import SettingsPage from "@/app/(dashboard)/settings/page";
import { cleanup } from "@testing-library/react";

const API_URL = "http://127.0.0.1:1/api/v1"; // porta fechada: garante falha real de rede

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getExtensionStatus.mockResolvedValue({ connected: false });
  mocks.getDailyLimits.mockResolvedValue({
    daily_limit: 30,
    allowed_start_time: "08:00",
    allowed_end_time: "18:00",
    timezone: "America/Sao_Paulo",
    server_max_limit: 50,
    server_min_limit: 5,
  });
  mocks.saveDailyLimits.mockResolvedValue({ status: "ok", daily_limit: 30 });
});

afterEach(() => {
  cleanup();
});

describe("A1 — settings honesta quando a API falha", () => {
  it("mantém NOT CONNECTED e mostra o erro real quando a conta falha", async () => {
    mocks.getCurrentAccount.mockRejectedValue(
      new Error("STORE_UNAVAILABLE: postgres offline - rode scripts/local/start.ps1")
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("NOT CONNECTED")).toBeTruthy();
    });
    // Badge NÃO pode virar CONNECTED por fabricação:
    expect(screen.queryByText("CONNECTED")).toBeNull();
    // Caixa de erro da conta com a mensagem real:
    expect(screen.getByText("Falha ao conectar a conta LinkedIn")).toBeTruthy();
    // Mensagem real do erro chega à UI (o hífen da mensagem é renderizado
    // em nó de texto próprio; matcher funcional cobre ambos os nós):
    expect(
      screen.getByText((_, node) => {
        if (!node || node.tagName !== "SPAN") return false;
        const text = node.textContent || "";
        return text.includes("STORE_UNAVAILABLE: postgres offline");
      })
    ).toBeTruthy();
    // Nenhum perfil fictício exibido:
    expect(screen.queryByText("Lucas (LinkedIn Profile)")).toBeNull();
    // api real também deve expor o erro (contrato do cliente tipado):
    await expect(api.getCurrentAccount()).rejects.toThrow();
  });

  it("Conectar LinkedIn com API fora NÃO injeta connected:true", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ connected: false });
    mocks.connectAccount.mockRejectedValue(
      new Error("STORE_UNAVAILABLE: postgres offline")
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("NOT CONNECTED")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Conectar LinkedIn (1 Clique)"));

    await waitFor(() => {
      expect(mocks.connectAccount).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("NOT CONNECTED")).toBeTruthy();
    });
    expect(screen.queryByText("Perfil Conectado")).toBeNull();
    expect(
      screen.getByText(/STORE_UNAVAILABLE: postgres offline/i)
    ).toBeTruthy();
  });
});

describe("F1 — limites diários vindos do backend (sem cosmético)", () => {
  it("exibe os valores persistidos carregados da API", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ connected: false });
    mocks.getDailyLimits.mockResolvedValue({
      daily_limit: 42,
      allowed_start_time: "09:30",
      allowed_end_time: "17:00",
      timezone: "America/Sao_Paulo",
      server_max_limit: 50,
      server_min_limit: 5,
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("42 ações / dia")).toBeTruthy();
    });
    expect(screen.getByText("Teto Backend: 50 msg/dia")).toBeTruthy();
  });

  it("falha ao carregar limites mostra o erro real (nada fabricado)", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ connected: false });
    mocks.getDailyLimits.mockRejectedValue(
      new Error("STORE_UNAVAILABLE: postgres offline")
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Falha nos limites de envio")).toBeTruthy();
    });
    expect(
      screen.getByText(/STORE_UNAVAILABLE: postgres offline/i)
    ).toBeTruthy();
  });

  it("salvar sem API NÃO mostra 'Configurações Salvas' — mostra o erro", async () => {
    mocks.getCurrentAccount.mockResolvedValue({ connected: false });
    mocks.saveDailyLimits.mockRejectedValue(
      new Error("STORE_UNAVAILABLE: postgres offline")
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Salvar Configurações")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Salvar Configurações"));

    await waitFor(() => {
      expect(mocks.saveDailyLimits).toHaveBeenCalled();
    });
    // Contrato honesto: nenhum feedback de sucesso sem persistência real.
    expect(screen.queryByText("Configurações Salvas")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("Falha nos limites de envio")).toBeTruthy();
    });
  });
});

describe("sanidade do cliente tipado", () => {
  it("cliente real propaga erro (sem fallback no VibexApiClient)", async () => {
    const { VibexApiClient } = await import("@vibexcorp/api-client");
    const client = new VibexApiClient(API_URL);
    await expect(client.getCurrentAccount()).rejects.toThrow();
    await expect(client.getDailyLimits()).rejects.toThrow();
  });
});
