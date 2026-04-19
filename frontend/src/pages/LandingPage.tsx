import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  AudioLines,
  Building2,
  BrainCircuit,
  CalendarCheck2,
  Heart,
  HeartPulse,
  ShieldPlus,
  ShieldCheck,
  Siren,
  Stethoscope,
  Waves,
} from "lucide-react";
import { Link } from "react-router-dom";

import SupportFab from "@/components/SupportFab";
import { Button } from "@/components/ui/button";

const workflowCards = [
  {
    title: "AI Intake",
    text: "Patients speak, type, or upload records. The assistant structures symptoms, urgency, and follow-up instantly.",
    icon: BrainCircuit,
  },
  {
    title: "Clinician Routing",
    text: "Appointments and alerts move toward the right specialty so doctors receive clinically relevant demand.",
    icon: Stethoscope,
  },
  {
    title: "Hospital Visibility",
    text: "Operations teams see triage, approvals, escalations, workload, and record continuity in one place.",
    icon: Activity,
  },
];

const highlights = [
  { label: "Triage-aware", value: "Risk engine" },
  { label: "Multilingual", value: "Voice support" },
  { label: "Appointment-linked", value: "Clinical records" },
  { label: "Recovery-ready", value: "Email auth" },
];

const marqueeItems = [
  "Emergency triage stream",
  "Specialist-matched appointments",
  "Doctor approval control",
  "Live consultation records",
  "Patient history continuity",
  "Multilingual care assistant",
  "Vitals and document linking",
  "Hospital operations analytics",
];

const commandStats = [
  { label: "Monitoring now", value: "214", icon: HeartPulse },
  { label: "Doctors online", value: "32", icon: Stethoscope },
  { label: "Escalations flagged", value: "06", icon: Siren },
  { label: "Admin approvals", value: "04", icon: ShieldPlus },
];

const capabilityBands = [
  {
    eyebrow: "Patient intake flow",
    title: "Structured conversations that feel calm, guided, and clinically useful.",
    text: "The assistant does not dump theory. It captures symptoms, urgency, medication context, and appointment intent in a format hospitals can actually use.",
  },
  {
    eyebrow: "Clinician orchestration",
    title: "Doctor-specific handoff instead of generic booking chaos.",
    text: "Relevant doctors see relevant patients, appointment requests, vitals, records, and follow-up context in one linked chain.",
  },
  {
    eyebrow: "Operations oversight",
    title: "A hospital command layer that keeps leadership in sync.",
    text: "Admins can approve doctors, monitor escalations, understand care flow, and review workload without losing the patient narrative.",
  },
];

const navSections = [
  { id: "hero", label: "Overview" },
  { id: "operations", label: "Operations" },
  { id: "workflow-story", label: "Workflow" },
];

