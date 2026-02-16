from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import Staff, PractitionerProfile, PatientProfile, PractitionerFHIRMapping, UserPatientList, UserSession
from apps.core.security import get_user_facility
from .identifiers import generate_unique_employee_id
from .tasks import create_practitioner_in_fhir
from .unit_assignment import auto_assign_staff_to_department_unit
import random
import string
import logging

User = get_user_model()

# Set up logger
logger = logging.getLogger(__name__)

def _apply_admin_flags(user: User) -> None:
    """
    Keep Django admin flags consistent with our RBAC user_type.

    Admin users should always be staff so permissions that rely on is_staff work.
    We intentionally do not auto-escalate is_superuser here.
    """
    if not user:
        return
    if getattr(user, 'user_type', None) == 'admin' and not getattr(user, 'is_staff', False):
        user.is_staff = True


class UserSerializer(serializers.ModelSerializer):
    """
    Serializer for the User model.
    """
    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'phone_number',
                  'date_of_birth', 'gender', 'user_type', 'is_active',
                  'must_change_password', 'date_joined']
        # SECURITY: user_type and is_active are read-only to prevent privilege escalation
        # Only admins can modify these fields via admin-specific endpoints
        read_only_fields = ['id', 'date_joined', 'user_type', 'is_active', 'must_change_password']


class UserWithAccessContextSerializer(serializers.ModelSerializer):
    """
    Serializer for the User model that includes access context (off-site status).
    Used for the /users/me/ endpoint to provide the frontend with read-only mode info.
    """
    is_offsite = serializers.SerializerMethodField()
    offsite_mode = serializers.SerializerMethodField()
    readonly_message = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'phone_number',
                  'date_of_birth', 'gender', 'user_type', 'is_active', 'date_joined',
                  'must_change_password',
                  'is_offsite', 'offsite_mode', 'readonly_message']
        read_only_fields = ['id', 'date_joined', 'must_change_password']

    def get_is_offsite(self, obj):
        """Return whether the user is accessing from off-site."""
        request = self.context.get('request')
        if request and hasattr(request, 'is_offsite'):
            return request.is_offsite
        return False

    def get_offsite_mode(self, obj):
        """Return the configured off-site access mode."""
        request = self.context.get('request')
        if request and hasattr(request, 'offsite_mode'):
            return request.offsite_mode
        return 'allow'

    def get_readonly_message(self, obj):
        """Return the read-only message if user is off-site in readonly mode."""
        request = self.context.get('request')
        if request and hasattr(request, 'is_offsite') and request.is_offsite:
            if hasattr(request, 'offsite_mode') and request.offsite_mode == 'readonly':
                from apps.core.models import OffSiteAccessSettings
                settings = OffSiteAccessSettings.get_settings()
                return settings.readonly_message
        return None


class UserCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating a new user.
    """
    password = serializers.CharField(write_only=True, required=True, style={'input_type': 'password'})
    confirm_password = serializers.CharField(write_only=True, required=True, style={'input_type': 'password'})

    class Meta:
        model = User
        fields = ['id', 'email', 'username', 'password', 'confirm_password', 'first_name',
                  'last_name', 'phone_number', 'date_of_birth', 'user_type']
        read_only_fields = ['id']

    def validate(self, data):
        if data['password'] != data.pop('confirm_password'):
            raise serializers.ValidationError("Passwords do not match.")
        return data

    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data['email'],
            username=validated_data['username'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            phone_number=validated_data.get('phone_number', ''),
            date_of_birth=validated_data.get('date_of_birth', None),
            user_type=validated_data.get('user_type', 'patient')
        )
        _apply_admin_flags(user)
        if user.user_type == 'admin':
            user.save(update_fields=['is_staff'])
        return user


class StaffSerializer(serializers.ModelSerializer):
    """
    Serializer for the Staff model.
    """
    user_details = UserSerializer(source='user', read_only=True)
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())

    class Meta:
        model = Staff
        fields = ['id', 'user', 'user_details', 'employee_id', 'department',
                  'position', 'hire_date', 'created_at', 'updated_at',
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PractitionerProfileSerializer(serializers.ModelSerializer):
    """
    Serializer for the PractitionerProfile model.
    """
    staff_details = StaffSerializer(source='staff', read_only=True)
    staff = serializers.PrimaryKeyRelatedField(queryset=Staff.objects.all())

    class Meta:
        model = PractitionerProfile
        fields = ['id', 'staff', 'staff_details', 'license_number', 'specialization', 
                  'qualification', 'fhir_practitioner_id', 'created_at', 'updated_at', 
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PatientProfileSerializer(serializers.ModelSerializer):
    """
    Serializer for the PatientProfile model.
    """
    user_details = UserSerializer(source='user', read_only=True)
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    current_ward = serializers.SerializerMethodField()
    current_ward_id = serializers.SerializerMethodField()
    current_admission_id = serializers.SerializerMethodField()
    admission_status = serializers.SerializerMethodField()
    admission_date = serializers.SerializerMethodField()

    class Meta:
        model = PatientProfile
        fields = ['id', 'user', 'user_details', 'patient_identity_id',
                  'medical_record_number', 'nhis_id',
                  'blood_group', 'allergies', 'emergency_contact_name',
                  'emergency_contact_phone', 'emergency_contact_relationship',
                  'fhir_patient_id', 'current_ward', 'current_ward_id',
                  'current_admission_id', 'admission_status', 'admission_date',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = [
            'id',
            'patient_identity_id',
            'created_at',
            'updated_at',
            'created_by',
            'updated_by',
        ]

    def _get_active_admission(self, obj):
        """
        Helper method to get the active admission with optimized prefetch handling.
        Supports three prefetch patterns:
        1. active_admissions_list (optimized - pre-filtered for active)
        2. admissions in _prefetched_objects_cache (legacy - filter in Python)
        3. Database query fallback
        """
        # First, check for optimized prefetch attribute (active admissions only)
        if hasattr(obj, 'active_admissions_list'):
            active_list = obj.active_admissions_list
            return active_list[0] if active_list else None

        # Second, check for legacy prefetched admissions cache
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            return next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )

        # Fallback to DB query if not prefetched
        return obj.admissions.filter(status__in=['admitted', 'waiting']).first()

    def get_current_ward(self, obj):
        """
        Get the name of the ward where the patient is currently admitted.
        Returns "Waiting List" if admitted but no bed, None otherwise.
        """
        admission = self._get_active_admission(obj)

        if not admission:
            return None

        if admission.status == 'waiting':
            return "Waiting List"

        if admission.bed:
            return admission.bed.ward.name

        return "Admitted (No Bed)"

    def get_current_ward_id(self, obj):
        """
        Get the ID of the ward where the patient is currently admitted.
        Returns None if not admitted to a ward.
        """
        admission = self._get_active_admission(obj)
        if admission and admission.bed:
            return str(admission.bed.ward.id)
        return None

    def get_current_admission_id(self, obj):
        """
        Get the ID of the current active admission.
        Returns None if not currently admitted.
        """
        admission = self._get_active_admission(obj)
        if admission:
            return str(admission.id)
        return None

    def get_admission_status(self, obj):
        """
        Get the status of the current admission.
        Returns None if not currently admitted.
        """
        admission = self._get_active_admission(obj)
        if admission:
            return admission.status
        return None

    def get_admission_date(self, obj):
        """
        Get the admission date of the patient's current admission.
        Returns None if not currently admitted.
        """
        admission = self._get_active_admission(obj)
        if admission:
            return admission.admission_date
        return None


class PatientSearchListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for patient search results.
    Returns only essential fields for list display - no nested objects or DB lookups.
    """
    name = serializers.SerializerMethodField()
    date_of_birth = serializers.DateField(source='user.date_of_birth', read_only=True)
    gender = serializers.CharField(source='user.gender', read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    current_ward = serializers.SerializerMethodField()
    patient_location = serializers.SerializerMethodField()
    active_clinic_names = serializers.SerializerMethodField()
    admission_status = serializers.SerializerMethodField()
    registry_status = serializers.SerializerMethodField()
    admission_date = serializers.SerializerMethodField()

    class Meta:
        model = PatientProfile
        fields = [
            'id',
            'medical_record_number',
            'name',
            'date_of_birth',
            'gender',
            'created_at',
            'current_ward',
            'patient_location',
            'active_clinic_names',
            'admission_status',
            'registry_status',
            'admission_date',
        ]

    def get_name(self, obj):
        """Get full name directly from prefetched user."""
        return obj.user.get_full_name()

    def _get_active_admission(self, obj):
        if hasattr(obj, 'active_admissions_list'):
            return obj.active_admissions_list[0] if obj.active_admissions_list else None
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            return next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        return obj.admissions.filter(status__in=['admitted', 'waiting']).select_related('bed', 'bed__ward').first()

    def _get_active_encounters(self, obj):
        if hasattr(obj, 'active_encounters_list'):
            return obj.active_encounters_list

        if hasattr(obj, '_prefetched_objects_cache') and 'encounters' in obj._prefetched_objects_cache:
            return [e for e in obj.encounters.all() if e.status in ['planned', 'in-progress']]

        from apps.encounters.models import Encounter
        return list(
            Encounter.objects.filter(
                patient=obj,
                status__in=['planned', 'in-progress'],
            ).select_related('clinic').order_by('-start_time', '-id')
        )

    def _get_active_clinic_names(self, obj):
        names = []
        seen = set()
        for encounter in self._get_active_encounters(obj):
            if encounter.encounter_type != 'outpatient':
                continue
            clinic_name = None
            if getattr(encounter, 'clinic', None):
                clinic_name = encounter.clinic.name
            elif encounter.location:
                clinic_name = encounter.location
            if clinic_name and clinic_name not in seen:
                seen.add(clinic_name)
                names.append(clinic_name)
        return names

    def get_current_ward(self, obj):
        """Get ward name from prefetched active_admissions_list."""
        admission = self._get_active_admission(obj)
        if admission:
            if admission.status == 'waiting':
                return "Waiting List"
            if admission.bed:
                return admission.bed.ward.name
            return "Admitted (No Bed)"
        return None

    def get_patient_location(self, obj):
        """
        Unified location for registry:
        active ward/waiting list first, then active outpatient clinic/location.
        """
        admission = self._get_active_admission(obj)
        if admission:
            if admission.status == 'waiting':
                return "Waiting List"
            if admission.bed:
                return admission.bed.ward.name
            return "Admitted (No Bed)"

        clinic_names = self._get_active_clinic_names(obj)
        if clinic_names:
            return clinic_names[0]

        for encounter in self._get_active_encounters(obj):
            if encounter.location:
                return encounter.location
        return None

    def get_active_clinic_names(self, obj):
        return self._get_active_clinic_names(obj)

    def get_admission_date(self, obj):
        """Get admission date from prefetched active_admissions_list."""
        admission = self._get_active_admission(obj)
        if admission:
            if admission.admission_date:
                return admission.admission_date.isoformat()
        return None

    def get_admission_status(self, obj):
        """Get status from prefetched active_admissions_list."""
        admission = self._get_active_admission(obj)
        if admission:
            return admission.status
        return None

    def get_registry_status(self, obj):
        """
        Registry status precedence:
        active admission > active encounter > latest terminal admission > latest completed outpatient.
        """
        admission = self._get_active_admission(obj)
        if admission:
            return admission.status

        active_encounters = self._get_active_encounters(obj)
        if active_encounters:
            return active_encounters[0].status

        has_terminal_annotation = hasattr(obj, 'latest_terminal_admission_status')
        latest_terminal_admission_status = getattr(obj, 'latest_terminal_admission_status', None)
        if latest_terminal_admission_status:
            return latest_terminal_admission_status

        has_completed_annotation = hasattr(obj, 'latest_completed_outpatient_status')
        latest_completed_outpatient_status = getattr(obj, 'latest_completed_outpatient_status', None)
        if latest_completed_outpatient_status:
            return latest_completed_outpatient_status

        # Avoid per-row fallback queries when list-query annotations are present.
        if has_terminal_annotation or has_completed_annotation:
            return None

        # Fallback if annotation is unavailable.
        latest_terminal_admission_status = obj.admissions.filter(
            status__in=['discharged', 'transferred', 'deceased']
        ).order_by('-admission_date').values_list('status', flat=True).first()
        if latest_terminal_admission_status:
            return latest_terminal_admission_status

        from apps.encounters.models import Encounter
        latest_completed_outpatient_status = Encounter.objects.filter(
            patient=obj,
            encounter_type='outpatient',
            status__in=['finished', 'cancelled'],
        ).order_by('-end_time', '-start_time', '-id').values_list('status', flat=True).first()
        if latest_completed_outpatient_status:
            return latest_completed_outpatient_status

        return None


class PractitionerFHIRMappingListSerializer(serializers.ModelSerializer):
    """
    Minimal serializer for practitioner FHIR mappings (list).
    """
    practitioner_name = serializers.SerializerMethodField()
    employee_id = serializers.CharField(source='practitioner_profile.staff.employee_id', read_only=True)

    class Meta:
        model = PractitionerFHIRMapping
        fields = [
            'id', 'practitioner_profile', 'practitioner_name', 'employee_id',
            'fhir_practitioner_id', 'last_synced', 'is_synced'
        ]
        read_only_fields = ['id', 'last_synced']

    def get_practitioner_name(self, obj):
        staff = getattr(obj.practitioner_profile, 'staff', None)
        user = getattr(staff, 'user', None) if staff else None
        return user.get_full_name() if user else None


class PractitionerFHIRMappingSerializer(serializers.ModelSerializer):
    """
    Serializer for the PractitionerFHIRMapping model (detail).
    """
    practitioner_profile_details = PractitionerProfileSerializer(source='practitioner_profile', read_only=True)

    class Meta:
        model = PractitionerFHIRMapping
        fields = ['id', 'practitioner_profile', 'practitioner_profile_details', 'fhir_practitioner_id',
                  'fhir_resource_version', 'last_synced', 'is_synced',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'last_synced', 'created_at', 'updated_at', 'created_by', 'updated_by']


def generate_secure_password(length=12):
    """
    Generate a secure random password with a mix of letters, numbers, and special characters.

    Args:
        length (int): Length of the password to generate. Default is 12.

    Returns:
        str: A secure random password
    """
    # Define character sets
    lowercase = string.ascii_lowercase
    uppercase = string.ascii_uppercase
    digits = string.digits
    special_chars = "!@#$%^&*()-_=+[]{}|;:,.<>?"

    # Ensure at least one character from each set
    password = [
        random.choice(lowercase),
        random.choice(uppercase),
        random.choice(digits),
        random.choice(special_chars)
    ]

    # Fill the rest of the password with random characters from all sets
    all_chars = lowercase + uppercase + digits + special_chars
    password.extend(random.choices(all_chars, k=length-4))

    # Shuffle the password to make it more random
    random.shuffle(password)

    return ''.join(password)


class StaffInviteSerializer(serializers.Serializer):
    """
    Admin-only serializer to create staff users without setting a known password.

    Intended for "invite" flows where the user receives a password reset link.
    Never sends plaintext passwords and does not perform external FHIR calls.
    """
    email = serializers.EmailField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    user_type = serializers.ChoiceField(choices=[
        'admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing'
    ])

    phone_number = serializers.CharField(required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)

    department = serializers.CharField()
    department_unit_id = serializers.UUIDField(required=False, allow_null=True)
    position = serializers.CharField()
    hire_date = serializers.DateField()

    # Required for doctors/nurses
    license_number = serializers.CharField(required=False, allow_blank=True)
    specialization = serializers.CharField(required=False, allow_blank=True)
    qualification = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        user_type = data.get('user_type')
        if user_type in ['doctor', 'nurse']:
            missing = [k for k in ['license_number', 'specialization', 'qualification'] if not data.get(k)]
            if missing:
                raise serializers.ValidationError({
                    k: "This field is required for doctors and nurses." for k in missing
                })
        return data

    def create(self, validated_data):
        request = self.context.get('request')
        actor = getattr(request, 'user', None)
        facility = get_user_facility(request) if request else None
        if not facility:
            raise serializers.ValidationError("Facility context is required.")

        email = validated_data['email'].lower()
        user_type = validated_data['user_type']

        existing_user = User.objects.filter(email=email).first()
        had_usable_password = existing_user.has_usable_password() if existing_user else False

        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                'username': email,
                'first_name': validated_data['first_name'],
                'last_name': validated_data['last_name'],
                'phone_number': validated_data.get('phone_number', ''),
                'date_of_birth': validated_data.get('date_of_birth'),
                'user_type': user_type,
                'is_active': True,
            }
        )

        if not created:
            # Update basic details but avoid altering existing credentials unexpectedly.
            user.first_name = validated_data['first_name']
            user.last_name = validated_data['last_name']
            user.phone_number = validated_data.get('phone_number', user.phone_number)
            user.date_of_birth = validated_data.get('date_of_birth', user.date_of_birth)
            user.user_type = user_type
            user.is_active = True
            _apply_admin_flags(user)
            user.save(update_fields=[
                'first_name', 'last_name', 'phone_number', 'date_of_birth', 'user_type', 'is_active', 'is_staff'
            ])
        else:
            # Ensure no known password exists for invited accounts.
            user.set_unusable_password()
            _apply_admin_flags(user)
            user.save(update_fields=['password', 'is_staff'])

        if user.primary_facility_id and user.primary_facility_id != facility.id:
            raise serializers.ValidationError("User belongs to a different facility.")
        if user.primary_facility_id is None:
            user.primary_facility = facility
            user.save(update_fields=['primary_facility'])
        user.facilities.add(facility)

        # Ensure staff profile exists
        staff, staff_created = Staff.objects.get_or_create(
            user=user,
            defaults={
                'employee_id': generate_unique_employee_id(facility),
                'department': validated_data['department'],
                'position': validated_data['position'],
                'hire_date': validated_data['hire_date'],
                'primary_facility': facility,
                'created_by': actor if getattr(actor, 'is_authenticated', False) else None,
                'updated_by': actor if getattr(actor, 'is_authenticated', False) else None,
            }
        )

        if not staff_created:
            staff.department = validated_data['department']
            staff.position = validated_data['position']
            staff.hire_date = validated_data['hire_date']
            if getattr(actor, 'is_authenticated', False):
                staff.updated_by = actor
            if staff.primary_facility_id is None:
                staff.primary_facility = facility
            staff.save(update_fields=['department', 'position', 'hire_date', 'updated_by', 'primary_facility'])

        # Practitioner profile (doctor/nurse only)
        if user_type in ['doctor', 'nurse']:
            PractitionerProfile.objects.update_or_create(
                staff=staff,
                defaults={
                    'license_number': validated_data['license_number'],
                    'specialization': validated_data['specialization'],
                    'qualification': validated_data['qualification'],
                    'created_by': actor if getattr(actor, 'is_authenticated', False) else None,
                    'updated_by': actor if getattr(actor, 'is_authenticated', False) else None,
                }
            )

        try:
            auto_assign_staff_to_department_unit(
                staff,
                facility=facility,
                department_name=validated_data.get('department'),
                department_unit_id=validated_data.get('department_unit_id'),
                assigned_by=actor if getattr(actor, 'is_authenticated', False) else None,
            )
        except Exception:
            logger.exception(
                "Failed to auto-assign invited staff to department unit",
                extra={'staff_id': str(staff.id)},
            )

        # Expose creation context to the view without changing API response.
        staff._user_created = created
        staff._user_had_usable_password = had_usable_password

        return staff


