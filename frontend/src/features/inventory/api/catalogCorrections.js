import { z } from 'zod';
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

// Compatibility entry is deliberately closed: its UUID-less body cannot be
// upgraded by stripping fields, inventing a request id or bypassing review.
export async function applyCatalogCorrection() {
  if (!isRustV2ApiMode()) throw new Error('Catalog corrections require the current inventory service.');
  throw new Error('Open catalog administration to review the current exact revision and submit a governed dated correction. No change was submitted.');
}
