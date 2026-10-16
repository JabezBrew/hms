import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { nursingKeys } from '@/hooks/nursing/nursingQueryKeys';
import { getPrnOrdersPage, requestPrnDose } from '../api/prn';

export function usePrnOrders(admissionId) {
  return useInfiniteQuery({
    queryKey: nursingKeys.prnOrders(admissionId, getV2ClientScopeKey()),
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => getPrnOrdersPage(admissionId, pageParam, { signal }),
    getNextPageParam: (lastPage, _pages, _lastParam, params) => {
      const next = lastPage.nextCursor;
      return next && !params.includes(next) ? next : undefined;
    },
    enabled: Boolean(admissionId),
    staleTime: 0,
    refetchInterval: () => document.hidden ? false : 30000,
  });
}

export function useRequestPrnDose() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ signal, ...payload }) => requestPrnDose(payload, { signal }),
    onSettled: async () => {
      await Promise.allSettled([nursingKeys.prnOrdersAll(), nursingKeys.marGridAll(), nursingKeys.medicationAdministrationsAll(), nursingKeys.medicationAdministrationHistoryAll(), nursingKeys.pendingDispensingAll(), nursingKeys.patientMarAll(), nursingKeys.medicationsDueNow(), nursingKeys.patientMonitoringAll()].map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}
