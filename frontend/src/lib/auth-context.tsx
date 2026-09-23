"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { User } from "@vibexcorp/api-client";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Restaura a sessão salva SINCRONAMENTE na inicialização do provider (executa
// durante a render, antes de qualquer effect filho disparar fetch). Restaurar
// só no useEffect deixava o primeiro load do dashboard disparar fetch sem o
// header Authorization → HTTP 401 "authorization header required".
function loadSavedSession(): { token: string; user: User } | null {
  if (typeof window === "undefined") return null;
  const savedToken = localStorage.getItem("vibex_auth_token");
  const savedUser = localStorage.getItem("vibex_auth_user");
  if (!savedToken || !savedUser) return null;
  try {
    return { token: savedToken, user: JSON.parse(savedUser) as User };
  } catch {
    localStorage.removeItem("vibex_auth_token");
    localStorage.removeItem("vibex_auth_user");
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // useState com inicializador: roda na primeira render, não depois.
  const [session] = useState(loadSavedSession);
  // O TOKEN precisa existir na primeira render do cliente (fix do 401), mas o
  // PERFIL exibido não: servidor renderiza sem sessão, e vazar o usuário do
  // localStorage já na hidratação gera mismatch de HTML (erro "Hydration
  // failed" no card do usuário). O usuário sobe no mount, depois do primeiro
  // paint — mesmo resultado na tela, HTML idêntico servidor/cliente.
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(session?.token ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  // Token disponível para TODAS as requisições desde o primeiro render.
  useMemo(() => {
    if (session?.token) {
      api.setToken(session.token);
    }
  }, [session]);

  // Perfil aparece só depois do mount: igual ao SSR no primeiro paint.
  useEffect(() => {
    if (session?.user) setUser(session.user);
  }, [session]);


  // 401 = sessão inválida/expirada no servidor: limpa e leva ao login uma
  // única vez (o api-client emite "vibex:unauthorized" em todo 401 de API).
  const redirectedRef = useRef(false);
  useEffect(() => {
    const onUnauthorized = () => {
      if (redirectedRefGuard()) return;
      setUser(null);
      setToken(null);
      localStorage.removeItem("vibex_auth_token");
      localStorage.removeItem("vibex_refresh_token");
      localStorage.removeItem("vibex_auth_user");
      router.push("/login");
    };
    function redirectedRefGuard() {
      if (redirectedRef.current) return true;
      redirectedRef.current = true;
      return false;
    }
    window.addEventListener("vibex:unauthorized", onUnauthorized);
    return () => window.removeEventListener("vibex:unauthorized", onUnauthorized);
  }, [router]);

  const login = async (email: string, pass: string) => {
    // Sem fallback: o erro real da API (401 AUTH_INVALID_CREDENTIALS, 503
    // STORE_UNAVAILABLE) propaga para a página de login exibir. Criar sessão
    // local aqui mascararia falha de auth como sucesso (Fase D).
    setIsLoading(true);
    try {
      const res = await api.login(email, pass);
      setUser(res.user);
      setToken(res.token);
      localStorage.setItem("vibex_auth_token", res.token);
      // Access token é temporário (15min): o refresh (7d) permite renovar
      // sem logout; o api-client renova automaticamente em 401.
      if (res.refresh_token) {
        localStorage.setItem("vibex_refresh_token", res.refresh_token);
      }
      localStorage.setItem("vibex_auth_user", JSON.stringify(res.user));
      redirectedRef.current = false;
      router.push("/");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setToken(null);
    localStorage.removeItem("vibex_auth_token");
    localStorage.removeItem("vibex_refresh_token");
    localStorage.removeItem("vibex_auth_user");
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
