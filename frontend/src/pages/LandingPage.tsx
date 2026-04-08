import { motion } from "framer-motion";
import { ArrowRight, Brain, Calendar, Heart, Search, Shield, Star, Stethoscope, Users } from "lucide-react";
import { Link } from "react-router-dom";

import SupportFab from "@/components/SupportFab";
import { Button } from "@/components/ui/button";

const stats = [
  { value: "24/7", label: "AI triage coverage" },
  { value: "2", label: "Role-based workspaces" },
  { value: "100%", label: "Mongo-backed activity" },
  { value: "MVP", label: "Startup-ready platform" },
];

const features = [
  { icon: Brain, title: "AI Symptom Guidance", desc: "Patients get faster first-response guidance with preserved chat history." },
  { icon: Calendar, title: "Appointment Detection", desc: "Requests are captured directly from chat and reflected in patient records." },
  { icon: Shield, title: "Protected Access", desc: "Patients and admins are separated by login, routing, and backend authorization." },
  { icon: Users, title: "Live Patient Records", desc: "Admins see real MongoDB-backed patient data instead of demo placeholders." },
  { icon: Search, title: "Care Discovery", desc: "Doctor search and scheduling flows stay available for the patient journey." },
  { icon: Heart, title: "Emergency Logging", desc: "Urgent messages create trackable emergency records for the operations team." },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: index * 0.08, duration: 0.45, ease: "easeOut" as const },
  }),
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-40 border-b bg-card/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-hero shadow-glow">
              <Heart className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-display text-lg font-bold text-foreground">Medicare Excellence</p>
              <p className="text-xs text-muted-foreground">AI-powered healthcare operations</p>
            </div>
          </Link>
          <div className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <span>Patients</span>
            <span>Admins</span>
            <span>MongoDB Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden px-4 pb-20 pt-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_hsl(var(--accent))_0%,_transparent_45%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-8">
            <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
              <span className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground">
                <Star className="h-3.5 w-3.5" />
                Production-ready healthcare MVP
              </span>
            </motion.div>

            <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={1} className="space-y-4">
              <h1 className="max-w-3xl font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                One platform for patient care conversations and admin-grade healthcare visibility.
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground">
                Medicare Excellence combines AI chat, role-based routing, emergency tracking, and a real MongoDB
                operations dashboard in a single startup-ready workflow.
              </p>
            </motion.div>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={2}
              className="flex flex-col gap-4 sm:flex-row"
            >
              <Button variant="hero" size="xl" asChild>
                <Link to="/signup">
                  Create an account <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="hero-outline" size="xl" asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            </motion.div>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={3}
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            >
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-border/60 bg-card/80 p-4 shadow-card backdrop-blur">
                  <p className="font-display text-2xl font-bold text-gradient">{stat.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={4}
            className="rounded-[28px] border border-border/60 bg-card/90 p-6 shadow-elevated backdrop-blur"
          >
            <div className="grid gap-4">
              <div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-accent">
                    <Brain className="h-6 w-6 text-sidebar-primary" />
                  </div>
                  <div>
                    <p className="font-display text-lg font-semibold">Patient Workspace</p>
                    <p className="text-sm text-sidebar-foreground/70">Persistent AI chat and personal history</p>
                  </div>
                </div>
                <div className="rounded-xl bg-sidebar-accent/80 p-4 text-sm">
                  “I have chest pain and dizziness.”
                  <div className="mt-3 rounded-lg bg-sidebar/70 p-3 text-sidebar-foreground/80">
                    Emergency recorded. Please seek immediate in-person care.
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                    <Stethoscope className="h-6 w-6 text-secondary" />
                  </div>
                  <div>
                    <p className="font-display text-lg font-semibold text-foreground">Admin Workspace</p>
                    <p className="text-sm text-muted-foreground">Live stats, patient records, and emergency oversight</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Patients", value: "Mongo live" },
                    { label: "Emergencies", value: "Tracked" },
                    { label: "Chats", value: "Saved" },
                    { label: "Access", value: "Role-based" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-muted/60 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                      <p className="mt-2 font-display text-lg font-semibold text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold text-foreground">Built for both sides of care delivery</h2>
            <p className="mt-3 text-muted-foreground">
              The same product serves patients with conversational support and gives clinicians an operational view of
              real care activity.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={index}
                className="rounded-2xl border border-border/60 bg-card p-6 shadow-card transition-transform hover:-translate-y-1 hover:shadow-elevated"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      <SupportFab />
    </div>
  );
}
