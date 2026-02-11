import { apiClient } from '@/lib/api-client'

export const systemApi = {
  getDeploymentCapabilities: () => apiClient.get('/settings/deployment-capabilities/'),
}
