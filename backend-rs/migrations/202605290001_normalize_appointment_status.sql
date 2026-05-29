UPDATE appointments
SET status = 'completed',
    updated_at = now()
WHERE status = 'fulfilled';
