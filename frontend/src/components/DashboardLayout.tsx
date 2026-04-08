import {
  BarChart3,
  Building2,
  Calendar,
  Heart,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Users,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { NavLink } from "@/components/NavLink";
import SupportFab from "@/components/SupportFab";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

const patientNavItems = [
  { title: "Patient Dashboard", url: "/patient", icon: LayoutDashboard },
  { title: "Appointments", url: "/appointments", icon: Calendar },
  { title: "Find Doctors", url: "/doctors", icon: Users },
];

const doctorNavItems = [
  { title: "Doctor Dashboard", url: "/doctor", icon: Shield },
];

const hospitalAdminNavItems = [
  { title: "Hospital Dashboard", url: "/admin", icon: Shield },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
];

function getSpecialtyLabel(specialty?: string | null) {
  const normalized = (specialty || "").toLowerCase();
  if (normalized === "cardiology") return "Cardiology";
  if (normalized === "pulmonology") return "Pulmonology";
  if (normalized === "neurology") return "Neurology";
  if (normalized === "endocrinology") return "Endocrinology";
  if (normalized === "general_medicine") return "General Medicine";
  if (normalized === "operations") return "Operations";
  return "";
}

function getNavItems(role: string | null | undefined) {
  if (role === "doctor") {
    return doctorNavItems;
  }
  if (role === "hospital_admin") {
    return hospitalAdminNavItems;
  }
  return patientNavItems;
}

function getRoleLabel(role: string | null | undefined) {
  if (role === "doctor") {
    return "Doctor";
  }
  if (role === "hospital_admin") {
    return "Hospital Admin";
  }
  return "Patient";
}

function getWorkspaceLabel(role: string | null | undefined) {
  if (role === "doctor") {
    return "Assigned care queue";
  }
  if (role === "hospital_admin") {
    return "Operations console";
  }
  return "Patient care hub";
}

function AppSidebarContent() {
  const { state } = useSidebar();
  const { role, user } = useAuth();
  const location = useLocation();
  const collapsed = state === "collapsed";
  const navItems = getNavItems(role);
  const specialtyLabel = getSpecialtyLabel(user?.specialty);

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <div className="flex items-center gap-3 border-b border-sidebar-border/40 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-hero shadow-glow">
          <Heart className="h-4 w-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div>
            <p className="font-display text-sm font-bold text-sidebar-foreground">Medicare Excellence</p>
            <p className="text-xs text-sidebar-foreground/60">{getWorkspaceLabel(role)}</p>
          </div>
        )}
      </div>
      <SidebarContent>
        {!collapsed && (
          <div className="mx-3 mt-4 rounded-2xl border border-sidebar-border/40 bg-sidebar-accent/60 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary/10">
                <Building2 className="h-4 w-4 text-sidebar-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-sidebar-foreground">Hospital Workspace</p>
                <p className="text-xs text-sidebar-foreground/60">
                  {specialtyLabel ? `${specialtyLabel} desk active` : "Live hospital operations"}
                </p>
              </div>
            </div>
          </div>
        )}
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location.pathname === item.url}>
                    <NavLink to={item.url} end activeClassName="bg-sidebar-accent text-sidebar-primary">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { logout, role, user } = useAuth();
  const specialtyLabel = getSpecialtyLabel(user?.specialty);

  return (
    <SidebarProvider className="min-h-svh bg-[radial-gradient(circle_at_top_right,_hsl(var(--accent))_0%,_transparent_34%),radial-gradient(circle_at_top_left,_rgba(15,118,110,0.08)_0%,_transparent_25%),linear-gradient(180deg,_hsl(var(--background))_0%,_hsl(var(--muted))_100%)]">
      <AppSidebarContent />
      <SidebarInset className="min-h-svh bg-transparent">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-card/92 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger>
            <Menu className="h-5 w-5" />
          </SidebarTrigger>
          <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-muted-foreground md:inline-flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Hospital systems online
          </div>
          <div className="flex-1" />
          <Badge variant={role === "patient" ? "default" : "secondary"} className="hidden sm:inline-flex">
            {getRoleLabel(role)}
          </Badge>
          {specialtyLabel && (
            <Badge variant="outline" className="hidden lg:inline-flex">
              {specialtyLabel}
            </Badge>
          )}
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-foreground">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Home</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>
        <SupportFab />
      </SidebarInset>
    </SidebarProvider>
  );
}
