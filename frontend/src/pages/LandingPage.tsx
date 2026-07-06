import { Activity } from "lucide-react";
import { Link } from "react-router-dom";

import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260315_073750_51473149-4350-4920-ae24-c8214286f323.mp4";

const featurePoints = [
  "AI triage and symptom intake",
  "Real doctor slot booking",
  "Doctor, patient, and admin workspaces",
];

function BrandMark() {
  return <img src="/favicon.svg" alt="Medicare Excellence" className="h-12 w-12 rounded-2xl shadow-card" />;
}

export default function LandingPage() {
  return (
    <div className="landing-shell relative min-h-screen overflow-hidden bg-background text-foreground">
      <video className="hero-video" src={VIDEO_URL} autoPlay loop muted playsInline />
      <div className="hero-grid pointer-events-none absolute inset-0" />
      <div className="hero-video-mask pointer-events-none absolute inset-0" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 py-2">
          <Link to="/" className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="font-display text-xl font-semibold tracking-tight !text-white">Medicare Excellence</p>
              <p className="text-xs uppercase tracking-[0.24em] !text-white/72">Connected hospital platform</p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle className="rounded-full border border-white/18 bg-slate-950/42 backdrop-blur-xl hover:bg-slate-950/55" />
            <Button variant="outline" size="sm" className="rounded-full" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button variant="hero" size="sm" className="rounded-full" asChild>
              <Link to="/signup">Create account</Link>
            </Button>
          </div>
        </header>

        <main className="grid flex-1 items-center gap-6 py-8 xl:grid-cols-[0.84fr_1.16fr]">
          <section className="relative max-w-2xl rounded-[2rem] border border-white/18 bg-slate-950/70 p-8 shadow-[0_24px_60px_rgba(2,8,23,0.42)] backdrop-blur-[24px] lg:p-10">
            <div>
              <div
                className="inline-flex items-center gap-2 rounded-full border border-white/18 bg-slate-950/54 px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] backdrop-blur-xl"
                style={{ color: "rgba(255,255,255,0.78)" }}
              >
                <Activity className="h-3.5 w-3.5 text-primary" />
                <span style={{ color: "rgba(255,255,255,0.78)" }}>Patient · Doctor · Admin</span>
              </div>

              <h1
                className="mt-8 max-w-[11ch] font-display text-5xl font-semibold leading-[0.92] tracking-[-0.055em] sm:text-6xl xl:text-[5.15rem]"
                style={{ color: "#ffffff" }}
              >
                One connected care workspace for the whole hospital.
              </h1>

              <p
                className="mt-6 max-w-2xl text-base leading-8 lg:text-lg"
                style={{ color: "rgba(255,255,255,0.84)" }}
              >
                Medicare Excellence brings intake, booking, clinical review, and hospital operations into one focused platform.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button variant="hero" size="xl" className="rounded-full px-6" asChild>
                  <Link to="/signup">Get started</Link>
                </Button>
                <Button variant="hero-outline" size="xl" className="rounded-full px-6" asChild>
                  <Link to="/login">Enter workspace</Link>
                </Button>
              </div>

              <div className="mt-8 space-y-3">
                {featurePoints.map((label) => (
                  <div
                    key={label}
                    className="w-fit rounded-full border border-white/14 bg-slate-950/46 px-4 py-2 text-sm font-medium backdrop-blur-xl"
                    style={{ color: "rgba(255,255,255,0.88)" }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.88)" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="relative hidden min-h-[34rem] xl:block">
            <div className="absolute inset-x-[12%] bottom-10 rounded-[2rem] border border-white/20 bg-slate-950/54 p-6 backdrop-blur-xl">
              <p className="text-xs uppercase tracking-[0.24em]" style={{ color: "rgba(255,255,255,0.60)" }}>
                Platform focus
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {[
                  {
                    title: "Faster intake",
                    description: "Capture symptoms quickly and route patients without manual back-and-forth.",
                  },
                  {
                    title: "Live scheduling",
                    description: "Show real doctor availability and book into open slots without collisions.",
                  },
                  {
                    title: "Continuous follow-up",
                    description: "Keep reminders, review risk, and care actions visible after the appointment.",
                  },
                ].map((item) => (
                  <div key={item.title} className="rounded-[1.4rem] border border-white/15 bg-slate-950/52 p-5">
                    <p className="font-display text-xl font-semibold" style={{ color: "#ffffff" }}>
                      {item.title}
                    </p>
                    <p className="mt-3 text-sm leading-7" style={{ color: "rgba(255,255,255,0.72)" }}>
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
