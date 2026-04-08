import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/types/api";

function getDefaultRoute(role: UserRole | null) {
  if (role === "doctor") {
    return "/doctor";
  }
  if (role === "hospital_admin") {
    return "/admin";
  }
  return "/patient";
}

export default function ProtectedRoute({
  allowedRoles,
  children,
}: {
  allowedRoles: UserRole[];
  children: JSX.Element;
}) {
  const { isAuthenticated, isInitializing, role } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading your workspace...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to={getDefaultRoute(role)} replace />;
  }

  return children;
}