export default function LandingPage() {
  return (
    <div className="cinematic-mesh relative min-h-screen overflow-x-hidden">
      <div className="aurora-rings pointer-events-none absolute inset-0 opacity-70" />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-20" />
      <div className="hero-orb pointer-events-none left-[8%] top-[10%] h-32 w-32" />
      <div className="hero-orb pointer-events-none right-[9%] top-[14%] h-44 w-44" />
      <div className="hero-orb pointer-events-none bottom-[7%] left-[22%] h-40 w-40" />

      <motion.nav
        initial={{ y: -28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55 }}
        className="sticky top-0 z-30 h-16 border-b border-white/80 bg-white/85 backdrop-blur-2xl"
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-hero shadow-glow">
              <Heart className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="font-display text-lg font-bold text-foreground">Medicare Excellence</p>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Digital care coordination</p>
            </div>
          </Link>

          <div className="hidden items-center gap-3 text-sm lg:flex">
            {navSections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-full px-4 py-2 text-muted-foreground transition hover:bg-white/70 hover:text-foreground"
              >
                {section.label}
              </a>
            ))}
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
      </motion.nav>

      <section id="hero" className="relative z-10 scroll-mt-20 px-4 pb-10 pt-6">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <motion.div className="min-w-0 space-y-6 pt-2">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.26em] text-muted-foreground backdrop-blur-xl"
            >
              <Waves className="h-3.5 w-3.5 text-primary" />
              Hospital Command Experience
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <h1 className="max-w-4xl font-display text-4xl font-semibold leading-[0.94] tracking-[-0.055em] text-foreground sm:text-[4rem] xl:text-[4.35rem]">
                A premium digital front door for real hospital operations.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                Medicare Excellence combines patient intake, doctor routing, appointment orchestration, clinical
                records, escalation handling, and hospital oversight in one fluid care platform built for daily use.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 }}
              className="flex flex-col gap-4 sm:flex-row"
            >
              <Button variant="hero" size="xl" asChild>
                <Link to="/signup">
                  Create account <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="hero-outline" size="xl" asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="grid min-w-0 gap-3 sm:grid-cols-2"
            >
              {highlights.map((item) => (
                <motion.div
                  key={item.label}
                  whileHover={{ y: -6, scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                  className="depth-card min-w-0 rounded-[1.35rem] border border-white/75 p-3.5"
                >
                  <p className="truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
                  <p className="mt-2 font-display text-lg font-semibold text-foreground">{item.value}</p>
                </motion.div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="rounded-[1.4rem] border border-white/70 bg-white/45 px-4 py-3 backdrop-blur-xl"
            >
              <div className="flex flex-wrap items-center gap-2">
                {marqueeItems.slice(0, 6).map((item) => (
                  <div key={item} className="rounded-full border border-white/75 bg-white/75 px-4 py-1.5 text-xs font-medium text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.6 }}
            className="glass-panel beam-border relative min-w-0 overflow-hidden rounded-[2rem] p-4"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.18),_transparent_36%),radial-gradient(circle_at_bottom_left,_rgba(45,212,191,0.16),_transparent_34%)]" />
            <div className="relative space-y-4">
              <div className="panel-3d-dark rounded-[1.6rem] p-5 text-sidebar-foreground">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-accent">
                      <AudioLines className="h-5 w-5 text-sidebar-primary" />
                    </div>
                    <div>
                      <p className="font-display text-lg font-semibold">AI Intake Console</p>
                      <p className="text-sm text-sidebar-foreground/70">Voice, chat, documents, and urgency handling</p>
                    </div>
                  </div>
                  <div className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-medium text-emerald-200">
                    Live
                  </div>
                </div>
                <div className="space-y-3 rounded-2xl bg-sidebar-accent/80 p-4 text-sm leading-6">
                  <div className="rounded-xl bg-sidebar/70 p-3">
                    Patient reports sudden headache, blurred vision, and dizziness.
                  </div>
                  <div className="rounded-xl bg-sidebar/70 p-3">
                    Neurology suggested. Follow-up questions asked. Appointment path prepared.
                  </div>
                  <div className="rounded-xl bg-rose-400/15 p-3 text-rose-100">
                    Critical pattern would trigger escalation and notify the hospital workspace.
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="depth-card rounded-[1.5rem] border border-white/80 p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <CalendarCheck2 className="h-5 w-5 text-primary" />
                    <p className="font-display text-lg font-semibold text-foreground">Appointments</p>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Specialist-aware booking connects patients to the right doctor and keeps the visit lifecycle linked.
                  </p>
                </div>
                <div className="depth-card rounded-[1.5rem] border border-white/80 p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <Siren className="h-5 w-5 text-primary" />
                    <p className="font-display text-lg font-semibold text-foreground">Escalations</p>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Triage alerts, emergency review, and doctor/admin notifications are visible in one operational flow.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {commandStats.map((item, index) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.28 + index * 0.06 }}
                    whileHover={{ y: -4 }}
                    className="metric-card relative overflow-hidden rounded-[1.4rem] border border-white/80 p-4"
                  >
                    <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                      <span className="pulse-dot" />
                      Live
                    </div>
                    <item.icon className="h-5 w-5 text-primary" />
                    <p className="mt-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 font-display text-3xl font-semibold text-foreground">{item.value}</p>
                  </motion.div>
                ))}
              </div>

            </div>
          </motion.div>
        </div>
      </section>

      <div className="section-divider relative z-10 mx-auto mb-10 mt-2 max-w-7xl" />

      <section id="operations" className="relative z-10 scroll-mt-20 px-4 pb-20">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-6 grid gap-4 rounded-[2rem] border border-white/75 bg-white/55 p-5 backdrop-blur-2xl lg:grid-cols-3"
          >
            <div className="rounded-[1.4rem] border border-white/80 bg-white/85 px-5 py-4 shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
              <div className="mb-3 flex items-center gap-2 text-sm text-slate-700">
                <Building2 className="h-4 w-4 text-primary" />
                Hospital control layer
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                One workspace for patient intake, clinician routing, approvals, alerts, and consultation continuity.
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/80 bg-white/80 px-5 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-slate-700">
                <HeartPulse className="h-4 w-4 text-rose-500" />
                Care flow
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Patient symptom {"->"} AI triage {"->"} doctor match {"->"} appointment {"->"} clinician record {"->"} admin visibility.
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/80 bg-white/80 px-5 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-slate-700">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Operational trust
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Doctor approval, password recovery, persistent records, and role-based access keep the workflow controlled.
              </p>
            </div>
          </motion.div>

          <div className="grid gap-6 lg:grid-cols-3">
            {workflowCards.map((card, index) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                whileHover={{ y: -8 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08, duration: 0.42 }}
                className="depth-card rounded-[1.8rem] border border-white/75 p-6"
              >
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-card">
                  <card.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-display text-xl font-semibold text-foreground">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{card.text}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-8 rounded-[2rem] border border-white/70 bg-white/55 px-6 py-5 backdrop-blur-2xl">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-display text-2xl font-semibold text-foreground">Built for modern clinical operations</p>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-muted-foreground">
                  Email verification, password recovery, role-based access, AI-guided intake, and specialist-aware
                  workflows make the platform feel closer to a deployable healthcare product than a basic chatbot demo.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="hero-outline" asChild>
                  <Link to="/forgot-password">Account recovery</Link>
                </Button>
                <Button variant="hero" asChild>
                  <Link to="/signup">Start now</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="section-divider relative z-10 mx-auto mb-10 mt-2 max-w-7xl" />

      <section id="workflow-story" className="relative z-10 scroll-mt-20 px-4 pb-20">
        <div className="mx-auto max-w-7xl space-y-6">
          {capabilityBands.map((band, index) => (
            <motion.div
              key={band.title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.55, delay: index * 0.08 }}
              className="capability-strip grid gap-6 rounded-[2.2rem] border border-white/75 p-6 md:grid-cols-[0.34fr_0.66fr] md:p-8"
            >
              <div className="space-y-3">
                <div className="inline-flex rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
                  {band.eyebrow}
                </div>
                <div className="h-1 w-16 rounded-full bg-gradient-hero" />
              </div>
              <div className="space-y-3">
                <h3 className="max-w-3xl font-display text-3xl font-semibold leading-tight tracking-[-0.04em] text-foreground md:text-[2.35rem]">
                  {band.title}
                </h3>
                <p className="max-w-3xl text-base leading-8 text-muted-foreground md:text-lg">{band.text}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>
      <SupportFab />
    </div>
  );
}
