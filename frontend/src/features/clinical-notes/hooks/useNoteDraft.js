import { useState } from 'react';
export function useNoteDraft(initial = null) {
  const [source, setSource] = useState(null);
  const [form, setForm] = useState(() => initial || { title: '', note_type: 'doctor_note', body: '' });
  const [revision, setRevision] = useState(null); const [templatesOpen, setTemplatesOpen] = useState(false); const [reason, setReason] = useState('');
  const [review, setReview] = useState(null); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState(null);
  const start = (current, copy = false) => { setSource(copy ? null : current); setForm({ title: current.title, note_type: current.note_type, body: current.body }); setRevision(current.template_revision); setReason(''); setReview(null); setConfirmed(false); setError(null); };
  return { source, form, setForm, revision, setRevision, templatesOpen, setTemplatesOpen, reason, setReason, review, setReview, confirmed, setConfirmed, error, setError, start };
}
