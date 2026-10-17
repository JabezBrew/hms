import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { contextEvidence, courseDetail, courseDose, courseHeader, coursePage, supplyWindow } from './contracts';
import { courseReceipt } from './receipts';

const params = ({ patientId, caseId, courseId }) => ({ patient_id: patientId, admission_case_id: caseId, ...(courseId ? { course_id: courseId } : {}) });
export class TreatmentWriteUnconfirmedError extends Error {
  constructor() { super('This admission-course change may already be saved. Keep the reviewed request unchanged and check its original result.'); this.name = 'TreatmentWriteUnconfirmedError'; }
}
export const treatmentApi = {
  async context(scope, { signal } = {}) { return contextEvidence((await v2Api.getPatientChronicleMedicationCoursesContext(params(scope), { signal }))?.data, scope); },
  async list(scope, query = {}, { signal } = {}) { return coursePage(await v2Api.getPatientChronicleMedicationCourses(params(scope), { query, signal }), (row) => { courseHeader(row, scope); for (const key of ['status', 'source_status', 'kind']) if (query[key] && row[key] !== query[key]) throw new Error('The filtered medication courses could not be confirmed.'); }, query); },
  async detail(scope, { signal } = {}) { return courseDetail((await v2Api.getPatientChronicleMedicationCourse(params(scope), { signal }))?.data, scope, scope.courseId); },
  async doses(scope, query = {}, { signal } = {}) { return coursePage(await v2Api.getPatientChronicleMedicationCourseDoses(params(scope), { query, signal }), (row) => { courseDose(row); if ((query.status && row.status !== query.status) || (typeof query.is_dispensed === 'boolean' && row.is_dispensed !== query.is_dispensed) || (query.scheduled_from && Date.parse(row.scheduled_at) < Date.parse(query.scheduled_from)) || (query.scheduled_before && Date.parse(row.scheduled_at) >= Date.parse(query.scheduled_before)) || (query.request_id && !row.original_request_membership)) throw new Error('The filtered dose evidence could not be confirmed.'); }, query); },
  async supply(scope, query = {}, { signal } = {}) { return coursePage(await v2Api.getPatientChronicleMedicationCourseSupply(params(scope), { query, signal }), (row) => { supplyWindow(row); if (['status', 'kind'].some((key) => query[key] && row[key] !== query[key])) throw new Error('The filtered supply history could not be confirmed.'); }, query); },
  async write(command, { signal } = {}) {
    let response;
    try {
      const operation = command.kind === 'stop' ? 'postPatientChronicleMedicationCourseStop' : 'postPatientChronicleMedicationCourseSupplyWindow';
      response = await v2Api[operation](params({ ...command, courseId: command.source.summary.id }), command.payload, { signal });
      const saved = courseReceipt(response?.data, command); acknowledgeWriteResponse(response); return saved;
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'treatment_course_write_unconfirmed') throw error;
      markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new TreatmentWriteUnconfirmedError(), response || error);
    }
  },
  async recover(command, { signal } = {}) {
    const response = await v2Api.getPatientChronicleMedicationCourseRequest({ ...params({ ...command, courseId: command.source.summary.id }), client_request_id: command.payload.client_request_id }, { signal });
    return courseReceipt(response?.data, command);
  },
};
