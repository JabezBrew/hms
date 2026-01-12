import { useMutation } from "@tanstack/react-query";
import { interopApi } from "@/lib/api/interop";

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
