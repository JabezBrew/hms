from rest_framework import serializers
import random
import string
import datetime
from .models import (
    PatientFHIRMapping, PatientSearch, RecentPatient,
    PatientRegistrationValidation, PatientNote
)
from ..users.models import PatientProfile, User
from ..users.serializers import PatientProfileSerializer, UserSerializer, generate_secure_password
from ..fhir_client.client import fhir_client
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
        fields = ['id', 'user', 'user_details', 'search_query', 'search_date']
        read_only_fields = ['id', 'search_date']


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

        # Create PatientProfile
        patient_profile = PatientProfile.objects.create(
            user=user,
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

        except Exception as e:
            # If FHIR creation fails, delete the local resources and raise the error
            patient_profile.delete()
            user.delete()
            raise serializers.ValidationError(f"Failed to create FHIR Patient resource: {str(e)}")

        return patient_profile
