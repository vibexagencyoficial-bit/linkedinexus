/**
 * F4 — TDD: página /extension honesta.
 *
 * A página dedicada da extensão herda o contrato A1: status OFFLINE real
 * quando a API falha, erro visível e nenhum código de pareamento fabricado
 * (Math.random jamais gera pairing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getExtensionStatus: vi.fn(),
  generatePairingCode: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getExtensionStatus: mocks.getExtensionStatus,
    generatePairingCode: mocks.generatePairingCode,
  },
  // URL estável para o teste do botão de download
  EXTENSION_DOWNLOAD_URL: "http://localhost:8080/api/v1/downloads/extension.zip",
}));

import ExtensionPage from "@/app/(dashboard)/extension/page";
import { cleanup } from "@testing-library/react";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("F4 — página /extension honesta", () => {
  it("mostra o passo a passo de instalação e o botão de download", async () => {
    mocks.getExtensionStatus.mockResolvedValue({ connected: false });

    render(<ExtensionPage />);

    expect(screen.getByText("Baixar Extensão (.zip)")).toBeTruthy();
    expect(screen.getByText("Ative o Modo do Desenvolvedor")).toBeTruthy();
    const link = screen.getByText("Baixar Extensão (.zip)").closest("a");
    expect(link?.getAttribute("href")).toContain("/downloads/extension.zip");
  });

  it("mantém OFFLINE e mostra o erro real quando o status falha", async () => {
    mocks.getExtensionStatus.mockRejectedValue(
      new Error("STORE_UNAVAILABLE: postgres offline")
    );

    render(<ExtensionPage />);

    await waitFor(() => {
      expect(screen.getByText("OFFLINE")).toBeTruthy();
    });
    expect(screen.queryByText("Extensão Ativa e Sincronizada")).toBeNull();
    expect(
      screen.getByText(/STORE_UNAVAILABLE: postgres offline/i)
    ).toBeTruthy();
  });

  it("não gera código local via Math.random quando o pareamento falha", async () => {
    const randomSpy = vi.spyOn(Math, "random");
    mocks.getExtensionStatus.mockResolvedValue({ connected: false });
    mocks.generatePairingCode.mockRejectedValue(
      new Error("STORE_UNAVAILABLE: postgres offline")
    );

    render(<ExtensionPage />);

    await waitFor(() => {
      expect(screen.getByText("Gerar Código de Pareamento")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Gerar Código de Pareamento"));

    await waitFor(() => {
      expect(mocks.generatePairingCode).toHaveBeenCalled();
    });
    // Contrato honesto: Math.random jamais é usado como pairing:
    expect(randomSpy).not.toHaveBeenCalled();
    // Nenhum bloco de código fictício exibido:
    expect(screen.queryByText(/Código de Pareamento Único/i)).toBeNull();
    // O erro real substitui o código:
    await waitFor(() => {
      expect(screen.getByText("Falha ao gerar código de pareamento")).toBeTruthy();
    });
    randomSpy.mockRestore();
  });

  it("pareamento bem-sucedido exibe o código retornado pela API", async () => {
    mocks.getExtensionStatus.mockResolvedValue({ connected: false });
    mocks.generatePairingCode.mockResolvedValue({
      pairing_code: "8A2F1B09",
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    render(<ExtensionPage />);

    await waitFor(() => {
      expect(screen.getByText("Gerar Código de Pareamento")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Gerar Código de Pareamento"));

    await waitFor(() => {
      expect(screen.getByText("8A2F1B09")).toBeTruthy();
    });
    expect(screen.getByText(/Código de Pareamento Único/i)).toBeTruthy();
  });
});
