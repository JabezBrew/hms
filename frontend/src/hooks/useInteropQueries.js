import { useMutation } from "@tanstack/react-query";
import { interopApi } from '@/shared/api/interop';

export function useCreateRecordExport() {
  // No cache invalidation: export creation returns an on-demand transfer payload and is not backed by a cached export list.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (payload) => interopApi.createExport(payload),
  });
}

export function useRetrieveRecordExport() {
  // No cache invalidation: retrieving an export returns the requested record payload without mutating cached data.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (payload) => interopApi.retrieveExport(payload),
  });
}