class StaffRegistrationSerializer(serializers.Serializer):
    """
    Serializer for staff registration that creates both local and FHIR resources.
    Sends a password reset link for the staff to set their password.
    """
    # User fields
    email = serializers.EmailField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    phone_number = serializers.CharField(required=False, allow_blank=True)
    date_of_birth = serializers.DateField()
    user_type = serializers.ChoiceField(choices=User.USER_TYPE_CHOICES)

    # Staff fields
    department = serializers.CharField()
    department_unit_id = serializers.UUIDField(required=False, allow_null=True)
    position = serializers.CharField()
    hire_date = serializers.DateField()

    # PractitionerProfile fields (only required if user_type is doctor or nurse)
    license_number = serializers.CharField(required=False)
    specialization = serializers.CharField(required=False)
    qualification = serializers.CharField(required=False)

    # Address fields
    address_line1 = serializers.CharField(required=False, allow_blank=True)
    address_line2 = serializers.CharField(required=False, allow_blank=True)
    city = serializers.CharField(required=False, allow_blank=True)
    state = serializers.CharField(required=False, allow_blank=True)
    postal_code = serializers.CharField(required=False, allow_blank=True)
    country = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        """
        Validate the data according to the registration rules.
        """
        # Check if email is already in use by an active staff member
        existing_user = User.objects.filter(email=data['email']).first()
        if existing_user:
            existing_staff = getattr(existing_user, 'staff_profile', None)
            if existing_staff:
                if existing_user.is_active:
                    raise serializers.ValidationError({"email": "This email is already in use by an active staff member."})
                raise serializers.ValidationError({
                    "email": "This email belongs to a deactivated staff account. Reactivate that staff record instead of re-registering."
                })
            # Otherwise, we'll reuse this orphaned user - store it for create()
            data['_existing_user'] = existing_user

        # Check if user_type is doctor or nurse, then practitioner fields are required
        if data.get('user_type') in ['doctor', 'nurse']:
            if not data.get('license_number'):
                raise serializers.ValidationError({"license_number": "License number is required for doctors and nurses."})
            if not data.get('specialization'):
                raise serializers.ValidationError({"specialization": "Specialization is required for doctors and nurses."})
            if not data.get('qualification'):
                raise serializers.ValidationError({"qualification": "Qualification is required for doctors and nurses."})

        return data

    def create(self, validated_data):
        """
        Create a new staff member with both local and FHIR resources.
        """
        request = self.context.get('request')
        facility = get_user_facility(request) if request else None
        if not facility:
            raise serializers.ValidationError("Facility context is required.")

        # Check if we're reusing an existing user
        existing_user = validated_data.pop('_existing_user', None)
        user_created = existing_user is None

        # Extract address fields
        address_fields = {
            'address_line1': validated_data.pop('address_line1', ''),
            'address_line2': validated_data.pop('address_line2', ''),
            'city': validated_data.pop('city', ''),
            'state': validated_data.pop('state', ''),
            'postal_code': validated_data.pop('postal_code', ''),
            'country': validated_data.pop('country', '')
        }

        # Extract practitioner fields
        practitioner_fields = {
            'license_number': validated_data.pop('license_number', None),
            'specialization': validated_data.pop('specialization', None),
            'qualification': validated_data.pop('qualification', None)
        }

        if existing_user:
            # Reuse and update the existing orphaned user
            user = existing_user
            user.first_name = validated_data['first_name']
            user.last_name = validated_data['last_name']
            user.phone_number = validated_data.get('phone_number', '')
            user.date_of_birth = validated_data['date_of_birth']
            user.user_type = validated_data['user_type']
            user.is_active = True
            _apply_admin_flags(user)
            user.save()
        else:
            # Create new User
            user = User.objects.create_user(
                email=validated_data['email'],
                username=validated_data['email'],  # Use email as username
                password=None,  # Force password set via reset link
                first_name=validated_data['first_name'],
                last_name=validated_data['last_name'],
                phone_number=validated_data.get('phone_number', ''),
                date_of_birth=validated_data['date_of_birth'],
                user_type=validated_data['user_type']
            )
            _apply_admin_flags(user)
            user.save(update_fields=['is_staff'])

        if user.primary_facility_id and user.primary_facility_id != facility.id:
            raise serializers.ValidationError("User belongs to a different facility.")
        if user.primary_facility_id is None:
            user.primary_facility = facility
            user.save(update_fields=['primary_facility'])
        user.facilities.add(facility)

        # Generate a unique employee ID
        employee_id = generate_unique_employee_id(facility)

        # Create Staff
        staff = Staff.objects.create(
            user=user,
            employee_id=employee_id,
            department=validated_data['department'],
            position=validated_data['position'],
            hire_date=validated_data['hire_date'],
            primary_facility=facility,
            created_by=self.context['request'].user,
            updated_by=self.context['request'].user
        )

        # Send set-password/reset link email (runs sync in DEBUG mode via CELERY_TASK_ALWAYS_EAGER)
        from .models import PasswordResetToken
        from .tasks import send_password_reset_email, send_account_setup_email
        from django.conf import settings
        try:
            plain_token, _ = PasswordResetToken.create_for_user(
                user=user,
                reset_type='admin_force',
                initiated_by=self.context['request'].user,
                expiry_minutes=getattr(settings, 'PASSWORD_RESET_TOKEN_EXPIRY_MINUTES', 15),
            )
            if user_created or not user.has_usable_password():
                send_account_setup_email.delay(
                    user_id=str(user.id),
                    token=plain_token,
                    user_email=user.email,
                    user_name=f"{user.first_name} {user.last_name}".strip() or user.email,
                    employee_id=staff.employee_id,
                    department=staff.department,
                    position=staff.position,
                )
            else:
                send_password_reset_email.delay(
                    user_id=str(user.id),
                    token=plain_token,
                    user_email=user.email,
                    user_name=f"{user.first_name} {user.last_name}".strip() or user.email,
                )
        except Exception as e:
            logger.error(f"Failed to send account setup/reset email for user {user.id}: {e}")

        logger.info(f"Staff account created with ID {user.id} and employee ID: {employee_id}")

        # Create PractitionerProfile if user_type is doctor or nurse
        practitioner_profile = None
        if user.user_type in ['doctor', 'nurse'] and all(practitioner_fields.values()):
            practitioner_profile = PractitionerProfile.objects.create(
                staff=staff,
                license_number=practitioner_fields['license_number'],
                specialization=practitioner_fields['specialization'],
                qualification=practitioner_fields['qualification'],
                created_by=self.context['request'].user,
                updated_by=self.context['request'].user
            )

            # Queue FHIR Practitioner creation (async)
            try:
                request_user_id = None
                if self.context.get('request') and getattr(self.context['request'], 'user', None):
                    request_user_id = self.context['request'].user.id
                facility_code = getattr(self.context.get('request'), 'facility_code', None)
                transaction.on_commit(
                    lambda: create_practitioner_in_fhir.delay(
                        str(practitioner_profile.id),
                        address_fields=address_fields,
                        requested_by_user_id=request_user_id,
                        facility_code=facility_code
                    )
                )
            except Exception:
                logger.warning("Failed to queue FHIR practitioner creation")

        try:
            auto_assign_staff_to_department_unit(
                staff,
                facility=facility,
                department_name=validated_data.get('department'),
                department_unit_id=validated_data.get('department_unit_id'),
                assigned_by=getattr(self.context.get('request'), 'user', None),
            )
        except Exception:
            logger.exception(
                "Failed to auto-assign registered staff to department unit",
                extra={'staff_id': str(staff.id)},
            )

        return staff


