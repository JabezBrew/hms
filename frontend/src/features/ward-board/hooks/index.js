import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createKeyFactory } from '@/shared/lib/queryKeys';
import { wardBoardApi } from '@/features/ward-board/api';

const baseKeys = createKeyFactory('ward-board');

export const wardBoardKeys = {
  ...baseKeys,
  board: (filters) => [...baseKeys.lists(), { filters }],
  patients: () => [...baseKeys.all, 'patients'],
  patient: (patientId) => [...baseKeys.all, 'patients', patientId],
};

export function useWardBoard(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardBoardKeys.board(filters),
    queryFn: ({ signal }) => wardBoardApi.getBoard(filters, { signal }),
    staleTime: 15 * 1000,
    placeholderData: (previousData) => previousData,
    ...options,
  });
}

export function useWardBoardPatient(patientId, options = {}) {
  return useQuery({
    queryKey: wardBoardKeys.patient(patientId),
    queryFn: ({ signal }) => wardBoardApi.getPatient(patientId, { signal }),
    enabled: Boolean(patientId),
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useWardBoardTaskAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, action, payload }) =>
      wardBoardApi.runTaskAction({ taskId, action, payload }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: wardBoardKeys.lists() });
      if (variables?.patientId) {
        queryClient.invalidateQueries({
          queryKey: wardBoardKeys.patient(variables.patientId),
        });
      }
    },
  });
}
