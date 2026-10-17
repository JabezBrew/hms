import { referralResponseManualReview } from '@/lib/api/v2/writeUncertainty';

// This fixed family selector crosses only the existing lazy referral gateway.
// Its consultation protocol independently verifies current, stamped evidence.
export const consultationManualReview = (action, input) => referralResponseManualReview(action, input, 'consultation');
