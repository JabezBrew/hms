import { useState } from 'react';

export function useCourseDraft() {
  const [form, setForm] = useState({ reason: '', scheduled_before: '', note: '' }); const [review, setReview] = useState(null); const [confirmed, setConfirmed] = useState(false); const [validation, setValidation] = useState(null);
  const reset = () => { setForm({ reason: '', scheduled_before: '', note: '' }); setReview(null); setConfirmed(false); setValidation(null); };
  return { form, setForm, review, setReview, confirmed, setConfirmed, validation, setValidation, reset };
}
