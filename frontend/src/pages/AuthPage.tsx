import { useState } from "react";
import { Heart, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import SupportFab from "@/components/SupportFab";
import { ApiError } from "@/lib/api";
import type { UserRole } from "@/types/api";

const doctorSpecialties = [
  { value: "general_medicine", label: "General Medicine" },
  { value: "cardiology", label: "Cardiology" },
  { value: "pulmonology", label: "Pulmonology" },
  { value: "neurology", label: "Neurology" },
  { value: "endocrinology", label: "Endocrinology" },
];

function getRedirectPath(role: UserRole) {
  if (role === "doctor") {
    return "/doctor";
  }
  if (role === "hospital_admin") {
    return "/admin";
  }
  return "/patient";
}

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const navigate = useNavigate();
  const { loginUser, signupUser } = useAuth();
  const isSignup = mode === "signup";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("patient");
  const [specialty, setSpecialty] = useState("general_medicine");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = isSignup
        ? await signupUser({ name, email, password, role, specialty: role === "doctor" ? specialty : undefined })
        : await loginUser({ email, password });

      navigate(getRedirectPath(response.role), { replace: true });
    } catch (apiError) {
      setError(apiError instanceof ApiError ? apiError.message : "Unable to continue. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_hsl(var(--accent))_0%,_hsl(var(--background))_45%)]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-4 py-10 lg:flex-row lg:items-center">
        <div className="max-w-xl space-y-6">
          <Link to="/" className="inline-flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-hero shadow-glow">
              <Heart className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <p className="font-display text-lg font-bold text-foreground">Medicare Excellence</p>
              <p className="text-sm text-muted-foreground">AI-powered care operations for patients and clinicians</p>
            </div>
          </Link>

          <div className="space-y-3">
            <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
              {isSignup ? "Create your healthcare workspace" : "Welcome back to your care hub"}
            </h1>
            <p className="max-w-lg text-base text-muted-foreground">
              Secure access for patients, doctors, and hospital admins, with persistent medical chat history and live
              care operations backed by MongoDB.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, title: "Role-based access", description: "Patients, doctors, and hospital admins see only the tools they need." },
              { icon: LockKeyhole, title: "Protected sessions", description: "Signed login tokens keep access scoped and simple." },
              { icon: Mail, title: "Care continuity", description: "Chat and emergency activity stay attached to each patient." },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-card backdrop-blur">
                <item.icon className="mb-3 h-5 w-5 text-primary" />
                <p className="font-display text-sm font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>

        <Card className="w-full max-w-md border-border/60 bg-card/95 shadow-elevated">
          <CardHeader className="space-y-2">
            <CardTitle className="font-display text-2xl">
              {isSignup ? "Create account" : "Sign in"}
            </CardTitle>
            <CardDescription>
              {isSignup
                ? "Choose a role, create your account, and you will be routed to the correct panel automatically."
                : "Use your account credentials to continue to the right workspace."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignup && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Full name</label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ava Patel" />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@medicareexcellence.com"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 6 characters"
                />
              </div>

              {isSignup && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Role</label>
                  <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patient">Patient</SelectItem>
                      <SelectItem value="doctor">Doctor</SelectItem>
                      <SelectItem value="hospital_admin">Hospital Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isSignup && role === "doctor" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Specialty</label>
                  <Select value={specialty} onValueChange={setSpecialty}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a specialty" />
                    </SelectTrigger>
                    <SelectContent>
                      {doctorSpecialties.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Please wait..." : isSignup ? "Create account" : "Sign in"}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" />
                {isSignup ? "Already have an account?" : "Need a new account?"}
              </span>
              <Link
                to={isSignup ? "/login" : "/signup"}
                className="font-medium text-primary transition-colors hover:text-primary/80"
              >
                {isSignup ? "Sign in" : "Create one"}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
      <SupportFab />
    </div>
  );
}
