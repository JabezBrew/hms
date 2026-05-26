import { appointmentsApi } from '@/lib/api/appointments'

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
export const previewSlots = (data) => appointmentsApi.previewSlots(data)
