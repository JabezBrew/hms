from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from django.apps import apps
from django.db import transaction
from django.db.models import Q
from .models import Staff, PractitionerProfile, PatientProfile, PractitionerFHIRMapping
from .serializers import (
    UserSerializer, StaffSerializer, PractitionerProfileSerializer, 
    PatientProfileSerializer, UserCreateSerializer, PractitionerFHIRMappingSerializer,
    StaffRegistrationSerializer
)
from .permissions import IsAdminOrSelf, IsAdminOrOwner
from .rbac import (
    IsAdmin, IsDoctor, IsNurse, IsReceptionist, IsLabTechnician,
    IsPharmacist, IsBillingOfficer, IsPatient, setup_groups_and_permissions
)
from ..fhir_client.client import fhir_client

User = get_user_model()

# Initialize RBAC system
def initialize_rbac():
    """
    Initialize the RBAC system by setting up groups and permissions.
    This should be called when the app is ready.
    """
    setup_groups_and_permissions()

# Call initialize_rbac when the app is ready
apps.get_app_config('users').ready = lambda self: initialize_rbac()


class UserViewSet(viewsets.ModelViewSet):
    """
    API endpoint for users.
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        """
        Instantiate and return the list of permissions that this view requires.
        """
        if self.action == 'list':
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        elif self.action == 'create':
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        elif self.action in ['retrieve', 'update', 'partial_update', 'destroy']:
            permission_classes = [permissions.IsAuthenticated, IsAdminOrSelf]
        elif self.action == 'me':
            permission_classes = [permissions.IsAuthenticated]
        else:
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        return UserSerializer

    def get_queryset(self):
        """
        Filter the queryset based on the user's role.
        """
        user = self.request.user
        if user.user_type == 'admin':
            return User.objects.all()
        else:
            # Non-admin users can only see themselves
            return User.objects.filter(id=user.id)

    @action(detail=False, methods=['get'])
    def me(self, request):
        """
        Get the current user's profile.
        """
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def change_password(self, request):
        """
        Change the user's password.
        """
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        user = request.user
        old_password = request.data.get('old_password')
        new_password = request.data.get('new_password')

        if not user.check_password(old_password):
            return Response({'detail': 'Wrong password.'}, status=status.HTTP_400_BAD_REQUEST)

        # Validate the new password
        try:
            validate_password(new_password, user)
        except DjangoValidationError as e:
            return Response({'detail': list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()
        return Response({'detail': 'Password changed successfully.'})


class StaffViewSet(viewsets.ModelViewSet):
    """
    API endpoint for staff members.
    """
    queryset = Staff.objects.all()
    serializer_class = StaffSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        """
        Instantiate and return the list of permissions that this view requires.
        """
        if self.action in ['create', 'register']:
            # Only admins can create staff
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        elif self.action == 'list':
            # Admins, doctors, nurses, and receptionists can view staff list
            permission_classes = [
                permissions.IsAuthenticated,
                (IsAdmin | IsDoctor | IsNurse | IsReceptionist)
            ]
        elif self.action in ['retrieve', 'update', 'partial_update', 'destroy']:
            # Admins can edit any staff, others can only view
            if self.request.method in permissions.SAFE_METHODS:
                permission_classes = [
                    permissions.IsAuthenticated,
                    (IsAdmin | IsDoctor | IsNurse | IsReceptionist)
                ]
            else:
                permission_classes = [permissions.IsAuthenticated, IsAdmin]
        else:
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        """
        Filter the queryset based on the user's role.
        """
        user = self.request.user
        if user.user_type == 'admin':
            return Staff.objects.all()
        elif user.user_type in ['doctor', 'nurse', 'receptionist']:
            # These roles can see all staff but not modify them
            return Staff.objects.all()
        else:
            # Other roles can't see staff
            return Staff.objects.none()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def register(self, request):
        """
        Register a new staff member with FHIR resource creation for practitioners.
        Only admins can create staff members.
        """
        serializer = StaffRegistrationSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                with transaction.atomic():
                    staff = serializer.save()

                    # Return the staff with details
                    return Response(
                        StaffSerializer(staff, context={'request': request}).data,
                        status=status.HTTP_201_CREATED
                    )
            except Exception as e:
                return Response(
                    {"error": f"Failed to register staff: {str(e)}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PractitionerProfileViewSet(viewsets.ModelViewSet):
    """
    API endpoint for practitioner profiles.
    """
    queryset = PractitionerProfile.objects.all()
    serializer_class = PractitionerProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        """
        Instantiate and return the list of permissions that this view requires.
        """
        if self.action == 'create':
            # Only admins can create practitioner profiles
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        elif self.action in ['list', 'search']:
            # Admins, doctors, and nurses can view practitioner list
            permission_classes = [
                permissions.IsAuthenticated,
                IsAdmin | IsDoctor | IsNurse
            ]
        elif self.action in ['retrieve', 'update', 'partial_update', 'destroy']:
            # Admins can edit any practitioner, others can only view
            if self.request.method in permissions.SAFE_METHODS:
                permission_classes = [
                    permissions.IsAuthenticated,
                    IsAdmin | IsDoctor | IsNurse
                ]
            else:
                permission_classes = [permissions.IsAuthenticated, IsAdmin]
        else:
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        """
        Filter the queryset based on the user's role.
        """
        user = self.request.user
        if user.user_type == 'admin':
            return PractitionerProfile.objects.all()
        elif user.user_type in ['doctor', 'nurse']:
            # These roles can see all practitioners but not modify them
            return PractitionerProfile.objects.all()
        else:
            # Other roles can't see practitioners
            return PractitionerProfile.objects.none()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        Search for practitioners by name, employee number, or license number.
        Optional parameter 'doctors_only=true' to filter for doctors only.
        """
        query = request.query_params.get('q', '')
        doctors_only = request.query_params.get('doctors_only', '').lower() == 'true'

        if not query or len(query) < 2:
            return Response({"detail": "Search query must be at least 2 characters long."}, 
                           status=status.HTTP_400_BAD_REQUEST)

        try:
            # First, try to search in local database
            local_practitioners = []
            queryset = self.get_queryset()

            # Filter for doctors only if requested
            if doctors_only:
                queryset = queryset.filter(staff__user__user_type='doctor')

            # Search by name (first name or last name)
            name_results = queryset.filter(
                Q(staff__user__first_name__icontains=query) | 
                Q(staff__user__last_name__icontains=query)
            )

            # Search by employee number
            employee_results = queryset.filter(staff__employee_id__icontains=query)

            # Search by license number
            license_results = queryset.filter(license_number__icontains=query)

            # Combine results (avoiding duplicates)
            combined_results = name_results.union(employee_results, license_results)

            # Format local results
            for practitioner in combined_results:
                local_practitioners.append({
                    "fhir_resource": fhir_client.get_resource("Practitioner", practitioner.fhir_practitioner_id) if practitioner.fhir_practitioner_id else None,
                    "local_data": self.get_serializer(practitioner).data
                })

            # If we found local practitioners, return them
            if local_practitioners:
                return Response({
                    "query": query,
                    "total": len(local_practitioners),
                    "practitioners": local_practitioners
                })

            # If no local practitioners found, search in FHIR
            search_params = {
                "name": query,
                "_sort": "family",
                "_count": 10
            }

            # Also search by identifier (employee ID or license number)
            identifier_search_params = {
                "identifier": query,
                "_sort": "family",
                "_count": 10
            }

            # Try name search first
            fhir_results = fhir_client.search_resources("Practitioner", search_params)

            # If no results, try identifier search
            if "entry" not in fhir_results or len(fhir_results.get("entry", [])) == 0:
                fhir_results = fhir_client.search_resources("Practitioner", identifier_search_params)

            # Process results
            practitioners = []

            if "entry" in fhir_results:
                for entry in fhir_results["entry"]:
                    resource = entry.get("resource", {})

                    # Try to find the local mapping
                    try:
                        mapping = PractitionerFHIRMapping.objects.get(fhir_practitioner_id=resource.get("id"))

                        # Include local data
                        practitioners.append({
                            "fhir_resource": resource,
                            "local_data": self.get_serializer(mapping.practitioner_profile).data
                        })
                    except PractitionerFHIRMapping.DoesNotExist:
                        # Just include FHIR data
                        practitioners.append({
                            "fhir_resource": resource,
                            "local_data": None
                        })

            return Response({
                "query": query,
                "total": fhir_results.get("total", 0),
                "practitioners": practitioners
            })

        except Exception as e:
            return Response(
                {"error": f"Failed to search practitioners: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PractitionerFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for practitioner FHIR mappings.
    """
    queryset = PractitionerFHIRMapping.objects.all()
    serializer_class = PractitionerFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def sync_with_fhir(self, request, pk=None):
        """
        Sync the local practitioner data with the FHIR resource.
        """
        mapping = self.get_object()

        try:
            # Get the FHIR resource
            fhir_practitioner = fhir_client.get_resource("Practitioner", mapping.fhir_practitioner_id)

            # Update the mapping with the latest version
            mapping.fhir_resource_version = fhir_practitioner.get("meta", {}).get("versionId")
            mapping.is_synced = True
            mapping.save()

            return Response({
                "message": "Successfully synced with FHIR resource.",
                "fhir_practitioner": fhir_practitioner
            })

        except Exception as e:
            mapping.is_synced = False
            mapping.save()

            return Response(
                {"error": f"Failed to sync with FHIR resource: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PatientProfileViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient profiles.
    """
    queryset = PatientProfile.objects.all()
    serializer_class = PatientProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        """
        Instantiate and return the list of permissions that this view requires.
        """
        if self.action == 'create':
            # Admins, doctors, nurses, and receptionists can create patients
            permission_classes = [
                permissions.IsAuthenticated,
                IsAdmin | IsDoctor | IsNurse | IsReceptionist
            ]
        elif self.action == 'list':
            # All roles except patients can view patient list
            permission_classes = [
                permissions.IsAuthenticated,
                IsAdmin | IsDoctor | IsNurse | IsReceptionist | IsLabTechnician | IsPharmacist | IsBillingOfficer
            ]
        elif self.action in ['retrieve', 'update', 'partial_update', 'destroy']:
            if self.request.method in permissions.SAFE_METHODS:
                # All roles can view patient details
                permission_classes = [permissions.IsAuthenticated]
            else:
                # Only admins, doctors, and nurses can edit patients
                permission_classes = [
                    permissions.IsAuthenticated,
                    IsAdmin | IsDoctor | IsNurse
                ]
        else:
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        """
        Filter the queryset based on the user's role.
        """
        user = self.request.user

        # Patients can only see their own profile
        if user.user_type == 'patient':
            try:
                patient_profile = PatientProfile.objects.get(user=user)
                return PatientProfile.objects.filter(id=patient_profile.id)
            except PatientProfile.DoesNotExist:
                return PatientProfile.objects.none()

        # Doctors can see their patients
        elif user.user_type == 'doctor':
            # In a real implementation, this would filter based on doctor-patient relationships
            # For simplicity, we're allowing doctors to see all patients
            return PatientProfile.objects.all()

        # Admin, nurse, receptionist, lab tech, pharmacist, billing can see all patients
        elif user.user_type in ['admin', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing']:
            return PatientProfile.objects.all()

        # Other roles can't see patients
        else:
            return PatientProfile.objects.none()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
