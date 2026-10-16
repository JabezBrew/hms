import { useState } from 'react';
import { useFluidWrite } from './hooks';
import { emptyFluidValues, valuesPayload } from './model';
/** Lives above the dialog portal so a closed panel retains an uncertain command. */
export function useCreateObservation(admissionId, patientId, onSaved, { canCreate = true, canRetry = true } = {}) {
  const [form, setForm] = useState(emptyFluidValues); const [key, setKey] = useState(() => crypto.randomUUID()); const [validation, setValidation] = useState(null); const write = useFluidWrite('create', patientId);
  const locked = write.busy || write.unknown || Boolean(write.saved);
  const submit = async () => {
    if (write.busy || write.saved || (write.unknown ? !canRetry : !canCreate)) return;
    try {
      const saved = write.unknown ? await write.submit() : await write.submit({ client_request_id: key, patient_id: patientId, admission_case_id: admissionId, values: valuesPayload(form) });
      setValidation(null); if (saved) { try { await onSaved?.(); } catch { /* A callback cannot undo persistence. */ } }
    } catch (error) { setValidation(error.message); }
  };
  const another = () => { if (!write.saved) return; write.reset(); setForm(emptyFluidValues()); setKey(crypto.randomUUID()); setValidation(null); };
  return { form, setForm, validation, write, locked, submit, another };
}
