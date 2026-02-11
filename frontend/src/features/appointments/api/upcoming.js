import { getAuthJSON } from '@/lib/auth-storage'
import { apiClient, handleApiError } from '@/lib/api-client'

export const fetchUpcomingAppointments = async () => {
  const user = getAuthJSON('user')
  if (!user || user.role === 'admin') {
    return []
  }

  const formattedDate = new Date().toISOString().split('T')[0]
  const queryString = new URLSearchParams({
    date: `ge ${formattedDate}`,
    status: 'booked',
    _sort: 'start',
    _limit: '5',
  }).toString()

  try {
    const response = await apiClient.get(`/appointments/appointments/?${queryString}`)
    if (!response?.entry) {
      return []
    }

    return response.entry.reduce((acc, entry) => {
      if (!entry.resource || entry.resource.resourceType !== 'Appointment') {
        return acc
      }

      const appointment = entry.resource
      const patientParticipant = appointment.participant?.find((participant) =>
        participant.actor?.reference?.startsWith('Patient/')
      )
      const patientName = patientParticipant?.actor?.display || 'Unknown Patient'

      let startTime = 'Unknown time'
      if (appointment.start) {
        const parsedDate = new Date(appointment.start)
        if (!Number.isNaN(parsedDate.getTime())) {
          startTime = parsedDate.toLocaleString()
        }
      }

      acc.push({
        id: appointment.id,
        patientName,
        startTime,
        startDateTime: appointment.start || null,
        status: appointment.status,
        type: appointment.appointmentType?.coding?.[0]?.display || 'General',
      })

      return acc
    }, [])
  } catch (error) {
    // Keep notifications resilient and silent in degraded network states.
    handleApiError(error, 'Failed to fetch upcoming appointments')
    return []
  }
}
