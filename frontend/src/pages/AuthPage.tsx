import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Heart, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import SupportFab from "@/components/SupportFab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import type { UserRole } from "@/types/api";

const doctorSpecialties = [
  { value: "general_medicine", label: "General Medicine" },
  { value: "cardiology", label: "Cardiology" },
  { value: "pulmonology", label: "Pulmonology" },
  { value: "neurology", label: "Neurology" },
  { value: "endocrinology", label: "Endocrinology" },
  { value: "dermatology", label: "Dermatology" },
  { value: "orthopedics", label: "Orthopedics" },
  { value: "pediatrics", label: "Pediatrics" },
  { value: "psychiatry", label: "Psychiatry" },
  { value: "ent", label: "ENT" },
  { value: "gynecology", label: "Gynecology" },
  { value: "gastroenterology", label: "Gastroenterology" },
  { value: "nephrology", label: "Nephrology" },
  { value: "oncology", label: "Oncology" },
  { value: "ophthalmology", label: "Ophthalmology" },
];

const countryCodes = ["+91", "+1", "+44", "+61", "+971", "+65"];
const currentYear = new Date().getFullYear();
const nativeSelectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

function getRedirectPath(role: UserRole) {
  if (role === "doctor") return "/doctor";
  if (role === "hospital_admin") return "/admin";
  return "/patient";
}

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginUser, signupUser } = useAuth();
  const isSignup = mode === "signup";
  const flash = (location.state as { message?: string; email?: string; preview_url?: string } | null) || null;

  const [name, setName] = useState("");
  const [email, setEmail] = useState(flash?.email || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>("patient");
  const [specialty, setSpecialty] = useState("general_medicine");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("male");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState(flash?.message || "");
  const [previewUrl, setPreviewUrl] = useState(flash?.preview_url || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sideCards = useMemo(
    () => [
      {
        icon: ShieldCheck,
        title: "Protected identities",
        description: "Role-aware access, secure sessions, and admin review keep the workspace tightly controlled.",
      },
      {
        icon: LockKeyhole,
        title: "Recovery-ready auth",
        description: "Forgot-password recovery is built directly into the sign-in experience.",
      },
      {
        icon: Mail,
        title: "Clinical continuity",
        description: "Chats, documents, appointments, and patient context remain attached to the same account lifecycle.",
      },
    ],
    [],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setPreviewUrl("");
    setIsSubmitting(true);

    try {
      const dobValue = dob || undefined;
      const normalizedPhone = phoneNumber ? `${countryCode} ${phoneNumber}` : undefined;

      if (isSignup && role === "patient") {
        if (!dob) {
          setError("Please select your date of birth.");
          return;
        }
        const birthYear = Number(dob.slice(0, 4));
        if (!birthYear || birthYear > currentYear || birthYear < currentYear - 120) {
          setError("Please choose a valid date of birth.");
          return;
        }
      }

      const response = isSignup
        ? await signupUser({
            name,
            email,
            password,
            role,
            specialty: role === "doctor" ? specialty : undefined,
            phone: role === "patient" ? normalizedPhone : undefined,
            dob: role === "patient" ? dobValue : undefined,
            gender: role === "patient" ? gender : undefined,
          })
        : await loginUser({ email, password });

      if (isSignup && response.requires_approval) {
        navigate("/login", {
          replace: true,
          state: { message: response.message || "Doctor access request submitted.", email },
        });
        return;
      }

      navigate(getRedirectPath(response.role), { replace: true });
    } catch (apiError) {
      if (apiError instanceof ApiError) {
        setError(apiError.message);
      } else {
        setError("Unable to continue. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="cinematic-mesh relative min-h-screen overflow-y-auto overflow-x-hidden px-4 py-5">
      <div className="aurora-rings pointer-events-none absolute inset-0 opacity-70" />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-20" />
      <motion.div
        className="hero-orb left-[6%] top-[10%] h-36 w-36"
        animate={{ y: [0, -16, 0], x: [0, 8, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="hero-orb right-[10%] top-[18%] h-48 w-48"
        animate={{ y: [0, 22, 0], x: [0, -10, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="hero-orb bottom-[8%] left-[28%] h-40 w-40"
        animate={{ y: [0, -20, 0], x: [0, 6, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-6xl gap-6 lg:grid-cols-[1fr_440px] lg:items-center">
        <div className="max-w-2xl space-y-5">
          <Link to="/" className="inline-flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-hero shadow-glow">
              <Heart className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-display text-lg font-bold text-foreground">Medicare Excellence</p>
              <p className="text-xs text-muted-foreground">Secure digital hospital operations</p>
            </div>
          </Link>

          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/65 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground backdrop-blur-xl">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Verified Clinical Access
            </div>
            <h1 className="max-w-3xl font-display text-3xl font-semibold leading-[0.98] tracking-[-0.045em] text-foreground sm:text-[3.35rem]">
              {isSignup ? "Create a trusted care identity." : "Step back into your clinical workspace."}
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              {isSignup
                ? "Patients join directly, doctors request access, and every identity is reviewed before entering the live hospital workflow."
                : "Sign in to continue patient care, clinician coordination, and hospital operations without losing your history."}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {sideCards.map((card, index) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.4 }}
                className="depth-card rounded-[1.5rem] border border-white/70 p-4"
              >
                <card.icon className="mb-4 h-5 w-5 text-primary" />
                <p className="font-display text-base font-semibold text-foreground">{card.title}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{card.description}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <Card className="glass-panel beam-border w-full rounded-[1.75rem] border-0">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="font-display text-2xl font-semibold">{isSignup ? "Create account" : "Sign in"}</CardTitle>
            <CardDescription className="text-sm leading-6">
              {isSignup
                ? "Patients create accounts directly. Doctors request access and wait for hospital-admin approval."
                : "Sign in with your verified email to continue into the correct workspace."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              {isSignup ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Full name</label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ava Patel" />
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@hospital.org"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  {!isSignup ? (
                    <Link to="/forgot-password" className="text-xs font-medium text-primary hover:text-primary/80">
                      Forgot password?
                    </Link>
                  ) : null}
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimum 6 characters"
                    className="pr-12"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-3 inline-flex items-center text-muted-foreground transition hover:text-foreground"
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>

              {isSignup ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Role</label>
                  <select
                    className={nativeSelectClass}
                    value={role}
                    onChange={(event) => setRole(event.target.value as UserRole)}
                  >
                    <option value="patient">Patient</option>
                    <option value="doctor">Doctor</option>
                    <option value="hospital_admin">Hospital Admin</option>
                  </select>
                </div>
              ) : null}

              {isSignup && role === "doctor" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Specialty</label>
                  <select
                    className={nativeSelectClass}
                    value={specialty}
                    onChange={(event) => setSpecialty(event.target.value)}
                  >
                    {doctorSpecialties.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {isSignup && role === "patient" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Phone number</label>
                    <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                      <select
                        className={nativeSelectClass}
                        value={countryCode}
                        onChange={(event) => setCountryCode(event.target.value)}
                      >
                        {countryCodes.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        maxLength={15}
                        placeholder="9876543210 (optional)"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Date of birth</label>
                      <Input
                        type="date"
                        value={dob}
                        min={`${currentYear - 120}-01-01`}
                        max={`${currentYear}-12-31`}
                        onChange={(event) => setDob(event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Use the calendar icon or type in the date field.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Gender</label>
                      <select className={nativeSelectClass} value={gender} onChange={(event) => setGender(event.target.value)}>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                        <option value="prefer_not_to_say">Prefer not to say</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {successMessage ? (
                <Alert>
                  <AlertDescription>{successMessage}</AlertDescription>
                </Alert>
              ) : null}

              {previewUrl ? (
                <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Local email preview</p>
                  <p className="mt-1">SMTP is not configured, so you can continue with the generated action link.</p>
                  <Button asChild variant="hero-outline" className="mt-3">
                    <a href={previewUrl} target="_blank" rel="noreferrer">
                      Open email action
                    </a>
                  </Button>
                </div>
              ) : null}

              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Please wait..." : isSignup ? "Create account" : "Sign in"}
                {!isSubmitting ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
              </Button>
            </form>

            <div className="flex items-center justify-between rounded-2xl bg-muted/45 px-4 py-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <UserRound className="h-4 w-4 text-primary" />
                {isSignup ? "Already have an account?" : "Need a new account?"}
              </span>
              <Link to={isSignup ? "/login" : "/signup"} className="font-medium text-primary hover:text-primary/80">
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
