import { useMemo, useState } from "react";
import { Heart, KeyRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import ThemeToggle from "@/components/ThemeToggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/api";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") || "", [params]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!token) {
      setError("This reset link is missing a token.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await resetPassword({ token, password });
      setMessage(response.message);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="landing-shell relative min-h-screen overflow-hidden bg-background px-4 py-5 text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <video className="hero-video" src={VIDEO_URL} autoPlay loop muted playsInline />
        <div className="hero-grid" />
        <div className="hero-video-mask opacity-80 dark:opacity-100" />
      </div>
      <div className="hero-orb left-[12%] top-[12%] h-44 w-44" />
      <div className="hero-orb right-[16%] top-[24%] h-56 w-56" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-7xl flex-col">
        <div className="flex items-center justify-between py-3">
          <Link to="/" className="flex items-center gap-3">
            <img src="/favicon.svg" alt="Medicare Excellence" className="h-10 w-10 rounded-2xl" />
            <div>
              <p className="font-display text-lg font-semibold tracking-tight">Medicare Excellence</p>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">AI hospital coordination</p>
            </div>
          </Link>
          <ThemeToggle className="rounded-full border border-white/20 bg-white/10 backdrop-blur-xl hover:bg-white/15" />
        </div>

        <div className="grid flex-1 gap-6 py-4 lg:grid-cols-[1fr_460px] lg:items-center lg:gap-8">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/65 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground backdrop-blur-xl">
              Secure Password Reset
            </div>
            <div className="max-w-3xl space-y-4">
              <h1 className="font-display text-4xl font-semibold leading-[0.96] tracking-[-0.045em] sm:text-[3.7rem]">
                Finish recovery and return to care quickly.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                This step keeps the flow short and focused while still matching the upgraded brand and theme system.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="liquid-glass-strong rounded-[1.7rem] p-5">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/12 dark:bg-white/8">
                  <Heart className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-display text-xl font-semibold">Fresh credentials</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  Set a new password without leaving the same polished public-facing experience patients and clinicians
                  see everywhere else.
                </p>
              </div>
              <div className="liquid-glass rounded-[1.7rem] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reset outcome</p>
                <p className="mt-3 font-display text-xl font-semibold text-foreground">Back into the right workspace</p>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  As soon as the password changes, the person can return to the same patient, doctor, or admin flow
                  without rebuilding their account context.
                </p>
              </div>
            </div>
          </div>

          <Card className="glass-panel mx-auto w-full max-w-lg rounded-[2rem] border-0">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-hero shadow-glow">
              <Heart className="h-7 w-7 text-white" />
            </div>
            <CardTitle className="font-display text-3xl font-semibold">Set a new password</CardTitle>
            <CardDescription className="text-base leading-7">
              Create a fresh password for your Medicare Excellence account and return to sign in securely.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">New password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 6 characters"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Confirm password</label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter your password"
                />
              </div>
              <Button type="submit" variant="hero" className="w-full" disabled={isSubmitting}>
                <KeyRound className="mr-2 h-4 w-4" />
                {isSubmitting ? "Updating..." : "Update password"}
              </Button>
            </form>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {message ? (
              <Alert>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-between text-sm text-muted-foreground">
              <Link to="/login" className="font-medium text-primary hover:text-primary/80">
                Back to sign in
              </Link>
              <Link to="/forgot-password" className="font-medium text-primary hover:text-primary/80">
                Need another reset link?
              </Link>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
