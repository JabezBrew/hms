import { appointmentsApi } from './index'
import { getAuthJSON } from '@/lib/auth-storage'

export const fetchAppointment = (id) => appointmentsApi.getAppointment(id)
export const fetchAppointments = (params) => appointmentsApi.getAppointments(params)
export const createAppointment = (data) => appointmentsApi.createAppointment(data)
export const updateAppointment = (id, data) => appointmentsApi.updateAppointment(id, data)
export const deleteAppointment = (id) => appointmentsApi.deleteAppointment(id)
export const fetchAvailableSlots = (params) => appointmentsApi.getAvailableSlots(params)
export const updateAppointmentStatus = (id, status) => appointmentsApi.updateAppointmentStatus(id, status)
export const checkInAppointment = (id) => appointmentsApi.checkInAppointment(id)
export const cancelAppointment = (id, reason) => appointmentsApi.cancelAppointment(id, reason)
export const fetchAppointmentTypes = () => appointmentsApi.getAppointmentTypes()
export const createScheduleTemplate = (data) => appointmentsApi.createScheduleTemplate(data)
export const updateScheduleTemplate = (id, data) => appointmentsApi.updateScheduleTemplate(id, data)
export const generateSchedule = (id, data) => appointmentsApi.generateSchedule(id, data)
export const previewSlots = (data) => appointmentsApi.previewSlots(data)

export const fetchUpcomingAppointments = async () => {
  try {
    const user = getAuthJSON('user')
    if (!user) {
      return []
    }

    if (user.role === 'admin') {
      return []
    }

    const today = new Date()
    const formattedDate = today.toISOString().split('T')[0]

    const params = {
      date: `ge ${formattedDate}`,
      status: 'booked',
      _sort: 'start',
      _limit: 5
    }

    const response = await fetchAppointments(params)

    if (response && response.entry) {
      return response.entry.reduce((acc, entry) => {
        if (!entry.resource || entry.resource.resourceType !== 'Appointment') {
          return acc
        }

        const appointment = entry.resource
        const patientParticipant = appointment.participant?.find(p =>
          p.actor?.reference?.startsWith('Patient/'))
        const patientName = patientParticipant?.actor?.display || 'Unknown Patient'

        let startTime = 'Unknown time'
        try {
          if (appointment.start) {
            const date = new Date(appointment.start)
            startTime = date.toLocaleString()
          }
        } catch (error) {
          console.error('Error parsing appointment date:', error)
        }

        acc.push({
          id: appointment.id,
          patientName,
          startTime,
          status: appointment.status,
          type: appointment.appointmentType?.coding?.[0]?.display || 'General'
        })

        return acc
      }, [])
    }

    return []
  } catch (error) {
    console.error('Error fetching upcoming appointments:', error)
    return []
  }
}
