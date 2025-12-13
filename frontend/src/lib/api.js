/**
 * API wrapper for the frontend
 * Provides simplified access to the API services
 */
import { appointmentsApi, patientsApi, wardsApi } from './api/index';
import { staffApi } from './api/staff';
import { admissionsApi } from './api/admissions';
import { encountersApi } from './api/encounters';
import { apiClient } from './api-client';

export { apiClient };

// Appointment API functions
export const fetchAppointments = (params) => appointmentsApi.getAppointments(params);
export const fetchAppointment = (id) => appointmentsApi.getAppointment(id);
export const createAppointment = (data) => appointmentsApi.createAppointment(data);
export const updateAppointment = (id, data) => appointmentsApi.updateAppointment(id, data);
export const deleteAppointment = (id) => appointmentsApi.deleteAppointment(id);
export const fetchAvailableSlots = (params) => appointmentsApi.getAvailableSlots(params);
export const updateAppointmentStatus = (id, status) => appointmentsApi.updateAppointmentStatus(id, status);
export const checkInAppointment = (id) => appointmentsApi.checkInAppointment(id);
export const cancelAppointment = (id, reason) => appointmentsApi.cancelAppointment(id, reason);

// Schedule Template API functions
export const fetchScheduleTemplates = (params) => appointmentsApi.getScheduleTemplates(params);
export const fetchScheduleTemplate = (id) => appointmentsApi.getScheduleTemplate(id);
export const createScheduleTemplate = (data) => appointmentsApi.createScheduleTemplate(data);
export const updateScheduleTemplate = (id, data) => appointmentsApi.updateScheduleTemplate(id, data);
export const deleteScheduleTemplate = (id) => appointmentsApi.deleteScheduleTemplate(id);
export const generateSchedule = (id, data) => appointmentsApi.generateSchedule(id, data);

// Recurring Schedule API functions
export const fetchRecurringSchedules = (params) => appointmentsApi.getRecurringSchedules(params);
export const fetchRecurringSchedule = (id) => appointmentsApi.getRecurringSchedule(id);
export const createRecurringSchedule = (data) => appointmentsApi.createRecurringSchedule(data);
export const updateRecurringSchedule = (id, data) => appointmentsApi.updateRecurringSchedule(id, data);
export const deleteRecurringSchedule = (id) => appointmentsApi.deleteRecurringSchedule(id);
export const previewSlots = (data) => appointmentsApi.previewSlots(data);
export const batchGenerateSlots = (days = 14) => appointmentsApi.batchGenerateSlots({ days });

// Blocked Time API functions
export const fetchBlockedTimes = (params) => appointmentsApi.getBlockedTimes(params);
export const createBlockedTime = (data) => appointmentsApi.createBlockedTime(data);
export const bulkCreateBlockedTime = (data) => appointmentsApi.bulkCreateBlockedTime(data);
export const updateBlockedTime = (id, data) => appointmentsApi.updateBlockedTime(id, data);
export const deleteBlockedTime = (id) => appointmentsApi.deleteBlockedTime(id);

// Time Slot API functions
export const fetchTimeSlots = (templateId) => appointmentsApi.getTimeSlots(templateId);
export const createTimeSlot = (data) => appointmentsApi.createTimeSlot(data);
export const updateTimeSlot = (id, data) => appointmentsApi.updateTimeSlot(id, data);
export const deleteTimeSlot = (id) => appointmentsApi.deleteTimeSlot(id);

// Patient API functions
export const fetchPatients = (params) => patientsApi.getPatients(params);
export const fetchPatient = (id) => patientsApi.getPatient(id);
export const createPatient = (data) => patientsApi.createPatient(data);
export const updatePatient = (id, data) => patientsApi.updatePatient(id, data);
export const deletePatient = (id) => patientsApi.deletePatient(id);
export const searchPatients = (query) => patientsApi.searchPatients(query);
export const fetchRecentPatients = () => patientsApi.getRecentPatients();

// Practitioner API functions
export const fetchPractitioners = (params) => staffApi.getPractitioners(params);
export const fetchPractitioner = (id) => staffApi.getPractitioner(id);
export const searchPractitioners = (query, doctorsOnly = false) => staffApi.searchPractitioners(query, doctorsOnly);

// Appointment type API functions
export const fetchAppointmentTypes = () => appointmentsApi.getAppointmentTypes();
export const fetchAppointmentType = (id) => appointmentsApi.getAppointmentType(id);
export const createAppointmentType = (data) => appointmentsApi.createAppointmentType(data);
export const updateAppointmentType = (id, data) => appointmentsApi.updateAppointmentType(id, data);
export const deleteAppointmentType = (id) => appointmentsApi.deleteAppointmentType(id);

// lib/api.js (add to existing file)

