from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Staff, PractitionerProfile, PatientProfile, PractitionerFHIRMapping, UserPatientList
from ..fhir_client.client import fhir_client
from ..fhir_client.utils import (
    create_human_name, create_identifier, create_contact_point,
    create_address, generate_fhir_id
)
import random
import string
import datetime
import logging

User = get_user_model()

# Set up logger
logger = logging.getLogger(__name__)


class UserSerializer(serializers.ModelSerializer):
    """
    Serializer for the User model.
    """
    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'phone_number',
                  'date_of_birth', 'gender', 'user_type', 'is_active', 'date_joined']
        read_only_fields = ['id', 'date_joined']


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
                  'is_offsite', 'offsite_mode', 'readonly_message']
        read_only_fields = ['id', 'date_joined']

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
        fields = ['id', 'user', 'user_details', 'medical_record_number', 'nhis_id',
                  'blood_group', 'allergies', 'emergency_contact_name',
                  'emergency_contact_phone', 'emergency_contact_relationship',
                  'fhir_patient_id', 'current_ward', 'current_ward_id',
                  'current_admission_id', 'admission_status', 'admission_date',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']

    def get_current_ward(self, obj):
        """
        Get the name of the ward where the patient is currently admitted.
        Returns "Waiting List" if admitted but no bed, "Not Admitted" otherwise.
        """
        # Use prefetched admissions if available to avoid N+1
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            # Filter in python to use the cache
            # Note: admissions are ordered by -admission_date by default
            admission = next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        else:
            # Fallback to DB query if not prefetched
            admission = obj.admissions.filter(status__in=['admitted', 'waiting']).first()

        if not admission:
            return "Not Admitted"

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
        # Use prefetched admissions if available to avoid N+1
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

    def get_current_admission_id(self, obj):
        """
        Get the ID of the current active admission.
        Returns None if not currently admitted.
        """
        # Use prefetched admissions if available to avoid N+1
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            admission = next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        else:
            admission = obj.admissions.filter(status__in=['admitted', 'waiting']).first()

        if admission:
            return str(admission.id)

        return None

    def get_admission_status(self, obj):
        """
        Get the status of the current admission.
        Returns None if not currently admitted.
        """
        # Use prefetched admissions if available to avoid N+1
        if hasattr(obj, '_prefetched_objects_cache') and 'admissions' in obj._prefetched_objects_cache:
            admission = next(
                (a for a in obj.admissions.all() if a.status in ['admitted', 'waiting']),
                None
            )
        else:
            admission = obj.admissions.filter(status__in=['admitted', 'waiting']).first()

        if admission:
            return admission.status

        return None

    def get_admission_date(self, obj):
        """
        Get the admission date of the patient's current admission.
        Returns None if not currently admitted.
        """
        # Use prefetched admissions if available to avoid N+1
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


class PractitionerFHIRMappingSerializer(serializers.ModelSerializer):
    """
    Serializer for the PractitionerFHIRMapping model.
    """
    practitioner_profile_details = PractitionerProfileSerializer(source='practitioner_profile', read_only=True)

    class Meta:
        model = PractitionerFHIRMapping
        fields = ['id', 'practitioner_profile', 'practitioner_profile_details', 'fhir_practitioner_id',
                  'fhir_resource_version', 'last_synced', 'is_synced',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'last_synced', 'created_at', 'updated_at', 'created_by', 'updated_by']


def generate_unique_employee_id():
    """
    Generate a unique employee ID following a specific pattern.
    Format: EMP-YYYY-NNNNN where YYYY is the current year and NNNNN is a random 5-digit number
    """
    year = datetime.datetime.now().year

    # Try up to 100 times to generate a unique employee ID
    for _ in range(100):
        # Generate a random 5-digit number
        random_digits = ''.join(random.choices(string.digits, k=5))

        # Create the employee ID in the format EMP-YYYY-NNNNN
        employee_id = f"EMP-{year}-{random_digits}"

        # Check if this employee ID already exists
        if not Staff.objects.filter(employee_id=employee_id).exists():
            return employee_id

    # If we couldn't generate a unique employee ID after 100 attempts, raise an exception
    raise Exception("Unable to generate a unique employee ID after multiple attempts.")


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


class StaffRegistrationSerializer(serializers.Serializer):
    """
    Serializer for staff registration that creates both local and FHIR resources.
    A unique password will be generated for the staff and logged (to be sent to the staff).
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
            # Check if this user has an active staff record
            if hasattr(existing_user, 'staff') and existing_user.staff:
                raise serializers.ValidationError({"email": "This email is already in use by an active staff member."})
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
        # Check if we're reusing an existing user
        existing_user = validated_data.pop('_existing_user', None)

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

        # Generate a secure password for the staff
        generated_password = generate_secure_password()

        if existing_user:
            # Reuse and update the existing orphaned user
            user = existing_user
            user.first_name = validated_data['first_name']
            user.last_name = validated_data['last_name']
            user.phone_number = validated_data.get('phone_number', '')
            user.date_of_birth = validated_data['date_of_birth']
            user.user_type = validated_data['user_type']
            user.is_active = True
            user.set_password(generated_password)
            user.save()
        else:
            # Create new User
            user = User.objects.create_user(
                email=validated_data['email'],
                username=validated_data['email'],  # Use email as username
                password=generated_password,
                first_name=validated_data['first_name'],
                last_name=validated_data['last_name'],
                phone_number=validated_data.get('phone_number', ''),
                date_of_birth=validated_data['date_of_birth'],
                user_type=validated_data['user_type']
            )

        # Generate a unique employee ID
        employee_id = generate_unique_employee_id()

        # Create Staff
        staff = Staff.objects.create(
            user=user,
            employee_id=employee_id,
            department=validated_data['department'],
            position=validated_data['position'],
            hire_date=validated_data['hire_date'],
            created_by=self.context['request'].user,
            updated_by=self.context['request'].user
        )

        # Send credentials via email (runs sync in DEBUG mode via CELERY_TASK_ALWAYS_EAGER)
        from .tasks import send_welcome_credentials_email
        try:
            send_welcome_credentials_email.delay(
                user_email=user.email,
                user_name=f"{user.first_name} {user.last_name}",
                password=generated_password,
                employee_id=employee_id,
                department=validated_data['department'],
                position=validated_data['position'],
            )
        except Exception as e:
            logger.error(f"Failed to send welcome email to {user.email}: {e}")

        logger.info(f"Staff account created for {user.email} with employee ID: {employee_id}")

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

            # Create FHIR Practitioner resource
            fhir_practitioner_data = {
                "resourceType": "Practitioner",
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
                        system="http://hospital.example.org/fhir/identifier/employee",
                        value=employee_id
                    ),
                    create_identifier(
                        system="http://hospital.example.org/fhir/identifier/license",
                        value=practitioner_fields['license_number']
                    )
                ]
            }

            # Add telecom if phone number is provided
            if validated_data.get('phone_number'):
                fhir_practitioner_data["telecom"] = [
                    create_contact_point(
                        system="phone",
                        value=validated_data['phone_number'],
                        use="work"
                    )
                ]

            # Add address if provided
            if any(address_fields.values()):
                lines = [address_fields['address_line1']]
                if address_fields['address_line2']:
                    lines.append(address_fields['address_line2'])

                fhir_practitioner_data["address"] = [
                    create_address(
                        line=lines,
                        city=address_fields['city'],
                        state=address_fields['state'],
                        postalCode=address_fields['postal_code'],
                        country=address_fields['country']
                    )
                ]

            # Add qualification
            if practitioner_fields['qualification']:
                fhir_practitioner_data["qualification"] = [
                    {
                        "code": {
                            "text": practitioner_fields['qualification']
                        }
                    }
                ]

            # Create the FHIR resource
            try:
                fhir_practitioner = fhir_client.create_resource("Practitioner", fhir_practitioner_data)

                # Create the mapping
                PractitionerFHIRMapping.objects.create(
                    practitioner_profile=practitioner_profile,
                    fhir_practitioner_id=fhir_practitioner["id"],
                    fhir_resource_version=fhir_practitioner.get("meta", {}).get("versionId"),
                    created_by=self.context['request'].user,
                    updated_by=self.context['request'].user
                )

                # Update the practitioner profile with the FHIR ID
                practitioner_profile.fhir_practitioner_id = fhir_practitioner["id"]
                practitioner_profile.save()

            except Exception as e:
                # If FHIR creation fails, delete the local resources and raise the error
                if practitioner_profile:
                    practitioner_profile.delete()
                staff.delete()
                user.delete()
                raise serializers.ValidationError(f"Failed to create FHIR Practitioner resource: {str(e)}")

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
            'date_of_birth', 'medical_record_number', 'blood_group', 'nhis_id',
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
