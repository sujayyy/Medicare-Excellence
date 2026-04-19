import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Heart, MailCheck, RefreshCcw } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import SupportFab from "@/components/SupportFab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resendVerification, verifyEmail } from "@/lib/api";

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const state = (location.state as { email?: string; message?: string; preview_url?: string } | null) || null;
  const token = params.get("token") || "";
  const email = useMemo(() => params.get("email") || state?.email || "", [params, state?.email]);

  const [message, setMessage] = useState(state?.message || "Check your inbox to verify your Medicare Excellence account.");
  const [previewUrl, setPreviewUrl] = useState(state?.preview_url || "");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [isResending, setIsResending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    async function runVerification() {
      try {
        const response = await verifyEmail({ token });
        if (cancelled) return;
        setIsVerified(true);
        setError("");
        setMessage(response.message);
      } catch (verificationError) {
        if (cancelled) return;
        setError(verificationError instanceof Error ? verificationError.message : "Unable to verify your email.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void runVerification();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleResend() {
    if (!email) {
      setError("Enter your email from the sign-up page to resend verification.");
      return;
    }
    setIsResending(true);
    setError("");
    try {
      const response = await resendVerification({ email });
      setMessage(response.message);
      setPreviewUrl(response.preview_url || "");
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Unable to resend verification email.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="cinematic-mesh relative min-h-screen overflow-hidden px-4 py-10">
      <div className="hero-orb left-[8%] top-[12%] h-40 w-40" />
      <div className="hero-orb right-[12%] top-[24%] h-56 w-56" />
      <div className="hero-orb bottom-[10%] left-[30%] h-48 w-48" />

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <Card className="glass-panel w-full max-w-xl rounded-[2rem] border-0">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-hero shadow-glow">
              <Heart className="h-7 w-7 text-white" />
            </div>
            <CardTitle className="font-display text-3xl font-semibold">
              {isVerified ? "Email verified" : "Verify your email"}
            </CardTitle>
            <CardDescription className="text-base leading-7">
              {isVerified
                ? "Your account is now ready. Continue to sign in and access your workspace."
                : "Secure sign-in starts with email verification, so only the right person can access the healthcare workspace."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? (
              <Alert>
                <AlertDescription>Verifying your link. Please wait a moment...</AlertDescription>
              </Alert>
            ) : null}

            {!isLoading && error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {!error ? (
              <Alert>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            ) : null}

            {previewUrl ? (
              <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Local preview link</p>
                <p className="mt-1">SMTP is not configured, so you can open the verification link directly here.</p>
                <Button asChild variant="hero-outline" className="mt-3">
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    Open verification link
                  </a>
                </Button>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="hero" className="flex-1">
                <Link to="/login">{isVerified ? "Go to sign in" : "Back to sign in"}</Link>
              </Button>
              {!isVerified ? (
                <Button onClick={handleResend} disabled={isResending} variant="hero-outline" className="flex-1">
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  {isResending ? "Resending..." : "Resend verification"}
                </Button>
              ) : null}
            </div>

            <div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <MailCheck className="h-4 w-4 text-primary" />
                What happens next
              </div>
              <p className="mt-2">
                Once verified, you can sign in normally. Doctors still require hospital-admin approval before their
                workspace is activated.
              </p>
            </div>

            {isVerified ? (
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Verification completed successfully
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <SupportFab />
    </div>
  );
}
