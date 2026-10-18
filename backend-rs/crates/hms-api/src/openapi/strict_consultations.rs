//! Preserve serde's closed tagged variants in the generated consultation schema.
use utoipa::openapi::{
    schema::{AdditionalProperties, Schema},
    OpenApi, RefOr,
};
use utoipa::Modify;

pub(super) struct StrictConsultationSchemas;

impl Modify for StrictConsultationSchemas {
    fn modify(&self, openapi: &mut OpenApi) {
        let Some(components) = openapi.components.as_mut() else {
            return;
        };
        // utoipa 5.5 derives each tagged object from variant attributes rather
        // than inheriting the enum container's deny_unknown_fields. Retain all
        // derived fields and references while closing only these strict enums.
        for name in [
            "ReferralConsultationSource",
            "ReferralConsultationVisitChoice",
        ] {
            let Some(RefOr::T(Schema::OneOf(schema))) = components.schemas.get_mut(name) else {
                continue;
            };
            for variant in &mut schema.items {
                if let RefOr::T(Schema::Object(object)) = variant {
                    object.additional_properties =
                        Some(Box::new(AdditionalProperties::FreeForm(false)));
                }
            }
        }
    }
}
