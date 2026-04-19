import { useState } from "react";
import { Heart, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

import SupportFab from "@/components/SupportFab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { forgotPassword } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setPreviewUrl("");
    setIsSubmitting(true);

    try {
      const response = await forgotPassword({ email });
      setMessage(response.message);
      setPreviewUrl(response.preview_url || "");
    } catch (forgotError) {
      setError(forgotError instanceof Error ? forgotError.message : "Unable to start password reset.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="cinematic-mesh relative min-h-screen overflow-hidden px-4 py-10">
      <div className="hero-orb left-[10%] top-[10%] h-44 w-44" />
      <div className="hero-orb right-[14%] top-[18%] h-52 w-52" />

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <Card className="glass-panel w-full max-w-lg rounded-[2rem] border-0">
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-hero shadow-glow">
              <Heart className="h-7 w-7 text-white" />
            </div>
            <CardTitle className="font-display text-3xl font-semibold">Forgot password</CardTitle>
            <CardDescription className="text-base leading-7">
              Enter your email and we’ll send you a secure password reset link for your Medicare Excellence account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@hospital.org"
                />
              </div>
              <Button type="submit" variant="hero" className="w-full" disabled={isSubmitting}>
                <KeyRound className="mr-2 h-4 w-4" />
                {isSubmitting ? "Sending..." : "Send reset link"}
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

            {previewUrl ? (
              <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Local reset link</p>
                <p className="mt-1">SMTP is not configured, so you can open the reset link directly here.</p>
                <Button asChild variant="hero-outline" className="mt-3">
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    Open reset link
                  </a>
                </Button>
              </div>
            ) : null}

            <div className="flex justify-between text-sm text-muted-foreground">
              <Link to="/login" className="font-medium text-primary hover:text-primary/80">
                Back to sign in
              </Link>
              <Link to="/signup" className="font-medium text-primary hover:text-primary/80">
                Create account
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
      <SupportFab />
    </div>
  );
}