// Fetch all generated schedules
export const fetchSchedules = async (params) => {
  try {
    return await appointmentsApi.getScheduleMappings(params);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    throw error;
  }
};

// Fetch slots for a specific schedule
export const fetchScheduleSlots = async (scheduleId, params = {}) => {
  try {
    return await appointmentsApi.getScheduleSlots(scheduleId, params);
  } catch (error) {
    console.error('Error fetching schedule slots:', error);
    throw error;
  }
};

// Cancel a schedule
export const cancelSchedule = async (mappingId) => {
  try {
    return await appointmentsApi.cancelScheduleMapping(mappingId);
  } catch (error) {
    console.error('Error cancelling schedule:', error);
    throw error;
  }
};

/**
 * Get upcoming appointments for notifications
 * @returns {Promise<Array>} List of upcoming appointments
 */
export const fetchUpcomingAppointments = async () => {
  try {
    // Get user from localStorage
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      return [];
    }

    const user = JSON.parse(userJson);

    // If user is an admin, don't show any notifications
    if (user.role === 'admin') {
      return [];
    }

    // Get today's date
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];

    // Get appointments for today and future dates
    const params = {
      date: `ge ${formattedDate}`,
      status: 'booked',
      _sort: 'start',
      _limit: 5
    };

    const response = await fetchAppointments(params);

    // Process appointments for notifications
    if (response && response.entry) {
      return response.entry
        .filter(entry => entry.resource && entry.resource.resourceType === 'Appointment')
        .map(entry => {
          const appointment = entry.resource;

          // Get patient name
          const patientParticipant = appointment.participant?.find(p =>
            p.actor?.reference?.startsWith('Patient/'));
          const patientName = patientParticipant?.actor?.display || 'Unknown Patient';

          // Format start time
          let startTime = 'Unknown time';
          try {
            if (appointment.start) {
              const date = new Date(appointment.start);
              startTime = date.toLocaleString();
            }
          } catch (error) {
            console.error('Error parsing appointment date:', error);
          }

          return {
            id: appointment.id,
            patientName,
            startTime,
            status: appointment.status,
            type: appointment.appointmentType?.coding?.[0]?.display || 'General'
          };
        });
    }

    return [];
  } catch (error) {
    console.error('Error fetching upcoming appointments:', error);
    return [];
  }
};

// Ward API functions
export const fetchWardsRoot = () => wardsApi.getWardsRoot();
export const fetchWards = (params) => wardsApi.getWards(params);
export const fetchWard = (id) => wardsApi.getWard(id);
export const createWard = (data) => wardsApi.createWard(data);
export const updateWard = (id, data) => wardsApi.updateWard(id, data);
export const deleteWard = (id) => wardsApi.deleteWard(id);

// Bed API functions
export const fetchBeds = (params) => wardsApi.getBeds(params);
export const fetchBed = (id) => wardsApi.getBed(id);
export const createBed = (data) => wardsApi.createBed(data);
export const updateBed = (id, data) => wardsApi.updateBed(id, data);
export const deleteBed = (id) => wardsApi.deleteBed(id);

// Admission API functions
export const fetchAdmissions = (params) => admissionsApi.getAdmissions(params);
export const fetchAdmission = (id) => admissionsApi.getAdmission(id);
export const createAdmission = (data) => admissionsApi.createAdmission(data);
export const updateAdmission = (id, data) => admissionsApi.updateAdmission(id, data);
export const dischargePatient = (id, data) => admissionsApi.dischargePatient(id, data);
export const searchPatientsForAdmission = (query) => admissionsApi.searchPatients(query);
export const searchPractitionersForAdmission = (query, doctorsOnly = true) => admissionsApi.searchPractitioners(query, doctorsOnly);

// Transfer API functions
export const fetchTransfers = (params) => wardsApi.getTransfers(params);
export const createTransfer = (data) => wardsApi.createTransfer(data);

// Allocation logs API functions
export const fetchAllocationLogs = (params) => wardsApi.getAllocationLogs(params);

// Encounter API functions
export const fetchEncounters = (params) => encountersApi.getEncounters(params);
export const fetchEncounter = (id) => encountersApi.getEncounter(id);
export const createEncounter = (data) => encountersApi.createEncounter(data);
export const updateEncounter = (id, data) => encountersApi.updateEncounter(id, data);
export const deleteEncounter = (id) => encountersApi.deleteEncounter(id);
export const dischargeEncounter = (id, data) => encountersApi.dischargePatient(id, data);
export const cancelEncounter = (id) => encountersApi.cancelEncounter(id);
export const searchPatientsForEncounter = (query) => encountersApi.searchPatients(query);
export const searchPractitionersForEncounter = (query, doctorsOnly = false) => encountersApi.searchPractitioners(query, doctorsOnly);
