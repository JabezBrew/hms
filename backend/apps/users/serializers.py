from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Staff, PractitionerProfile, PatientProfile

User = get_user_model()


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