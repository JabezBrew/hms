import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';
import { keyWith } from '@/shared/lib/queryKeys';

const AUDIT_EXPORT_LIMIT = 100;
const auditCursorCache = new Map();

const ACTION_FILTERS = [
  { value: 'CREATE', label: 'Create' },
  { value: 'READ', label: 'Read' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'ADMISSION', label: 'Admission' },
  { value: 'DISCHARGE', label: 'Discharge' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'CANCEL', label: 'Cancel' },
];

const CATEGORY_FILTERS = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'AUTHENTICATION', label: 'Auth' },
  { value: 'PATIENT', label: 'Patient' },
  { value: 'CLINICAL', label: 'Clinical' },
  { value: 'ENCOUNTER', label: 'Encounter' },
  { value: 'WARD', label: 'Ward' },
  { value: 'APPOINTMENT', label: 'Appointment' },
  { value: 'LABORATORY', label: 'Lab' },
  { value: 'BILLING', label: 'Billing' },
  { value: 'PHARMACY', label: 'Pharmacy' },
  { value: 'NURSING', label: 'Nursing' },
  { value: 'REFERRAL', label: 'Referral' },
];

function fingerprintFilters(filters = {}) {
  const stable = Object.keys(filters)
    .sort()
    .map((key) => `${key}:${String(filters[key])}`)
    .join('|');
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash.toString(36);
}

const auditKeys = {
  logs: (filters, page, pageSize) => keyWith('audit-logs', fingerprintFilters(filters), page, pageSize),
  stats: () => keyWith('audit-stats'),
  filters: () => keyWith('audit-filters'),
};

function titleCase(value) {
  return String(value || '')
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function actionFromEventType(eventType) {
  const suffix = String(eventType || '').split('.').filter(Boolean).pop() || 'event';
  const normalized = suffix.toLowerCase();
  if (['created', 'create', 'assigned', 'granted'].includes(normalized)) return 'CREATE';
  if (['read', 'viewed'].includes(normalized)) return 'READ';
  if (['updated', 'update', 'completed', 'approved', 'fulfilled', 'revoked'].includes(normalized)) return 'UPDATE';
  if (['deleted', 'delete', 'removed'].includes(normalized)) return 'DELETE';
  if (['admitted', 'admission'].includes(normalized)) return 'ADMISSION';
  if (['discharged', 'discharge'].includes(normalized)) return 'DISCHARGE';
  if (['transferred', 'transfer'].includes(normalized)) return 'TRANSFER';
  if (['cancelled', 'canceled', 'cancel'].includes(normalized)) return 'CANCEL';
  return normalized.replace(/[^a-z0-9]+/g, '_').toUpperCase();
}

function categoryFromResourceType(resourceType) {
  const resource = String(resourceType || '').toLowerCase();
  if (resource.includes('auth') || resource.includes('session') || resource.includes('password')) return 'AUTHENTICATION';
  if (resource.includes('patient')) return 'PATIENT';
  if (resource.includes('clinical') || resource.includes('note') || resource.includes('prescription') || resource.includes('problem')) return 'CLINICAL';
  if (resource.includes('encounter') || resource.includes('visit')) return 'ENCOUNTER';
  if (resource.includes('ward') || resource.includes('bed') || resource.includes('admission')) return 'WARD';
  if (resource.includes('appointment') || resource.includes('schedule')) return 'APPOINTMENT';
  if (resource.includes('lab') || resource.includes('specimen') || resource.includes('result')) return 'LABORATORY';
  if (resource.includes('billing') || resource.includes('invoice') || resource.includes('payment') || resource.includes('claim')) return 'BILLING';
  if (resource.includes('pharmacy') || resource.includes('dispense') || resource.includes('medication')) return 'PHARMACY';
  if (resource.includes('nursing') || resource.includes('vitals') || resource.includes('handoff')) return 'NURSING';
  if (resource.includes('referral')) return 'REFERRAL';
  return 'ADMIN';
}

function adaptV2AuditEvent(event) {
  const action = actionFromEventType(event.event_type);
  const actionDisplay = titleCase(event.event_type);
  const resourceLabel = event.resource_id
    ? `${event.resource_type} ${event.resource_id}`
    : event.resource_type;
  return {
    id: event.id,
    timestamp: event.occurred_at,
    user_display: event.actor_display_name,
    user_email: null,
    user_agent: null,
    user_agent_summary: null,
    action,
    action_display: actionDisplay,
    category: categoryFromResourceType(event.resource_type),
    resource_type: event.resource_type,
    resource_name: resourceLabel,
    resource_id: event.resource_id,
    description: `${actionDisplay} on ${resourceLabel}`,
    ip_address: null,
    changes: {},
    request_id: event.request_id,
    actor_user_id: event.actor_user_id,
  };
}

function adaptV2AuditList(response, page) {
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2AuditEvent)
    : [];
  const pageInfo = response?.page || {};
  return {
    results,
    count: (page - 1) * Number(pageInfo.limit || results.length || 1) + results.length,
    next: pageInfo.next_cursor || null,
    previous: page > 1 ? 'previous' : null,
    page: pageInfo,
    count_exact: false,
  };
}

function cacheNextAuditCursor(filters, page, cursor) {
  if (!cursor) return;
  const fingerprint = fingerprintFilters(filters);
  auditCursorCache.set(`${fingerprint}:${page + 1}`, cursor);
}

