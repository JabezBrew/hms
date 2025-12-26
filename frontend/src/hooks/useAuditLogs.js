import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Fetch audit logs with pagination and filters
 */
const fetchAuditLogs = async (filters = {}, page = 1, pageSize = 20) => {
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

  // Use getWithPagination to get full response including count, next, previous
  return apiClient.getWithPagination(`/admin/audit-logs/?${params.toString()}`);
};

/**
 * Fetch audit log statistics
 */
const fetchAuditStats = async () => {
  return apiClient.get('/admin/audit-logs/stats/');
};

/**
 * Fetch available filter options
 */
const fetchFilterOptions = async () => {
  return apiClient.get('/admin/audit-logs/filters/');
};

/**
 * Hook for fetching audit logs with pagination
 */
export function useAuditLogs(filters = {}, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['audit-logs', filters, page, pageSize],
    queryFn: () => fetchAuditLogs(filters, page, pageSize),
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook for fetching audit log statistics
 */
export function useAuditStats() {
  return useQuery({
    queryKey: ['audit-stats'],
    queryFn: fetchAuditStats,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook for fetching filter options
 */
export function useAuditFilters() {
  return useQuery({
    queryKey: ['audit-filters'],
    queryFn: fetchFilterOptions,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Export audit logs to CSV
 */
export async function exportAuditLogs(filters = {}) {
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
