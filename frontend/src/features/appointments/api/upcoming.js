import { getAuthJSON } from '@/lib/auth-storage'
import { apiClient, handleApiError } from '@/lib/api-client'
import { appointmentsApi } from '@/lib/api/appointments'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'

function mapUpcomingAppointment(appointment) {
  let startTime = 'Unknown time'
  const startDateTime = appointment.start || appointment.start_time || appointment.startDateTime || null
  if (startDateTime) {
    const parsedDate = new Date(startDateTime)
    if (!Number.isNaN(parsedDate.getTime())) {
      startTime = parsedDate.toLocaleString()
    }
  }

  return {
    id: appointment.id,
    patientName: appointment.patient_name || appointment.patientName || 'Unknown Patient',
    startTime,
    startDateTime,
    status: appointment.status,
    type: appointment.appointment_type_name || appointment.type || 'General',
  }
}

export const fetchUpcomingAppointments = async (options = {}) => {
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
    if (isRustV2ApiMode()) {
      const response = await appointmentsApi.getAppointments({
        limit: 5,
        signal: options.signal,
      })
      const appointments = Array.isArray(response?.results) ? response.results : []
      return appointments.map(mapUpcomingAppointment)
    }

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
