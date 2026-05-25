import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { referralsApi } from '../referrals';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 referrals bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({
      getAccessToken: () => 'access-token-123',
      getFacilityCode: () => 'HMS',
    });
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('loads referral inbox and sent views through Rust /api/v2 envelopes', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'referral-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-MAIN-2026-000001',
                patient_display_name: 'Ama Mensah',
                to_service: 'Medicine',
                priority: 'urgent',
                status: 'sent',
                reason: 'Medical review',
                sla_due_at: '2026-05-13T08:00:00Z',
                created_at: '2026-05-12T08:00:00Z',
                updated_at: '2026-05-12T08:00:00Z',
              },
            ],
            page: { limit: 50, has_next: false, next_cursor: null },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [],
            page: { limit: 50, has_next: false, next_cursor: null },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const inbox = await referralsApi.getReferralInbox();
    const sent = await referralsApi.getReferralsSent();

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/referrals?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/referrals?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(inbox).toEqual({
      referrals: [
        expect.objectContaining({
          id: 'referral-1',
          patient: 'patient-1',
          patient_name: 'Ama Mensah',
          patient_mrn: 'MRN-MAIN-2026-000001',
          referred_to_department: 'Medicine',
          urgency: 'urgent',
          status: 'pending',
          reason: 'Medical review',
          referral_number: expect.stringMatching(/^V2-REF-/),
        }),
      ],
    });
    expect(sent).toEqual({ referrals: [] });
  });

  it('loads pending referrals through a Rust status filter instead of filtering a broad page', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'referral-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-1',
              patient_display_name: 'Ama Mensah',
              to_service: 'Medicine',
              priority: 'urgent',
              status: 'sent',
              reason: 'Review',
              sla_due_at: '2026-05-13T08:00:00Z',
              created_at: '2026-05-12T08:00:00Z',
              updated_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 50, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const pending = await referralsApi.getPendingReferrals();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/referrals?limit=50&status=sent',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(pending).toEqual([
      expect.objectContaining({
        id: 'referral-1',
        status: 'pending',
        v2_status: 'sent',
      }),
    ]);
  });

  it('creates, accepts, declines, and completes referrals through Rust /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'referral-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-1',
              patient_display_name: 'Ama Mensah',
              to_service: 'Medicine',
              priority: 'urgent',
              status: 'sent',
              reason: 'Review',
              sla_due_at: '2026-05-13T08:00:00Z',
              created_at: '2026-05-12T08:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: 'referral-1', status: 'accepted', acceptance_notes: 'Accepted' },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: 'referral-2', status: 'declined', decline_reason: 'Wrong service' },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'referral-1',
              status: 'completed',
              specialist_notes: 'Reviewed',
              recommendations: 'Follow up',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    await referralsApi.createReferral({
      patient: 'patient-1',
      referred_to_department: 'Medicine',
      urgency: 'urgent',
      reason: 'Review',
    });
    await referralsApi.acceptReferral('referral-1', 'Accepted');
    await referralsApi.declineReferral('referral-2', 'Wrong service');
    await referralsApi.completeReferral('referral-1', 'Reviewed', 'Follow up');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/referrals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patient_id: 'patient-1',
          to_service: 'Medicine',
          priority: 'urgent',
          reason: 'Review',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/referrals/referral-1/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ acceptance_notes: 'Accepted' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/referrals/referral-2/decline',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decline_reason: 'Wrong service' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/referrals/referral-1/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          specialist_notes: 'Reviewed',
          recommendations: 'Follow up',
        }),
      }),
    );
  });

  it('schedules referrals through Rust appointment contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'referral-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-1',
            patient_display_name: 'Ama Mensah',
            to_service: 'Medicine',
            priority: 'urgent',
            status: 'scheduled',
            scheduled_appointment_id: 'appointment-1',
            scheduled_at: '2026-05-12T08:00:00Z',
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const scheduled = await referralsApi.scheduleReferral('referral-1', {
      starts_at: '2026-05-20T09:00:00Z',
      ends_at: '2026-05-20T09:30:00Z',
      clinic_session: 'session-1',
      appointment_type: 'type-general',
      clinic: 'clinic-1',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/referrals/referral-1/schedule',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          starts_at: '2026-05-20T09:00:00Z',
          ends_at: '2026-05-20T09:30:00Z',
          session_id: 'session-1',
          service_id: 'type-general',
          clinic_id: 'clinic-1',
        }),
      }),
    );
    expect(scheduled).toEqual(
      expect.objectContaining({
        id: 'referral-1',
        v2_status: 'scheduled',
        scheduled_appointment_id: 'appointment-1',
      }),
    );
  });

  it('threads AbortSignal through Rust referral and waitlist mutation calls', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'referral-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-1',
          patient_display_name: 'Ama Mensah',
          to_service: 'Medicine',
          priority: 'urgent',
          status: 'sent',
          reason: 'Review',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'referral-1', status: 'accepted' }, meta: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'referral-2', status: 'declined' }, meta: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'referral-1', status: 'completed' }, meta: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'wait-1', status: 'waiting' }, meta: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'wait-1', status: 'offered' }, meta: {} }));

    await referralsApi.createReferral({
      patient: 'patient-1',
      referred_to_department: 'Medicine',
      urgency: 'urgent',
      reason: 'Review',
    }, { signal });
    await referralsApi.acceptReferral('referral-1', 'Accepted', { signal });
    await referralsApi.declineReferral('referral-2', 'Wrong service', { signal });
    await referralsApi.completeReferral('referral-1', 'Reviewed', 'Follow up', { signal });
    await referralsApi.createClinicWaitlistEntry({
      patient: 'patient-1',
      service: 'Medicine',
      priority: 'routine',
    }, { signal });
    await referralsApi.offerNextClinicWaitlistEntry({ service: 'Medicine' }, { signal });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/referrals', 'POST', signal],
      ['http://localhost:8080/api/v2/referrals/referral-1/accept', 'POST', signal],
      ['http://localhost:8080/api/v2/referrals/referral-2/decline', 'POST', signal],
      ['http://localhost:8080/api/v2/referrals/referral-1/complete', 'POST', signal],
      ['http://localhost:8080/api/v2/referrals/clinic-waitlist', 'POST', signal],
      ['http://localhost:8080/api/v2/referrals/clinic-waitlist/offer-next', 'POST', signal],
    ]);
  });

  it('loads, promotes, and cancels clinic waitlist entries through Rust /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'wait-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-1',
                patient_display_name: 'Ama Mensah',
                service: 'Medicine',
                priority: 'routine',
                status: 'waiting',
                created_at: '2026-05-12T08:00:00Z',
              },
            ],
            page: { limit: 50, has_next: false, next_cursor: null },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'wait-2', status: 'waiting' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'wait-1', status: 'offered' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wait-1',
              status: 'promoted',
              scheduled_appointment_id: 'appointment-1',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'wait-2',
              status: 'cancelled',
              cancellation_reason: 'Patient unavailable',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const waitlist = await referralsApi.getClinicWaitlist({ page_size: 50 });
    await referralsApi.createClinicWaitlistEntry({
      patient: 'patient-2',
      service: 'Medicine',
      priority: 'urgent',
    });
    await referralsApi.offerNextClinicWaitlistEntry({ service: 'Medicine' });
    const promoted = await referralsApi.promoteClinicWaitlistEntry('wait-1', {
      starts_at: '2026-05-21T10:00:00Z',
      ends_at: '2026-05-21T10:30:00Z',
      session_id: 'session-2',
      service_id: 'type-general',
      clinic_id: 'clinic-1',
    });
    const cancelled = await referralsApi.cancelClinicWaitlistEntry('wait-2', {
      reason: 'Patient unavailable',
    });

    expect(waitlist).toEqual([
      expect.objectContaining({
        id: 'wait-1',
        patient: 'patient-1',
        patient_name: 'Ama Mensah',
        service: 'Medicine',
        priority: 'routine',
        status: 'waiting',
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/referrals/clinic-waitlist?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/referrals/clinic-waitlist',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patient_id: 'patient-2',
          service: 'Medicine',
          priority: 'urgent',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/referrals/clinic-waitlist/offer-next',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ service: 'Medicine' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/referrals/clinic-waitlist/wait-1/promote',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          starts_at: '2026-05-21T10:00:00Z',
          ends_at: '2026-05-21T10:30:00Z',
          session_id: 'session-2',
          service_id: 'type-general',
          clinic_id: 'clinic-1',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'http://localhost:8080/api/v2/referrals/clinic-waitlist/wait-2/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Patient unavailable' }),
      }),
    );
    expect(promoted).toEqual(
      expect.objectContaining({
        id: 'wait-1',
        status: 'promoted',
        scheduled_appointment_id: 'appointment-1',
      }),
    );
    expect(cancelled).toEqual(
      expect.objectContaining({
        id: 'wait-2',
        status: 'cancelled',
        cancellation_reason: 'Patient unavailable',
      }),
    );
  });

  it('preserves AbortError from Rust referral list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      referralsApi.getReferrals({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('preserves AbortError from Rust referral detail and waitlist reads', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError);

    await expect(
      referralsApi.getReferral('referral-1', { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
    await expect(
      referralsApi.getClinicWaitlist({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('routes referral notification reads and mark-read through bounded Rust notifications', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'notification-1',
                notification_type: 'referral.submitted',
                title: 'Referral REF-001',
                body: 'Medicine review requested',
                priority: 'high',
                read_at: null,
                created_at: '2026-05-12T08:00:00Z',
              },
              {
                id: 'notification-2',
                notification_type: 'dashboard',
                title: 'Dashboard ready',
                body: 'Operational snapshot refreshed',
                priority: 'normal',
                read_at: null,
                created_at: '2026-05-12T09:00:00Z',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'notification-1',
                notification_type: 'referral.submitted',
                title: 'Referral REF-001',
                body: 'Medicine review requested',
                priority: 'high',
                read_at: null,
                created_at: '2026-05-12T08:00:00Z',
              },
            ],
            page: { limit: 100, has_next: false, next_cursor: null },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'notification-1',
              notification_type: 'referral.submitted',
              title: 'Referral REF-001',
              body: 'Medicine review requested',
              priority: 'high',
              read_at: '2026-05-12T09:30:00Z',
              created_at: '2026-05-12T08:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const notifications = await referralsApi.getNotifications(
      { page_size: 20 },
      { signal: new AbortController().signal },
    );
    const count = await referralsApi.getUnreadNotificationCount({
      signal: new AbortController().signal,
    });
    const marked = await referralsApi.markNotificationRead('notification-1', {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/notifications?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/notifications?limit=100&unread_only=true',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/notifications/notification-1/read',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ read: true }),
      }),
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        id: 'notification-1',
        event: 'submitted',
        referral_number: 'Referral REF-001',
        referred_to_department: 'Medicine review requested',
        urgency: 'urgent',
        is_read: false,
      }),
    ]);
    expect(count).toBe(1);
    expect(marked).toEqual(expect.objectContaining({
      id: 'notification-1',
      is_read: true,
    }));
  });

  it('preserves AbortError from Rust referral page queries without logging API errors', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError);

    try {
      await expect(
        referralsApi.getReferralInbox({ signal: new AbortController().signal }),
      ).rejects.toBe(abortError);
      await expect(
        referralsApi.getReferralsSent({ signal: new AbortController().signal }),
      ).rejects.toBe(abortError);
      await expect(
        referralsApi.getReferralSlaDashboard({ signal: new AbortController().signal }),
      ).rejects.toBe(abortError);
      await expect(
        referralsApi.getClinicWaitlistSummary({ signal: new AbortController().signal }),
      ).rejects.toBe(abortError);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