function getAuditCursor(filters, page) {
  if (page <= 1) return undefined;
  return auditCursorCache.get(`${fingerprintFilters(filters)}:${page}`);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function deriveV2AuditStats(response) {
  const events = Array.isArray(response?.data) ? response.data : [];
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  return {
    total_logs: events.length,
    logs_today: events.filter((event) => isSameDay(new Date(event.occurred_at), now)).length,
    logs_this_week: events.filter((event) => new Date(event.occurred_at) >= weekStart).length,
    active_sessions: 0,
  };
}

function auditCsvValue(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadAuditCsv(rows) {
  const headers = ['timestamp', 'actor', 'action', 'category', 'resource_type', 'resource_id', 'request_id'];
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => auditCsvValue(row[header])).join(',')),
  ];
  const url = window.URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * Fetch audit logs with pagination and filters
 */
const fetchAuditLogs = async (filters = {}, page = 1, pageSize = 35, options = {}) => {
  if (isRustV2ApiMode()) {
    const cursor = getAuditCursor(filters, page);
    const limit = Math.min(Number(pageSize) || 35, 100);
    const query = {
      cursor,
      limit,
    };
    if (filters.search) query.search = filters.search;
    if (filters.category && filters.category !== 'all') query.category = filters.category;
    if (filters.action && filters.action !== 'all') query.action = filters.action;
    if (filters.start_date) query.start_date = filters.start_date;
    if (filters.end_date) query.end_date = filters.end_date;
    const response = await v2Api.getAdminAuditEvents({
      query,
      signal: options.signal,
    });
    cacheNextAuditCursor(filters, page, response?.page?.next_cursor);
    return adaptV2AuditList(response, page);
  }

  const params = new URLSearchParams();
  params.append('page', page);
  params.append('page_size', pageSize);

  // Add filters
  if (filters.category) params.append('category', filters.category);
  if (filters.action) params.append('action', filters.action);
  if (filters.user_id) params.append('user_id', filters.user_id);
  if (filters.resource_type) params.append('resource_type', filters.resource_type);
  if (filters.start_date) params.append('start_date', filters.start_date);
  if (filters.end_date) params.append('end_date', filters.end_date);
  if (filters.search) params.append('search', filters.search);
  if (filters.ordering) params.append('ordering', filters.ordering);

  // Use getWithPagination to get full response including count, next, previous
  return apiClient.getWithPagination(`/admin/audit-logs/?${params.toString()}`, { signal: options.signal });
};

/**
 * Fetch audit log statistics
 */
const fetchAuditStats = async (options = {}) => {
  if (isRustV2ApiMode()) {
    const response = await v2Api.getAdminAuditEvents({
      query: {
        limit: AUDIT_EXPORT_LIMIT,
      },
      signal: options.signal,
    });
    return deriveV2AuditStats(response);
  }
  return apiClient.get('/admin/audit-logs/stats/');
};

/**
 * Fetch available filter options
 */
const fetchFilterOptions = async () => {
  if (isRustV2ApiMode()) {
    return {
      categories: CATEGORY_FILTERS,
      actions: ACTION_FILTERS,
    };
  }
  return apiClient.get('/admin/audit-logs/filters/');
};

/**
 * Hook for fetching audit logs with pagination
 */
export function useAuditLogs(filters = {}, page = 1, pageSize = 35) {
  return useQuery({
    queryKey: auditKeys.logs(filters, page, pageSize),
    queryFn: ({ signal }) => fetchAuditLogs(filters, page, pageSize, { signal }),
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook for fetching audit log statistics
 */
export function useAuditStats() {
  return useQuery({
    queryKey: auditKeys.stats(),
    queryFn: ({ signal }) => fetchAuditStats({ signal }),
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook for fetching filter options
 */
export function useAuditFilters() {
  return useQuery({
    queryKey: auditKeys.filters(),
    queryFn: fetchFilterOptions,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Export audit logs to CSV
 */
export async function exportAuditLogs(filters = {}) {
  if (isRustV2ApiMode()) {
    try {
      const response = await v2Api.getAdminAuditEvents({
        query: {
          limit: AUDIT_EXPORT_LIMIT,
        },
      });
      const rows = (Array.isArray(response?.data) ? response.data : []).map((event) => {
        const adapted = adaptV2AuditEvent(event);
        return {
          timestamp: adapted.timestamp,
          actor: adapted.user_display || '',
          action: adapted.action_display,
          category: adapted.category,
          resource_type: adapted.resource_type,
          resource_id: adapted.resource_id || '',
          request_id: adapted.request_id || '',
        };
      });
      downloadAuditCsv(rows);
      return;
    } catch (error) {
      throw new Error(handleV2ApiError(error, 'Failed to export audit logs'));
    }
  }

  const params = new URLSearchParams();

  if (filters.category) params.append('category', filters.category);
  if (filters.action) params.append('action', filters.action);
  if (filters.user_id) params.append('user_id', filters.user_id);
  if (filters.resource_type) params.append('resource_type', filters.resource_type);
  if (filters.start_date) params.append('start_date', filters.start_date);
  if (filters.end_date) params.append('end_date', filters.end_date);
  if (filters.search) params.append('search', filters.search);

  const data = await apiClient.get(`/admin/audit-logs/export/?${params.toString()}`, {
    responseType: 'blob',
  });

  // Create download link
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export const __auditLogTestInternals = {
  fetchAuditLogs,
};
