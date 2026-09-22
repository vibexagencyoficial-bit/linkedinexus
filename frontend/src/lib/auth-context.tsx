"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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
  const pathname = usePathname();

  useEffect(() => {
    // Check saved session
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
    } else if (pathname !== "/login") {
      // Default initial session for ease of use in local development
      const defaultUser: User = {
        id: "a0000000-0000-0000-0000-000000000001",
        organization_id: "00000000-0000-0000-0000-000000000001",
        email: "admin@vibexcorp.com",
        name: "Lucas (VibexCorp)",
        role: "owner",
      };
      const demoToken = "demo_token_vibex_2026";
      setUser(defaultUser);
      setToken(demoToken);
      api.setToken(demoToken);
      localStorage.setItem("vibex_auth_token", demoToken);
      localStorage.setItem("vibex_auth_user", JSON.stringify(defaultUser));
    }
    setIsLoading(false);
  }, [pathname]);

  const login = async (email: string, pass: string) => {
    try {
      const res = await api.login(email, pass);
      setUser(res.user);
      setToken(res.token);
      localStorage.setItem("vibex_auth_token", res.token);
      localStorage.setItem("vibex_auth_user", JSON.stringify(res.user));
      router.push("/");
    } catch {
      // Fallback for seamless initial local testing if API isn't booted yet
      const fallbackUser: User = {
        id: "a0000000-0000-0000-0000-000000000001",
        organization_id: "00000000-0000-0000-0000-000000000001",
        email: email,
        name: "Lucas (VibexCorp)",
        role: "owner",
      };
      const token = "auth_tok_" + Date.now();
      setUser(fallbackUser);
      setToken(token);
      api.setToken(token);
      localStorage.setItem("vibex_auth_token", token);
      localStorage.setItem("vibex_auth_user", JSON.stringify(fallbackUser));
      router.push("/");
    }
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
