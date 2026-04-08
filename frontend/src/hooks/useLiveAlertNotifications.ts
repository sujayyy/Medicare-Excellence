import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAlerts } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { AlertRecord } from "@/types/api";

const severityRank: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function sortAlerts(left: AlertRecord, right: AlertRecord) {
  return (
    (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0) ||
    new Date(right.updated_at || right.created_at || 0).getTime() -
      new Date(left.updated_at || left.created_at || 0).getTime()
  );
}

export function useLiveAlertNotifications({
  token,
  queryKey,
  audienceLabel,
}: {
  token: string;
  queryKey: string[];
  audienceLabel: string;
}) {
  const { toast } = useToast();
  const seenAlertsRef = useRef<Set<string>>(new Set());

  const alertsQuery = useQuery({
    queryKey,
    queryFn: () => getAlerts(token),
    enabled: Boolean(token),
    refetchInterval: 8000,
    refetchIntervalInBackground: true,
  });

  const alerts = alertsQuery.data?.alerts || [];

  useEffect(() => {
    const openAlertIds = new Set(alerts.filter((alert) => alert.status === "open").map((alert) => alert.id));

    if (seenAlertsRef.current.size === 0) {
      seenAlertsRef.current = openAlertIds;
      return;
    }

    const unseenAlerts = alerts
      .filter((alert) => alert.status === "open" && !seenAlertsRef.current.has(alert.id))
      .sort(sortAlerts);

    if (unseenAlerts.length > 0) {
      const newestAlert = unseenAlerts[0];
      toast({
        variant: newestAlert.severity === "critical" || newestAlert.severity === "high" ? "destructive" : "default",
        title: `${audienceLabel} notification`,
        description: `${newestAlert.title}: ${newestAlert.patient_name || "Patient"} needs review.`,
      });
    }

    seenAlertsRef.current = openAlertIds;
  }, [alerts, audienceLabel, toast]);

  const liveAlert = useMemo(() => {
    return [...alerts].filter((alert) => alert.status === "open").sort(sortAlerts)[0] || null;
  }, [alerts]);

  return {
    alertsQuery,
    alerts,
    liveAlert,
  };
}
