import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import ThemeToggle from "@/components/ThemeToggle";
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
const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4";
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
    <div className="landing-shell relative min-h-screen overflow-y-auto overflow-x-hidden bg-background px-4 py-5 text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <video className="hero-video" src={VIDEO_URL} autoPlay loop muted playsInline />
        <div className="hero-grid" />
        <div className="hero-video-mask opacity-80 dark:opacity-100" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-5xl flex-col">
        <div className="flex items-center justify-between py-3">
          <Link to="/" className="flex items-center gap-3">
            <img src="/favicon.svg" alt="Medicare Excellence" className="h-10 w-10 rounded-2xl" />
            <div>
              <p className="font-display text-lg font-semibold tracking-tight text-white">Medicare Excellence</p>
              <p className="text-xs uppercase tracking-[0.22em] text-white/60">AI hospital coordination</p>
            </div>
          </Link>
          <ThemeToggle className="rounded-full border border-border/60 bg-background/65 backdrop-blur-xl hover:bg-background/85" />
        </div>

        <div className="flex flex-1 items-center justify-center py-6 lg:py-10">
          <Card className={`glass-panel beam-border w-full rounded-[2rem] border-0 ${isSignup ? "max-w-2xl" : "max-w-lg"}`}>
          <CardHeader className="space-y-1 pb-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img src="/favicon.svg" alt="Medicare Excellence" className="h-11 w-11 rounded-2xl" />
                <div>
                  <p className="font-display text-lg font-semibold tracking-tight text-white">Medicare Excellence</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/60">Hospital workspace</p>
                </div>
              </div>
              <div className="inline-flex rounded-full border border-border/60 bg-background/55 p-1 backdrop-blur-xl">
                <Link
                  to="/login"
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    !isSignup ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Sign in
                </Link>
                <Link
                  to="/signup"
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    isSignup ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Create account
                </Link>
              </div>
            </div>
            <CardTitle className="font-display text-2xl font-semibold text-white">{isSignup ? "Create account" : "Sign in"}</CardTitle>
            <CardDescription className="text-sm leading-6 text-white/70">{isSignup ? "Create your account." : "Sign in to continue."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              {isSignup ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white">Full name</label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ava Patel" />
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium text-white">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@hospital.org"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white">Password</label>
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
                  <label className="text-sm font-medium text-white">Role</label>
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
                  <label className="text-sm font-medium text-white">Specialty</label>
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
                    <label className="text-sm font-medium text-white">Phone number</label>
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
                      <label className="text-sm font-medium text-white">Date of birth</label>
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
                      <label className="text-sm font-medium text-white">Gender</label>
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
              <span>{isSignup ? "Already have an account?" : "Need a new account?"}</span>
              <Link to={isSignup ? "/login" : "/signup"} className="font-medium text-primary hover:text-primary/80">
                {isSignup ? "Sign in" : "Create one"}
              </Link>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
