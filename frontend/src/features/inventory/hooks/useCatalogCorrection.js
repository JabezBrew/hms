import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryKeys } from '@/hooks/useInventoryQueries';
import { applyCatalogCorrection } from '../api/catalogCorrections';

export function useCatalogCorrection() {
  const queryClient = useQueryClient();
  const refreshCatalog = () => {
    // Use server item reads rather than treating a catalog version as an item.
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.items() });
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.locations() });
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.dashboard() });
  };

  return useMutation({
    mutationFn: ({ itemId, data }) => applyCatalogCorrection(itemId, data),
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey: inventoryKeys.items() }),
    onSuccess: refreshCatalog,
    onError: (error) => {
      if (error.code === 'catalog_correction_unconfirmed') refreshCatalog();
    },
  });
}
