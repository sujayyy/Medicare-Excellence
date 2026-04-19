import { useMemo, useState } from "react";
import { Heart, KeyRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import SupportFab from "@/components/SupportFab";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/api";

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
    <div className="cinematic-mesh relative min-h-screen overflow-hidden px-4 py-10">
      <div className="hero-orb left-[12%] top-[12%] h-44 w-44" />
      <div className="hero-orb right-[16%] top-[24%] h-56 w-56" />

      <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <Card className="glass-panel w-full max-w-lg rounded-[2rem] border-0">
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
      <SupportFab />
    </div>
  );
}
