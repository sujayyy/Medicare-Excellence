import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
const LandingPage = lazy(() => import("./pages/LandingPage"));
const PatientDashboard = lazy(() => import("./pages/PatientDashboard"));
const DoctorDashboard = lazy(() => import("./pages/DoctorDashboard"));
const HospitalAdminDashboard = lazy(() => import("./pages/HospitalAdminDashboard"));
const AnalyticsDashboard = lazy(() => import("./pages/AnalyticsDashboard"));
const DoctorSearch = lazy(() => import("./pages/DoctorSearch"));
const AppointmentBooking = lazy(() => import("./pages/AppointmentBooking"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function getDefaultRoute(role: string | null | undefined) {
  if (role === "doctor") {
    return "/doctor";
  }
  if (role === "hospital_admin") {
    return "/admin";
  }
  return "/patient";
}

function HomeRoute() {
  const { isAuthenticated, role, isInitializing } = useAuth();

  if (isInitializing) {
    return <div className="min-h-screen bg-background" />;
  }

  if (isAuthenticated) {
    return <Navigate to={getDefaultRoute(role)} replace />;
  }

  return <LandingPage />;
}

function PublicOnlyRoute({ children }: { children: JSX.Element }) {
  const { isAuthenticated, role, isInitializing } = useAuth();

  if (isInitializing) {
    return <div className="min-h-screen bg-background" />;
  }

  if (isAuthenticated) {
    return <Navigate to={getDefaultRoute(role)} replace />;
  }

  return children;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Routes>
              <Route path="/" element={<HomeRoute />} />
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <AuthPage mode="login" />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/signup"
                element={
                  <PublicOnlyRoute>
                    <AuthPage mode="signup" />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/patient"
                element={
                  <ProtectedRoute allowedRoles={["patient"]}>
                    <PatientDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/doctor"
                element={
                  <ProtectedRoute allowedRoles={["doctor"]}>
                    <DoctorDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={["hospital_admin"]}>
                    <HospitalAdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/doctors"
                element={
                  <ProtectedRoute allowedRoles={["patient"]}>
                    <DoctorSearch />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/appointments"
                element={
                  <ProtectedRoute allowedRoles={["patient"]}>
                    <AppointmentBooking />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/analytics"
                element={
                  <ProtectedRoute allowedRoles={["hospital_admin"]}>
                    <AnalyticsDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/ai-assistant" element={<Navigate to="/patient" replace />} />
              <Route path="/patient-dashboard" element={<Navigate to="/patient" replace />} />
              <Route path="/doctor-dashboard" element={<Navigate to="/doctor" replace />} />
              <Route path="/admin-dashboard" element={<Navigate to="/admin" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
