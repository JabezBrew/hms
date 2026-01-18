from rest_framework import serializers
import random
import string
import datetime
from zoneinfo import ZoneInfo
from .models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from ..users.models import PatientProfile, User
from ..users.serializers import PatientProfileSerializer, UserSerializer, generate_secure_password
from ..fhir_client.client import fhir_client
from apps.mpi.services import resolve_patient_identity, link_patient_to_facility
from hms_backend.tenancy import get_current_facility_code
from apps.core.security import get_user_facility, resolve_object_facility
from apps.core.models import Facility
from django.utils import timezone
from django.db import transaction
from ..fhir_client.utils import (
    create_human_name, create_identifier, create_contact_point,
    create_address, generate_fhir_id
)


def generate_unique_mrn():
    """
    Generate a unique medical record number following a specific pattern.
    Format: HMS-YYYY-NNNNN where YYYY is the current year and NNNNN is a random 5-digit number
    """
    year = datetime.datetime.now().year

    # Try up to 100 times to generate a unique MRN
    for _ in range(100):
        # Generate a random 5-digit number
        random_digits = ''.join(random.choices(string.digits, k=5))

        # Create the MRN in the format HMS-YYYY-NNNNN
        mrn = f"HMS-{year}-{random_digits}"

        # Check if this MRN already exists
        if not PatientProfile.objects.filter(medical_record_number=mrn).exists():
            return mrn

    # If we couldn't generate a unique MRN after 100 attempts, raise an exception
    raise Exception("Unable to generate a unique medical record number after multiple attempts.")


