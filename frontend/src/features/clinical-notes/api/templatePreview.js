import { v2Api } from '@/lib/api/v2/client';
import { confirmedPreview, previewInput } from '../templatePreviewModel';

export async function previewNoteTemplate(input, { signal } = {}) {
  const payload = previewInput(input);
  const response = await v2Api.previewClinicalNoteTemplate({ patient_id: input.patientId }, payload, { signal });
  return { preview: confirmedPreview(response?.data, { patientId: input.patientId, revision: input.revision, payload }), payload };
}
