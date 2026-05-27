import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { encounterKeys } from "@/features/encounters/hooks/useEncounterQueries";
import { patientsApi } from "@/features/patients/api";
import { patientKeys } from "@/features/patients/hooks/usePatientQueries";
import { timelineKeys } from "@/hooks/useTimelineQueries";

const BREAK_GLASS_ROLES = new Set(['admin', 'doctor', 'nurse']);

export function useChronicleBreakGlassAccess({
  patient,
  patientId,
  isLoading,
  refetchContext,
  refetchEncounters,
  refetchPatient,
  refetchTimeline,
  rustV2Mode,
  startupError,
  user,
}) {
  const queryClient = useQueryClient();
  const [isBreakGlassOpen, setBreakGlassOpen] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassExpiresAt, setBreakGlassExpiresAt] = useState(null);

  const userRole = user?.role || user?.user_type;
  const canRequestBreakGlass = !rustV2Mode && BREAK_GLASS_ROLES.has(userRole);
  const accessDenied = rustV2Mode
    ? !isLoading && startupError?.status === 403
    : patient && !isLoading && patient?.access?.clinical === false;

  const breakGlassMutation = useMutation({
    mutationFn: (payload) => patientsApi.requestBreakGlass(patientId, payload),
    onSuccess: (data) => {
      const expiresAt = data?.break_glass?.expires_at || null;
      setBreakGlassExpiresAt(expiresAt);
      setBreakGlassReason('');
      setBreakGlassOpen(false);

      const expiresLabel = expiresAt
        ? new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;
      toast.success("Break-glass access granted", {
        description: expiresLabel ? `Access expires at ${expiresLabel}.` : "Access expires automatically.",
      });

      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      queryClient.invalidateQueries({ queryKey: patientKeys.chronicleStartup(patientId) });
      queryClient.invalidateQueries({ queryKey: timelineKeys.list(patientId) });
      queryClient.invalidateQueries({ queryKey: encounterKeys.forPatient(patientId) });
      refetchPatient?.();
      refetchContext?.();
      refetchTimeline?.();
      refetchEncounters?.();
    },
    onError: (err) => {
      toast.error("Break-glass request failed", {
        description: err?.message || "Please try again.",
      });
    },
  });

  const submitBreakGlass = useCallback(() => {
    if (rustV2Mode) {
      toast.error('Break-glass access is not available in Rust V2 mode.');
      return;
    }

    const reason = breakGlassReason.trim();
    if (!reason) {
      return;
    }
    breakGlassMutation.mutate({
      reason,
      scope: 'clinical',
    });
  }, [breakGlassMutation, breakGlassReason, rustV2Mode]);

  return {
    accessDenied,
    breakGlassExpiresAt,
    breakGlassReason,
    canRequestBreakGlass,
    isBreakGlassOpen,
    isSubmittingBreakGlass: breakGlassMutation.isPending,
    setBreakGlassOpen,
    setBreakGlassReason,
    submitBreakGlass,
  };
}
