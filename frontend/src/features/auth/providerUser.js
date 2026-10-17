export function providerUser(response, defaultFacilityCode) {
  return { email: response.user.email, id: response.user.id, role: response.user.user_type, firstName: response.user.first_name, lastName: response.user.last_name,
    staffId: response.user.staff_id || null, practitionerId: response.user.practitioner_id || null, facilityCode: response.user.facility_code || defaultFacilityCode,
    adminAccess: response.user.admin_access || null, accessContext: response.access_context || null,
    passwordChangeRequired: Boolean(response.password_change_required ?? response.user.must_change_password) };
}
