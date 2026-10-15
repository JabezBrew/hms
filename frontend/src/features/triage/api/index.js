export { visitsApi, triageApi } from '@/lib/api/visits'

import { v2Api } from '@/lib/api/v2/client'
import { handleV2ApiError } from '@/lib/api/v2/errors'

// The clinical staff directory is available to nursing workflows; the admin
// practitioner endpoint requires staff-administration permission.
export const triageAssignmentApi = {
  listStaff: async ({ cursor, signal } = {}) => {
    try {
      const response = await v2Api.getStaffDirectory({
        query: { limit: 50, cursor },
        signal,
      })
      return {
        results: Array.isArray(response?.data) ? response.data : [],
        next_cursor: response?.page?.has_next ? response.page.next_cursor : null,
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new Error(handleV2ApiError(error, 'Failed to load staff for triage assignment'))
    }
  },
}
