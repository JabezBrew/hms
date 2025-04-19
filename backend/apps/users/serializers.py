from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Staff, PractitionerProfile, PatientProfile, PractitionerFHIRMapping
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
                  'date_of_birth', 'user_type', 'is_active', 'date_joined']
        read_only_fields = ['id', 'date_joined']


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

    class Meta:
        model = PatientProfile
        fields = ['id', 'user', 'user_details', 'medical_record_number', 'nhis_id', 
                  'blood_group', 'allergies', 'emergency_contact_name', 
                  'emergency_contact_phone', 'emergency_contact_relationship', 
                  'fhir_patient_id', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


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
        # Check if email is already in use
        if User.objects.filter(email=data['email']).exists():
            raise serializers.ValidationError({"email": "This email is already in use."})

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

        # Create User
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

        # Log the message that would be sent to the staff
        message = f"""
        Dear {user.first_name} {user.last_name},

        Your account has been created in the Hospital Management System.

        Your login credentials are:
        Email: {user.email}
        Password: {generated_password}
        Employee ID: {employee_id}

        Please log in and change your password immediately.

        Best regards,
        Hospital Management Team
        """

        logger.info(f"Staff account created for {user.email}. Message to be sent:\n{message}")

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
