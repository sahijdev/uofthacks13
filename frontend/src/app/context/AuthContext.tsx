"use client";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type AuthState = {
  user: { email: string } | null;
  token: string | null;
  initializing: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

type JwtPayload = { email?: string; exp?: number };

function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split(".");
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded) as JwtPayload;
  } catch (err) {
    console.error("Failed to decode token", err);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    if (stored) {
      const payload = decodeJwt(stored);
      const expired = payload?.exp ? payload.exp * 1000 < Date.now() : false;
      if (!expired) {
        setToken(stored);
        setUser(payload?.email ? { email: payload.email } : null);
      } else {
        localStorage.removeItem("auth_token");
      }
    }
    setInitializing(false);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("auth_token");
    setToken(null);
    setUser(null);
  }, []);

  const finishAuth = useCallback((receivedToken: string) => {
    const payload = receivedToken ? decodeJwt(receivedToken) : null;
    if (!receivedToken || !payload?.email) {
      throw new Error("Invalid token received");
    }
    localStorage.setItem("auth_token", receivedToken);
    setToken(receivedToken);
    setUser({ email: payload.email });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Login failed");
      }

      const data = await res.json();
      finishAuth(data?.token);
    },
    [finishAuth]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error?.message || "Sign up failed");
      }

      const data = await res.json();
      finishAuth(data?.token);
    },
    [finishAuth]
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      initializing,
      isAuthenticated: Boolean(token),
      login,
      register,
      logout,
    }),
    [initializing, login, logout, register, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
