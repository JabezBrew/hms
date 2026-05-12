use hms_domain::auth::{AuthUser, PatientDataVisibility};
use hms_domain::deployment::PermissionCode;
use hms_domain::patients::PatientRecord;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AccessError {
    #[error("missing permission")]
    MissingPermission,
    #[error("patient access denied")]
    PatientAccessDenied,
}

pub fn require_permission(user: &AuthUser, permission: PermissionCode) -> Result<(), AccessError> {
    if user.permissions.contains(&permission) {
        Ok(())
    } else {
        Err(AccessError::MissingPermission)
    }
}

pub fn require_patient_demographics_access(
    user: &AuthUser,
    patient: &PatientRecord,
) -> Result<(), AccessError> {
    require_permission(user, PermissionCode::PatientDemographicsView)?;

    if user.facility_id != patient.facility_id {
        return Err(AccessError::PatientAccessDenied);
    }

    if user
        .patient_visibility
        .contains(&PatientDataVisibility::Demographics)
    {
        Ok(())
    } else {
        Err(AccessError::PatientAccessDenied)
    }
}

pub fn can_create_patient(user: &AuthUser, facility_id: Uuid) -> Result<(), AccessError> {
    require_permission(user, PermissionCode::PatientCreate)?;

    if user.facility_id == facility_id {
        Ok(())
    } else {
        Err(AccessError::MissingPermission)
    }
}

pub fn can_update_patient(user: &AuthUser, patient: &PatientRecord) -> Result<(), AccessError> {
    require_patient_demographics_access(user, patient)?;
    require_permission(user, PermissionCode::PatientUpdate)
}