class PasswordResetRequestSerializer(serializers.Serializer):
    """Serializer for requesting a password reset"""
    email = serializers.EmailField(required=True)


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Serializer for confirming password reset with token"""
    token = serializers.CharField(required=True, min_length=32)
    password = serializers.CharField(required=True, min_length=8, write_only=True)
    password_confirm = serializers.CharField(required=True, write_only=True)

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        return attrs


class AdminForceResetSerializer(serializers.Serializer):
    """Serializer for admin-initiated password reset"""
    user_id = serializers.UUIDField(required=True)


# =============================================================================
# LIST SERIALIZERS - Lightweight serializers for list views
# These reduce payload sizes by 40-70% compared to full serializers
# =============================================================================

class UserListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for user lists.
    Removes detailed profile information.

    Payload reduction: ~30% (7 fields vs 10)
    """
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'email', 'full_name', 'first_name', 'last_name',
            'user_type', 'is_active'
        ]

    def get_full_name(self, obj):
        return obj.get_full_name()


class StaffListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for staff lists.
    Flattens user info instead of nesting full UserSerializer.

    Payload reduction: ~50% (9 fields vs nested user details)
    """
    name = serializers.SerializerMethodField()
    email = serializers.EmailField(source='user.email', read_only=True)
    user_type = serializers.CharField(source='user.user_type', read_only=True)

    class Meta:
        model = Staff
        fields = [
            'id', 'name', 'email', 'user_type', 'employee_id',
            'department', 'position', 'hire_date', 'user'
        ]

    def get_name(self, obj):
        if obj.user:
            return obj.user.get_full_name()
        return None


class StaffSearchSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for staff search results.
    Returns minimal fields for picker UIs.
    """
    name = serializers.SerializerMethodField()
    email = serializers.EmailField(source='user.email', read_only=True)
    user_type = serializers.CharField(source='user.user_type', read_only=True)
    user_id = serializers.UUIDField(source='user.id', read_only=True)
    practitioner_id = serializers.SerializerMethodField()

    class Meta:
        model = Staff
        fields = [
            'id', 'user_id', 'name', 'email', 'user_type',
            'employee_id', 'practitioner_id'
        ]

    def get_name(self, obj):
        if obj.user:
            return obj.user.get_full_name()
        return None

    def get_practitioner_id(self, obj):
        try:
            return obj.practitioner_profile.id
        except Exception:
            return None


class PractitionerProfileListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for practitioner lists.
    Flattens staff/user chain instead of deep nesting.

    Payload reduction: ~60% (9 fields vs deeply nested staff/user)
    """
    name = serializers.SerializerMethodField()
    email = serializers.SerializerMethodField()
    department = serializers.CharField(source='staff.department', read_only=True)
    user_type = serializers.SerializerMethodField()

    class Meta:
        model = PractitionerProfile
        fields = [
            'id', 'name', 'email', 'user_type', 'department',
            'specialization', 'license_number', 'qualification', 'staff'
        ]

    def get_name(self, obj):
        if obj.staff and obj.staff.user:
            return obj.staff.user.get_full_name()
        return None

    def get_email(self, obj):
        if obj.staff and obj.staff.user:
            return obj.staff.user.email
        return None

    def get_user_type(self, obj):
        if obj.staff and obj.staff.user:
            return obj.staff.user.user_type
        return None


class PatientProfileListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for patient lists.
    Includes minimal user_details for frontend compatibility and admission status.

    Payload reduction: ~40% (still lighter than full nested details)
    """
    # Minimal user_details for frontend compatibility (PatientChronicleCard expects this)
    user_details = serializers.SerializerMethodField()
    # Flat convenience fields
    name = serializers.SerializerMethodField()
    email = serializers.EmailField(source='user.email', read_only=True)
    phone = serializers.CharField(source='user.phone_number', read_only=True)
    gender = serializers.CharField(source='user.gender', read_only=True)
    date_of_birth = serializers.DateField(source='user.date_of_birth', read_only=True)
    # Admission status fields
    current_ward = serializers.SerializerMethodField()
    current_ward_id = serializers.SerializerMethodField()
    admission_date = serializers.SerializerMethodField()

    class Meta:
        model = PatientProfile
        fields = [
            'id', 'user', 'user_details', 'name', 'email', 'phone', 'gender',
            'date_of_birth', 'medical_record_number',
            'current_ward', 'current_ward_id', 'admission_date'
        ]

    def get_user_details(self, obj):
        """Return minimal user details for frontend compatibility."""
        if obj.user:
            return {
                'id': str(obj.user.id),
                'first_name': obj.user.first_name,
                'last_name': obj.user.last_name,
                'email': obj.user.email,
                'gender': obj.user.gender,
            }
        return None

    def get_name(self, obj):
        if obj.user:
            return obj.user.get_full_name()
        return None

    def get_current_ward(self, obj):
        """Get the ward name where patient is admitted."""
        # Use prefetched admissions if available
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            admission = next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        else:
            admission = obj.admissions.filter(status__in=['admitted', 'waiting']).first()

        if not admission:
            return None

        if admission.status == 'waiting':
            return "Waiting List"

        if admission.bed:
            return admission.bed.ward.name

        return "Admitted (No Bed)"

    def get_current_ward_id(self, obj):
        """Get the ward ID where patient is admitted."""
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            admission = next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        else:
            admission = obj.admissions.filter(status__in=['admitted', 'waiting']).first()

        if admission and admission.bed:
            return str(admission.bed.ward.id)
        return None

    def get_admission_date(self, obj):
        """Get the admission date if patient is currently admitted."""
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            admission = next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        else:
            admission = obj.admissions.filter(status__in=['admitted', 'waiting']).first()

        if admission:
            return admission.admission_date
        return None


