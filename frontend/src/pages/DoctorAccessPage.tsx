import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ShieldPlus, XCircle } from "lucide-react";

import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { approveAccessRequest, ApiError, getAccessRequests, rejectAccessRequest } from "@/lib/api";
import { useLiveAlertNotifications } from "@/hooks/useLiveAlertNotifications";
import { useToast } from "@/hooks/use-toast";

function specialtyLabel(value?: string) {
  return (value || "general_medicine").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export default function DoctorAccessPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const requestsQuery = useQuery({
    queryKey: ["doctor-access-requests"],
    queryFn: () => getAccessRequests(token || ""),
    enabled: Boolean(token),
    refetchInterval: 8000,
    refetchIntervalInBackground: true,
  });

  useLiveAlertNotifications({
    token: token || "",
    queryKey: ["hospital-admin-alerts", "doctor-access-page"],
    audienceLabel: "Doctor access",
  });

  const approveMutation = useMutation({
    mutationFn: (requestId: string) => approveAccessRequest(token || "", requestId),
    onSuccess: async () => {
      await requestsQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["hospital-admin-alerts"] });
      toast({
        title: "Doctor access approved",
        description: "The doctor can now sign in and start receiving patient appointments.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to approve doctor",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (requestId: string) => rejectAccessRequest(token || "", requestId),
    onSuccess: async () => {
      await requestsQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["hospital-admin-alerts"] });
      toast({
        title: "Access request rejected",
        description: "The doctor request has been closed.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Unable to reject request",
        description: error instanceof ApiError ? error.message : "Please try again.",
      });
    },
  });

  const requests = requestsQuery.data?.requests || [];
  const pending = requests.filter((entry) => entry.status === "pending");
  const approved = requests.filter((entry) => entry.status === "approved");
  const rejected = requests.filter((entry) => entry.status === "rejected");
  const error = requestsQuery.error;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">Doctor Access Control</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Review doctor access requests, approve hospital specialists, and keep clinician sign-in controlled by the admin team.
            </p>
          </div>
          <Badge variant="secondary">{pending.length} pending</Badge>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof ApiError ? error.message : "Unable to load doctor access requests right now."}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: "Pending Requests", value: pending.length, icon: ShieldPlus },
            { label: "Approved Doctors", value: approved.length, icon: CheckCircle2 },
            { label: "Rejected Requests", value: rejected.length, icon: XCircle },
          ].map((item) => (
            <Card key={item.label} className="border-border/60 bg-card/95 shadow-card">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-display text-2xl font-bold text-foreground">{item.value}</p>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-border/60 bg-card/95 shadow-elevated">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-lg">Pending Doctor Requests</CardTitle>
            <Badge variant={pending.length > 0 ? "secondary" : "outline"}>{pending.length} requests</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {pending.length === 0 && (
              <p className="text-sm text-muted-foreground">No pending doctor access requests right now.</p>
            )}

            {pending.map((request) => (
              <div key={request.id} className="rounded-2xl border border-border/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{request.name}</p>
                    <p className="text-sm text-muted-foreground">{request.email}</p>
                  </div>
                  <Badge variant="outline">{specialtyLabel(request.specialty)}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Requested role: Doctor · Submitted from the public signup page</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="hero" onClick={() => approveMutation.mutate(request.id)} disabled={approveMutation.isPending}>
                    Approve access
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rejectMutation.mutate(request.id)} disabled={rejectMutation.isPending}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/95 shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-lg">Processed Requests</CardTitle>
            <Badge variant="outline">{approved.length + rejected.length} total</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {[...approved, ...rejected].slice(0, 8).map((request) => (
              <div key={request.id} className="rounded-2xl border border-border/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{request.name}</p>
                    <p className="text-sm text-muted-foreground">{request.email}</p>
                  </div>
                  <Badge variant={request.status === "approved" ? "secondary" : "outline"}>{request.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {specialtyLabel(request.specialty)} {request.doctor_code ? `· ${request.doctor_code}` : ""}
                  {request.approved_by_name ? ` · reviewed by ${request.approved_by_name}` : ""}
                </p>
              </div>
            ))}
            {approved.length + rejected.length === 0 && (
              <p className="text-sm text-muted-foreground">Processed requests will appear here after the admin reviews them.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