class PatientFHIRMappingSerializer(serializers.ModelSerializer):
    """
    Serializer for the PatientFHIRMapping model.
    """
    patient_profile_details = PatientProfileSerializer(source='patient_profile', read_only=True)

    class Meta:
        model = PatientFHIRMapping
        fields = ['id', 'patient_profile', 'patient_profile_details', 'fhir_patient_id',
                  'fhir_resource_version', 'last_synced', 'is_synced',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'last_synced', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PatientSearchSerializer(serializers.ModelSerializer):
    """
    Serializer for the PatientSearch model.
    """
    user_details = UserSerializer(source='user', read_only=True)

    class Meta:
        model = PatientSearch
        fields = ['id', 'user', 'facility', 'user_details', 'search_query', 'search_date']
        read_only_fields = ['id', 'facility', 'search_date']


class PatientRecentListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for patient data shown in recent cards.
    """
    name = serializers.SerializerMethodField()
    date_of_birth = serializers.DateField(source='user.date_of_birth', read_only=True)
    gender = serializers.CharField(source='user.gender', read_only=True)
    current_ward = serializers.SerializerMethodField()
    admission_status = serializers.SerializerMethodField()
    admission_date = serializers.SerializerMethodField()

    class Meta:
        model = PatientProfile
        fields = [
            'id', 'medical_record_number', 'name', 'date_of_birth', 'gender',
            'current_ward', 'admission_status', 'admission_date'
        ]

    def _get_active_admission(self, obj):
        if hasattr(obj, 'active_admissions_list'):
            active_list = obj.active_admissions_list
            return active_list[0] if active_list else None
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            return next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        return obj.admissions.filter(status__in=['admitted', 'waiting']).first()

    def get_name(self, obj):
        if obj.user:
            return obj.user.get_full_name()
        return None

    def get_current_ward(self, obj):
        admission = self._get_active_admission(obj)
        if not admission:
            return None
        if admission.status == 'waiting':
            return "Waiting List"
        if admission.bed:
            return admission.bed.ward.name
        return "Admitted (No Bed)"

    def get_admission_status(self, obj):
        admission = self._get_active_admission(obj)
        if admission:
            return admission.status
        return None

    def get_admission_date(self, obj):
        admission = self._get_active_admission(obj)
        if admission and admission.admission_date:
            return admission.admission_date.isoformat()
        return None


class RecentPatientListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for recent patient list responses.
    """
    patient_profile_details = PatientRecentListSerializer(source='patient_profile', read_only=True)

    class Meta:
        model = RecentPatient
        fields = ['id', 'patient_profile', 'patient_profile_details', 'access_date']
        read_only_fields = ['id', 'access_date']


class RecentPatientSerializer(serializers.ModelSerializer):
    """
    Serializer for the RecentPatient model.
    """
    user_details = UserSerializer(source='user', read_only=True)
    patient_profile_details = PatientProfileSerializer(source='patient_profile', read_only=True)

    class Meta:
        model = RecentPatient
        fields = ['id', 'user', 'user_details', 'patient_profile', 'patient_profile_details', 'access_date']
        read_only_fields = ['id', 'access_date']


class PatientRegistrationValidationSerializer(serializers.ModelSerializer):
    """
    Serializer for the PatientRegistrationValidation model.
    """
    class Meta:
        model = PatientRegistrationValidation
        fields = ['id', 'field_name', 'validation_regex', 'validation_message',
                  'is_required', 'is_active', 'created_at', 'updated_at',
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PatientNoteSerializer(serializers.ModelSerializer):
    """
    Serializer for the PatientNote model.
    """
    patient_profile_details = PatientProfileSerializer(source='patient_profile', read_only=True)
    created_by_details = UserSerializer(source='created_by', read_only=True)

    class Meta:
        model = PatientNote
        fields = ['id', 'patient_profile', 'patient_profile_details', 'note_text',
                  'is_private', 'created_at', 'updated_at', 'created_by',
                  'created_by_details', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PatientRegistrationSerializer(serializers.Serializer):
    """
    Serializer for patient registration that creates both local and FHIR resources.
    """
    # User fields
    email = serializers.EmailField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    phone_number = serializers.CharField(required=False, allow_blank=True)
    date_of_birth = serializers.DateField()

    # PatientProfile fields
    # medical_record_number is now generated on the backend
    nhis_id = serializers.CharField(required=False, allow_blank=True)
    blood_group = serializers.CharField(required=False, allow_blank=True)
    allergies = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_name = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_relationship = serializers.CharField(required=False, allow_blank=True)

    # Address fields
    address_line1 = serializers.CharField(required=False, allow_blank=True)
    address_line2 = serializers.CharField(required=False, allow_blank=True)
    city = serializers.CharField(required=False, allow_blank=True)
    state = serializers.CharField(required=False, allow_blank=True)
    postal_code = serializers.CharField(required=False, allow_blank=True)
    country = serializers.CharField(required=False, allow_blank=True)

    # Admission/encounter fields (required to attach registration to care context)
    admission_details = serializers.DictField(write_only=True)

    def _get_department_timezone(self, department, facility):
        tz_name = None
        if department:
            tz_name = department.get_effective_timezone()
        if not tz_name and facility:
            tz_name = facility.timezone
        if tz_name:
            try:
                return ZoneInfo(tz_name)
            except Exception:
                pass
        return timezone.get_current_timezone()

    def _resolve_outpatient_clinic(self, facility, department, clinic_id=None):
        from apps.organization.models import Clinic, ClinicSchedule

        now = timezone.now()
        tz = self._get_department_timezone(department, facility)
        local_now = timezone.localtime(now, tz)
        day_of_week = local_now.weekday()
        current_time = local_now.time()

        schedules = ClinicSchedule.objects.filter(
            facility=facility,
            department=department,
            day_of_week=day_of_week,
            is_active=True,
            clinic__is_active=True,
            start_time__lte=current_time,
            end_time__gt=current_time,
        )
        clinic_ids = list(schedules.values_list('clinic_id', flat=True).distinct())

        if clinic_id:
            clinic = Clinic.objects.filter(id=clinic_id, is_active=True).first()
            if not clinic:
                raise serializers.ValidationError({"admission_details": "Selected clinic does not exist."})
            if clinic.facility_id != facility.id:
                raise serializers.ValidationError({"admission_details": "Clinic does not belong to the active facility."})
            if clinic.department_id != department.id:
                raise serializers.ValidationError({"admission_details": "Clinic does not belong to the selected department."})
            if clinic.id not in clinic_ids:
                raise serializers.ValidationError({"admission_details": "Clinic is not scheduled at this time."})
            return clinic

        if len(clinic_ids) == 1:
            return Clinic.objects.get(id=clinic_ids[0])

        if len(clinic_ids) == 0:
            raise serializers.ValidationError({
                "admission_details": "No active clinic schedule found for this department."
            })

        raise serializers.ValidationError({
            "admission_details": "Multiple clinics are scheduled now; clinic_id is required."
        })

    def validate(self, data):
        """
        Validate the data according to the registration rules.
        """
        # Check if email is already in use
        if User.objects.filter(email=data['email']).exists():
            raise serializers.ValidationError({"email": "This email is already in use."})

        # Apply custom validation rules
        validation_rules = PatientRegistrationValidation.objects.filter(is_active=True)
        for rule in validation_rules:
            field_name = rule.field_name
            if field_name in data:
                # Check if required field is empty
                if rule.is_required and (data[field_name] is None or data[field_name] == ''):
                    raise serializers.ValidationError({field_name: rule.validation_message})

                # Check regex validation if field has a value and regex is defined
                if rule.validation_regex and data[field_name]:
                    import re
                    if not re.match(rule.validation_regex, str(data[field_name])):
                        raise serializers.ValidationError({field_name: rule.validation_message})
        
        admission = data.get('admission_details')
        if not admission:
            raise serializers.ValidationError({
                "admission_details": "Registration must include encounter context."
            })

        encounter_type = admission.get('type')
        if encounter_type not in ['outpatient', 'inpatient', 'emergency']:
            raise serializers.ValidationError({
                "admission_details": "Encounter type must be outpatient, inpatient, or emergency."
            })

        request = self.context.get('request')
        facility = get_user_facility(request) if request else None
        if not facility:
            raise serializers.ValidationError("Facility context is required.")

        department_id = admission.get('department_id')
        if not department_id:
            raise serializers.ValidationError({
                "admission_details": "department_id is required for registration."
            })

        from apps.organization.models import ClinicalUnit
        department = ClinicalUnit.objects.select_related(
            'unit_type', 'root_unit', 'core_department'
        ).filter(id=department_id, is_active=True).first()
        if not department:
            from apps.core.models import Department as CoreDepartment
            from apps.organization.services import UnitHierarchyService
            core_department = CoreDepartment.objects.filter(
                id=department_id,
                is_active=True
            ).first()
            if core_department:
                department = UnitHierarchyService.get_department_unit_for_core_department(
                    core_department=core_department,
                    facility=facility,
                )
        if not department:
            raise serializers.ValidationError({
                "admission_details": "Selected department does not exist."
            })
        if getattr(department.unit_type, 'code', None) != 'department' and not department.core_department_id:
            raise serializers.ValidationError({
                "admission_details": "Selected unit is not a department."
            })
        department_facility = resolve_object_facility(department)
        if not department_facility or department_facility.id != facility.id:
            raise serializers.ValidationError({
                "admission_details": "Department does not belong to the active facility."
            })
        if not department.core_department:
            raise serializers.ValidationError({
                "admission_details": "Department must be linked to a facility department."
            })

        self._resolved_department = department

        if encounter_type == 'outpatient':
            if department.core_department.department_type == 'emergency':
                raise serializers.ValidationError({
                    "admission_details": "Emergency departments cannot register outpatient visits."
                })
            clinic_id = admission.get('clinic_id')
            self._resolved_clinic = self._resolve_outpatient_clinic(
                facility=facility,
                department=department,
                clinic_id=clinic_id,
            )

        if encounter_type == 'emergency':
            if department.core_department.department_type != 'emergency':
                raise serializers.ValidationError({
                    "admission_details": "Emergency registration requires an emergency department."
                })
            if admission.get('clinic_id'):
                raise serializers.ValidationError({
                    "admission_details": "Clinic is not allowed for emergency registration."
                })

        if encounter_type == 'inpatient':
            if department.core_department.department_type == 'emergency':
                raise serializers.ValidationError({
                    "admission_details": "Inpatient registrations must use a non-emergency department."
                })
            from ..wards.models import Bed, Ward
            bed_id = admission.get('bed_id')
            ward_id = admission.get('ward_id')
            admission_type = admission.get('admission_type')
            if admission_type == 'emergency':
                raise serializers.ValidationError({
                    "admission_details": "Emergency admissions must originate from an ED encounter."
                })
            if bed_id:
                try:
                    bed = Bed.objects.select_related('ward', 'ward__department').get(id=bed_id)
                    if bed.status != 'available':
                        raise serializers.ValidationError({"admission_details": f"Bed {bed.bed_number} is not available."})
                    if bed.ward and bed.ward.department and bed.ward.department.facility_id != facility.id:
                        raise serializers.ValidationError({"admission_details": "Selected bed does not belong to the active facility."})
                    if bed.ward and bed.ward.department and bed.ward.department_id != department.core_department_id:
                        raise serializers.ValidationError({"admission_details": "Bed does not belong to the selected department."})
                except Bed.DoesNotExist:
                    raise serializers.ValidationError({"admission_details": "Selected bed does not exist."})
            elif ward_id:
                ward = Ward.objects.select_related('department').filter(id=ward_id).first()
                if not ward:
                    raise serializers.ValidationError({"admission_details": "Selected ward does not exist."})
                if ward.department and ward.department.facility_id != facility.id:
                    raise serializers.ValidationError({"admission_details": "Selected ward does not belong to the active facility."})
                if ward.department_id and ward.department_id != department.core_department_id:
                    raise serializers.ValidationError({"admission_details": "Ward does not belong to the selected department."})

        return data

    def create(self, validated_data):
        """
        Create a new patient with both local and FHIR resources.
        """
        # Extract address fields
        address_fields = {
            'address_line1': validated_data.pop('address_line1', ''),
            'address_line2': validated_data.pop('address_line2', ''),
            'city': validated_data.pop('city', ''),
            'state': validated_data.pop('state', ''),
            'postal_code': validated_data.pop('postal_code', ''),
            'country': validated_data.pop('country', '')
        }
        
        # Extract admission details
        admission_details = validated_data.pop('admission_details', None)

        # Generate a secure password for the patient (not provided during registration)
        generated_password = generate_secure_password()

        # Create User
        user = User.objects.create_user(
            email=validated_data['email'],
            username=validated_data['email'],  # Use email as username
            password=generated_password,
            first_name=validated_data['first_name'],
            last_name=validated_data['last_name'],
            phone_number=validated_data.get('phone_number', ''),
            date_of_birth=validated_data['date_of_birth'],
            user_type='patient'
        )

        # Generate a unique medical record number
        medical_record_number = generate_unique_mrn()

        request = self.context.get('request')
        facility_code = getattr(request, 'facility_code', None) or get_current_facility_code()
        facility = get_user_facility(request) if request else None
        if not facility and facility_code:
            facility = Facility.get_by_code(facility_code)
        if not facility:
            raise serializers.ValidationError("Facility context is required.")

        if user.primary_facility_id and user.primary_facility_id != facility.id:
            raise serializers.ValidationError("User belongs to a different facility.")
        if user.primary_facility_id is None:
            user.primary_facility = facility
            user.save(update_fields=['primary_facility'])
        user.facilities.add(facility)

        try:
            patient_identity, identity_created = resolve_patient_identity(
                first_name=validated_data['first_name'],
                last_name=validated_data['last_name'],
                date_of_birth=validated_data['date_of_birth'],
                gender=validated_data.get('gender', ''),
                nhis_id=validated_data.get('nhis_id', ''),
                phone=validated_data.get('phone_number', ''),
                email=validated_data.get('email', ''),
                created_by_facility_code=facility_code or '',
                created_by_user_id=getattr(request.user, 'id', None) if request else None,
            )
        except Exception as exc:
            user.delete()
            raise serializers.ValidationError(f"Failed to create MPI identity: {exc}") from exc

        # Create PatientProfile
        patient_profile = PatientProfile.objects.create(
            user=user,
            facility=facility,
            patient_identity_id=patient_identity.id if patient_identity else None,
            medical_record_number=medical_record_number,
            nhis_id=validated_data.get('nhis_id', ''),
            blood_group=validated_data.get('blood_group', ''),
            allergies=validated_data.get('allergies', ''),
            emergency_contact_name=validated_data.get('emergency_contact_name', ''),
            emergency_contact_phone=validated_data.get('emergency_contact_phone', ''),
            emergency_contact_relationship=validated_data.get('emergency_contact_relationship', ''),
            created_by=self.context['request'].user,
            updated_by=self.context['request'].user
        )

        link_patient_to_facility(
            patient_identity=patient_identity,
            facility_code=facility_code or '',
            facility_patient_id=patient_profile.id,
            created_by_facility_code=facility_code or '',
            created_by_user_id=getattr(request.user, 'id', None) if request else None,
        )

        # Create FHIR Patient resource
        fhir_patient_data = {
            "resourceType": "Patient",
            "id": generate_fhir_id(),
            "active": True,
            "name": [
                create_human_name(
                    family=validated_data['last_name'],
                    given=[validated_data['first_name']]
                )
            ],
            "identifier": [
                create_identifier(
                    system="http://hospital.example.org/fhir/identifier/mrn",
                    value=medical_record_number
                )
            ],
            "birthDate": validated_data['date_of_birth'].isoformat()
        }

        # Add telecom if phone number is provided
        if validated_data.get('phone_number'):
            fhir_patient_data["telecom"] = [
                create_contact_point(
                    system="phone",
                    value=validated_data['phone_number'],
                    use="home"
                )
            ]

        # Add address if provided
        if any(address_fields.values()):
            lines = [address_fields['address_line1']]
            if address_fields['address_line2']:
                lines.append(address_fields['address_line2'])

            fhir_patient_data["address"] = [
                create_address(
                    line=lines,
                    city=address_fields['city'],
                    state=address_fields['state'],
                    postalCode=address_fields['postal_code'],
                    country=address_fields['country']
                )
            ]

        # Create the FHIR resource
        try:
            fhir_patient = fhir_client.create_resource("Patient", fhir_patient_data)

            # Create the mapping
            PatientFHIRMapping.objects.create(
                patient_profile=patient_profile,
                fhir_patient_id=fhir_patient["id"],
                fhir_resource_version=fhir_patient.get("meta", {}).get("versionId"),
                created_by=self.context['request'].user,
                updated_by=self.context['request'].user
            )

            # Update the patient profile with the FHIR ID
            patient_profile.fhir_patient_id = fhir_patient["id"]
            patient_profile.save()
            
            if admission_details:
                encounter_type = admission_details.get('type')
                admission_notes = admission_details.get('notes', '')
                from apps.encounters.models import Encounter

                department = getattr(self, '_resolved_department', None)

                if encounter_type == 'outpatient':
                    clinic = getattr(self, '_resolved_clinic', None)
                    if not clinic and admission_details.get('clinic_id'):
                        from apps.organization.models import Clinic
                        clinic = Clinic.objects.get(id=admission_details.get('clinic_id'))
                    encounter = Encounter.objects.create(
                        patient=patient_profile,
                        facility=patient_profile.facility,
                        clinic=clinic,
                        department=department,
                        encounter_type='outpatient',
                        status='in-progress',
                        start_time=timezone.now(),
                        reason=admission_notes,
                        service_type=clinic.name,
                        location=clinic.name,
                        created_by=self.context['request'].user,
                        updated_by=self.context['request'].user
                    )
                    try:
                        from apps.wards.tasks import sync_encounter_to_fhir
                        transaction.on_commit(
                            lambda: sync_encounter_to_fhir.delay(str(encounter.id))
                        )
                    except Exception:
                        pass

                if encounter_type == 'emergency':
                    encounter = Encounter.objects.create(
                        patient=patient_profile,
                        facility=patient_profile.facility,
                        department=department,
                        encounter_type='emergency',
                        status='in-progress',
                        start_time=timezone.now(),
                        reason=admission_notes,
                        service_type=department.name if department else 'Emergency',
                        location=department.name if department else 'Emergency',
                        created_by=self.context['request'].user,
                        updated_by=self.context['request'].user
                    )
                    try:
                        from apps.wards.tasks import sync_encounter_to_fhir
                        transaction.on_commit(
                            lambda: sync_encounter_to_fhir.delay(str(encounter.id))
                        )
                    except Exception:
                        pass

                if encounter_type == 'inpatient':
                    from ..wards.models import Bed, Ward, Admission

                    bed_id = admission_details.get('bed_id')
                    ward_id = admission_details.get('ward_id')
                    admission_type = admission_details.get('admission_type') or 'elective'

                    bed = None
                    location_display = "Waiting List"
                    admission_status = 'waiting'
                    daily_rate = 0.00

                    if bed_id:
                        bed = Bed.objects.get(id=bed_id)
                        location_display = bed.ward.name
                        admission_status = 'admitted'
                        daily_rate = bed.total_rate
                    elif ward_id:
                        ward = Ward.objects.get(id=ward_id)
                        available_bed = Bed.objects.filter(
                            ward=ward,
                            status='available'
                        ).first()

                        if available_bed:
                            bed = available_bed
                            location_display = ward.name
                            admission_status = 'admitted'
                            daily_rate = bed.total_rate
                        else:
                            location_display = f"{ward.name} (Waiting List)"

                    admission = Admission.objects.create(
                        patient=patient_profile,
                        bed=bed,
                        facility=patient_profile.facility,
                        admission_type=admission_type,
                        status=admission_status,
                        admission_notes=admission_notes,
                        daily_rate=daily_rate,
                        admitting_doctor=None,
                        primary_team=department,
                        created_by=self.context['request'].user,
                        updated_by=self.context['request'].user
                    )

                    encounter = Encounter.objects.create(
                        patient=patient_profile,
                        facility=patient_profile.facility,
                        practitioner=None,
                        encounter_type='inpatient',
                        status='in-progress' if bed else 'planned',
                        start_time=admission.admission_date,
                        reason=admission_notes,
                        service_type=f"Admission to {location_display}",
                        location=location_display,
                        admission=admission,
                        department=department,
                        created_by=self.context['request'].user,
                        updated_by=self.context['request'].user
                    )

                    admission.fhir_encounter_id = str(encounter.id)
                    admission.save(update_fields=['fhir_encounter_id'])

                    try:
                        from apps.wards.tasks import sync_encounter_to_fhir
                        transaction.on_commit(
                            lambda: sync_encounter_to_fhir.delay(str(encounter.id))
                        )
                    except Exception:
                        pass

        except Exception as e:
            # If FHIR creation fails, delete the local resources and raise the error
            patient_profile.delete()
            user.delete()
            try:
                from apps.mpi.models import PatientFacilityLink
                PatientFacilityLink.objects.filter(
                    patient_identity=patient_identity,
                    facility_code=facility_code or ''
                ).delete()
                if identity_created and not patient_identity.facility_links.exists():
                    patient_identity.delete()
            except Exception:
                pass
            raise serializers.ValidationError(f"Failed to create FHIR Patient resource: {str(e)}")

        return patient_profile
