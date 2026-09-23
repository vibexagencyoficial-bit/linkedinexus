"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Sessão salva real: só restaura token + usuário persistidos de um login
    // válido. Sem sessão salva, NÃO existe sessão demo — o usuário segue
    // deslogado e o middleware de rota o leva a /login (Fase D).
    const savedToken = localStorage.getItem("vibex_auth_token");
    const savedUser = localStorage.getItem("vibex_auth_user");

    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(parsedUser);
        api.setToken(savedToken);
      } catch {
        localStorage.removeItem("vibex_auth_token");
        localStorage.removeItem("vibex_auth_user");
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, pass: string) => {
    // Sem fallback: o erro real da API (401 AUTH_INVALID_CREDENTIALS, 503
    // STORE_UNAVAILABLE) propaga para a página de login exibir. Criar sessão
    // local aqui mascararia falha de auth como sucesso (Fase D).
    const res = await api.login(email, pass);
    setUser(res.user);
    setToken(res.token);
    localStorage.setItem("vibex_auth_token", res.token);
    localStorage.setItem("vibex_auth_user", JSON.stringify(res.user));
    router.push("/");
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setToken(null);
    localStorage.removeItem("vibex_auth_token");
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
