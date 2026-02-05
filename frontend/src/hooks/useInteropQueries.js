import { useMutation } from "@tanstack/react-query";
import { interopApi } from '@/shared/api/interop';

export function useCreateRecordExport() {
  return useMutation({
    mutationFn: (payload) => interopApi.createExport(payload),
  });
}

export function useRetrieveRecordExport() {
  return useMutation({
    mutationFn: (payload) => interopApi.retrieveExport(payload),
  });
}
