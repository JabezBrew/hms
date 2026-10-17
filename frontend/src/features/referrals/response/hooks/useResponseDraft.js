import { useState } from 'react';
// Clinical drafts live above the portal and only in this mounted scope.
export function useResponseDraft() {
  const [source, setSource] = useState(null); const [notes, setNotes] = useState(''); const [recommendations, setRecommendations] = useState(''); const [reason, setReason] = useState(''); const [review, setReview] = useState(null);
  const begin = current => { setSource(structuredClone(current)); setNotes(current.response?.specialist_notes ?? ''); setRecommendations(current.response?.recommendations ?? ''); setReason(''); setReview(null); };
  const reset = () => { setSource(null); setNotes(''); setRecommendations(''); setReason(''); setReview(null); };
  return { source, setSource, notes, setNotes, recommendations, setRecommendations, reason, setReason, review, setReview, begin, reset };
}
