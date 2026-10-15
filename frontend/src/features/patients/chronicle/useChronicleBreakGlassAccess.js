import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { encounterKeys } from "@/features/encounters/hooks/useEncounterQueries";
import { patientsApi } from "@/features/patients/api";
import { patientKeys } from "@/features/patients/hooks/usePatientQueries";
import { timelineKeys } from "@/hooks/useTimelineQueries";
import { userHasCapability } from '@/shared/lib/access';
import { useRustBreakGlassAccess } from './useRustBreakGlassAccess';

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
  reauthenticate,
  accessSource,
}) {
  const queryClient = useQueryClient();
  const [isBreakGlassOpen, setBreakGlassOpen] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [breakGlassExpiresAt, setBreakGlassExpiresAt] = useState(null);
  useEffect(() => {
    setBreakGlassOpen(false);
    setBreakGlassReason('');
    setBreakGlassExpiresAt(null);
  }, [patientId]);

  const userRole = user?.role || user?.user_type;
  const rustAccess = useRustBreakGlassAccess({ enabled: rustV2Mode, patientId, user, reauthenticate, refetchContext, accessSource });
  const canRequestBreakGlass = rustV2Mode
    ? userHasCapability(user, 'patient.break_glass.invoke')
    : BREAK_GLASS_ROLES.has(userRole);
  const accessDenied = rustV2Mode
    ? rustAccess.blocked || (!isLoading && startupError?.status === 403)
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

  const submitBreakGlass = useCallback(async (payload) => {
    if (rustV2Mode) {
      const granted = await rustAccess.submit(payload);
      if (granted) {
        setBreakGlassReason('');
        setBreakGlassOpen(false);
      }
      return granted;
    }

    const reason = breakGlassReason.trim();
    if (!reason) {
      return;
    }
    breakGlassMutation.mutate({
      reason,
      scope: 'clinical',
    });
  }, [breakGlassMutation, breakGlassReason, rustAccess, rustV2Mode]);

  return {
    accessDenied,
    breakGlassExpiresAt: rustV2Mode ? rustAccess.grant?.expires_at : breakGlassExpiresAt,
    breakGlassReason,
    canRequestBreakGlass,
    isBreakGlassOpen,
    isSubmittingBreakGlass: rustV2Mode ? rustAccess.busy || rustAccess.statusLoading : breakGlassMutation.isPending,
    breakGlassError: rustV2Mode ? rustAccess.error : null,
    breakGlassRefreshError: rustV2Mode && rustAccess.refreshError,
    breakGlassUnconfirmed: rustV2Mode && rustAccess.unconfirmed,
    breakGlassStatusError: rustV2Mode && rustAccess.statusError,
    endBreakGlass: rustAccess.end,
    refreshBreakGlassAccess: rustAccess.refreshAccess,
    setBreakGlassOpen,
    setBreakGlassReason,
    submitBreakGlass,
  };
}
