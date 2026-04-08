import { createContext, useContext, useEffect, useState } from "react";

import { getCurrentSession, login, signup } from "@/lib/api";
import type { AuthResponse, AuthUser, PatientProfile, UserRole } from "@/types/api";

const SESSION_STORAGE_KEY = "medicare-excellence-session";

interface StoredSession {
  token: string;
  role: UserRole;
  user: AuthUser;
  profile: PatientProfile | null;
}

interface AuthContextValue {
  token: string | null;
  role: UserRole | null;
  user: AuthUser | null;
  profile: PatientProfile | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  loginUser: (payload: { email: string; password: string }) => Promise<AuthResponse>;
  signupUser: (payload: { name: string; email: string; password: string; role: UserRole; specialty?: string }) => Promise<AuthResponse>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): StoredSession | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function persistSession(session: StoredSession | null) {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function hydrateSession() {
      if (!session?.token) {
        if (isMounted) {
          setIsInitializing(false);
        }
        return;
      }

      try {
        const current = await getCurrentSession(session.token);
        if (!isMounted) {
          return;
        }

        const nextSession: StoredSession = {
          token: session.token,
          role: current.role,
          user: current.user,
          profile: current.profile,
        };

        setSession(nextSession);
        persistSession(nextSession);
      } catch {
        if (!isMounted) {
          return;
        }

        setSession(null);
        persistSession(null);
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    }

    void hydrateSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const loginUser = async (payload: { email: string; password: string }) => {
    const result = await login(payload);
    const nextSession: StoredSession = {
      token: result.token,
      role: result.role,
      user: result.user,
      profile: result.profile,
    };

    setSession(nextSession);
    persistSession(nextSession);
    return result;
  };

  const signupUser = async (payload: { name: string; email: string; password: string; role: UserRole; specialty?: string }) => {
    const result = await signup(payload);
    const nextSession: StoredSession = {
      token: result.token,
      role: result.role,
      user: result.user,
      profile: result.profile,
    };

    setSession(nextSession);
    persistSession(nextSession);
    return result;
  };

  const logout = () => {
    setSession(null);
    persistSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token: session?.token || null,
        role: session?.role || null,
        user: session?.user || null,
        profile: session?.profile || null,
        isAuthenticated: Boolean(session?.token),
        isInitializing,
        loginUser,
        signupUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
}