# =============================================================================
# USER PATIENT LIST SERIALIZERS - My Patients feature
# =============================================================================

class UserPatientListSerializer(serializers.ModelSerializer):
    """
    Full serializer for user's personal patient list.
    Includes patient details for display.
    """
    patient_details = PatientProfileListSerializer(source='patient', read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)

    class Meta:
        model = UserPatientList
        fields = [
            'id', 'user', 'patient', 'patient_details', 'patient_name', 'patient_mrn',
            'notes', 'is_pinned', 'added_at'
        ]
        read_only_fields = ['id', 'user', 'added_at']

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None


class UserPatientListCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for adding a patient to user's list.
    Only requires patient ID.
    """
    class Meta:
        model = UserPatientList
        fields = ['patient', 'notes', 'is_pinned']

    def validate_patient(self, value):
        """Ensure patient isn't already in user's list."""
        user = self.context['request'].user
        if UserPatientList.objects.filter(user=user, patient=value).exists():
            raise serializers.ValidationError("This patient is already in your list.")
        return value

    def create(self, validated_data):
        validated_data['user'] = self.context['request'].user
        return super().create(validated_data)


class UserSessionListSerializer(serializers.ModelSerializer):
    is_current = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()

    class Meta:
        model = UserSession
        fields = [
            'id',
            'device_label',
            'ip_address',
            'location',
            'created_at',
            'last_seen_at',
            'expires_at',
            'revoked_at',
            'is_active',
            'is_current',
        ]
        read_only_fields = fields

    def get_location(self, obj):
        """Return formatted location string."""
        parts = []
        if obj.location_city:
            parts.append(obj.location_city)
        if obj.location_country:
            parts.append(obj.location_country)
        return ', '.join(parts) if parts else None

    def get_is_current(self, obj):
        current_session_id = self._get_current_session_id()
        return bool(current_session_id and current_session_id == obj.id)

    def get_is_active(self, obj):
        return obj.is_active

    def _get_current_session_id(self):
        if 'current_session_id' in self.context:
            return self.context.get('current_session_id')

        request = self.context.get('request')
        if not request:
            self.context['current_session_id'] = None
            return None

        from .session_service import get_current_session_from_request
        current_session = get_current_session_from_request(request)
        current_session_id = current_session.id if current_session else None
        self.context['current_session_id'] = current_session_id
        return current_session_id
