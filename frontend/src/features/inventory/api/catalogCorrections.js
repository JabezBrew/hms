import { z } from 'zod';
import { v2Api } from '@/lib/api/v2/client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

export const catalogToday = () => new Date().toISOString().slice(0, 10);

const catalogText = z.string().trim().min(1, 'This field is required.').refine(
  (value) => [...value].length <= 120,
  'Use 120 characters or fewer.',
);

export const catalogCorrectionSchema = z.object({
  code: catalogText,
  name: catalogText,
  unit: catalogText,
  effective_from: z.string().refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Choose a valid effective date.').refine(
    (value) => value <= catalogToday(),
    'Choose today or an earlier date. Future catalog activation is not available.',
  ),
  reason: catalogText,
});

export async function applyCatalogCorrection(itemId, data, options = {}) {
  if (!isRustV2ApiMode()) throw new Error('Catalog corrections require the current inventory service.');
  if (!itemId) throw new Error('An inventory item is required.');
  const parsed = catalogCorrectionSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  try {
    const response = await v2Api.postInventoryCatalogEdit(
      { item_id: itemId, ...parsed.data },
      { signal: options.signal },
    );
    if (!response?.data?.id) throw new Error('Saved catalog version was not returned.');
    return response?.data;
  } catch (error) {
    const failure = new Error(handleV2ApiError(error, 'The catalog correction could not be saved.'));
    failure.status = error?.status;
    if (!error?.status || error.status >= 500) {
      failure.code = 'catalog_correction_unconfirmed';
      failure.message = 'The save could not be confirmed. Close this dialog and refresh the item before trying again.';
    }
    throw failure;
  }
}
