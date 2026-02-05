import re
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from django.contrib.auth import get_user_model
from django.apps import apps
from django.db import transaction
from django.db.models import Q
from django.core.cache import cache
import hashlib
import logging
from django.utils import timezone
from .models import Staff, PractitionerProfile, PatientProfile, PractitionerFHIRMapping, UserPatientList, UserSession
from .serializers import (
    UserSerializer, UserListSerializer, UserCreateSerializer,
    UserWithAccessContextSerializer,
    StaffSerializer, StaffListSerializer, StaffRegistrationSerializer,
    StaffSearchSerializer,
    StaffInviteSerializer,
    PractitionerProfileSerializer, PractitionerProfileListSerializer,
    PatientProfileSerializer, PatientProfileListSerializer,
    PractitionerFHIRMappingSerializer, PractitionerFHIRMappingListSerializer,
    UserPatientListSerializer, UserPatientListCreateSerializer,
    UserSessionListSerializer
)
from .permissions import IsAdminOrSelf, IsAdminOrOwner
from .session_service import get_current_session_from_request, revoke_session, revoke_sessions_for_user
from .rbac import (
    IsAdmin, IsDoctor, IsNurse, IsReceptionist, IsLabTechnician,
    IsPharmacist, IsBillingOfficer, IsPatient, IsClinicalProvider,
    setup_groups_and_permissions
)
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import FacilityScopedPermission, check_demographics_access, get_user_facility
from apps.core.cache_utils import facility_cache_key
from .tasks import fetch_practitioner_fhir_snapshot, search_practitioners_in_fhir

User = get_user_model()
logger = logging.getLogger(__name__)


# Initialize RBAC system
def initialize_rbac():
    """
    Initialize the RBAC system by setting up groups and permissions.
    This should be called when the app is ready.
    """
    setup_groups_and_permissions(using='default')

# Call initialize_rbac when the app is ready
apps.get_app_config('users').ready = lambda self: initialize_rbac()


class UserViewSet(viewsets.ModelViewSet):
    """
    API endpoint for users.
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination

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
        elif self.action in ['me', 'change_password']:
            permission_classes = [permissions.IsAuthenticated]
        else:
            permission_classes = [permissions.IsAuthenticated, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        elif self.action == 'list':
            return UserListSerializer
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
        Get the current user's profile with access context.
        Includes off-site status and read-only mode information.
        """
        serializer = UserWithAccessContextSerializer(request.user, context={'request': request})
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


class UserSessionViewSet(viewsets.GenericViewSet):
    """
    API endpoint for managing user sessions.
    """
    serializer_class = UserSessionListSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        user = self.request.user
        include_revoked = str(self.request.query_params.get('include_revoked', '')).lower() == 'true'
        base_qs = UserSession.objects.select_related('user', 'revoked_by').order_by('-last_seen_at')

        # Filter by user
        if user.user_type == 'admin':
            user_id = self.request.query_params.get('user_id')
            if user_id:
                base_qs = base_qs.filter(user_id=user_id)
            elif self.action == 'list':
                # Admin viewing their own sessions (no user_id specified)
                base_qs = base_qs.filter(user=user)
        else:
            base_qs = base_qs.filter(user=user)

        # Filter out revoked/expired sessions unless explicitly requested
        if not include_revoked:
            base_qs = base_qs.filter(revoked_at__isnull=True, expires_at__gt=timezone.now())

        return base_qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        current_session = get_current_session_from_request(request)
        current_session_id = current_session.id if current_session else None
        serializer_context = {'request': request, 'current_session_id': current_session_id}
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True, context=serializer_context)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True, context=serializer_context)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        session = self.get_object()
        if request.user.user_type != 'admin' and session.user_id != request.user.id:
            raise PermissionDenied("Not authorized to revoke this session.")
        revoke_session(session, revoked_by=request.user if request.user.user_type == 'admin' else None)
        return Response({'detail': 'Session revoked.'})

    @action(detail=False, methods=['post'])
    def revoke_all(self, request):
        target_user = request.user
        if request.user.user_type == 'admin':
            user_id = request.data.get('user_id')
            if user_id:
                target_user = User.objects.filter(id=user_id).first()
                if not target_user:
                    return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        elif request.data.get('user_id'):
            raise PermissionDenied("Not authorized to revoke other users' sessions.")

        exclude_current = bool(request.data.get('exclude_current', True))
        exclude_session_id = None
        if exclude_current and target_user == request.user:
            # Use the improved session lookup that handles stale JTIs
            current_session = get_current_session_from_request(request)
            if current_session:
                exclude_session_id = current_session.id

        revoked_count = revoke_sessions_for_user(
            target_user,
            revoked_by=request.user if request.user.user_type == 'admin' else None,
            exclude_session_id=exclude_session_id,
        )
        return Response({'detail': 'Sessions revoked.', 'revoked_count': revoked_count})


class StaffViewSet(viewsets.ModelViewSet):
    """
    API endpoint for staff members.
    """
    queryset = Staff.objects.all()
    serializer_class = StaffSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return StaffListSerializer
        return StaffSerializer

    def get_permissions(self):
        """
        Instantiate and return the list of permissions that this view requires.
        """
        if self.action in ['create', 'register']:
            # Only admins can create staff
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        elif self.action in ['list', 'search']:
            # Admins, doctors, nurses, and receptionists can view staff list
            permission_classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                (IsAdmin | IsDoctor | IsNurse | IsReceptionist)
            ]
        elif self.action in ['retrieve', 'update', 'partial_update', 'destroy']:
            # Admins can edit any staff, others can only view
            if self.request.method in permissions.SAFE_METHODS:
                permission_classes = [
                    permissions.IsAuthenticated,
                    FacilityScopedPermission,
                    (IsAdmin | IsDoctor | IsNurse | IsReceptionist)
                ]
            else:
                permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        else:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        """
        Filter the queryset based on the user's role.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return Staff.objects.none()

        user = self.request.user
        base_qs = Staff.objects.select_related('user').filter(primary_facility=facility)

        if user.user_type in ['admin', 'doctor', 'nurse', 'receptionist']:
            # These roles can see staff in their facility
            return base_qs
        return Staff.objects.none()

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            primary_facility=facility
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        Search staff by name or employee ID (prefix).
        Supports optional filters:
        - practitioners_only=true
        - staff_kind=clinical|ops
        - user_type=doctor,nurse
        - include_inactive=true
        """
        query = (request.query_params.get('q') or '').strip()
        if not query or len(query) < 2:
            return Response(
                {"detail": "Search query must be at least 2 characters long."},
                status=status.HTTP_400_BAD_REQUEST
            )

        include_inactive = request.query_params.get('include_inactive') == 'true'
        practitioners_only = request.query_params.get('practitioners_only') == 'true'
        staff_kind = (request.query_params.get('staff_kind') or '').lower()
        non_practitioners_only = False
        user_type_param = request.query_params.get('user_type')

        queryset = self.get_queryset().select_related('user', 'practitioner_profile')

        if not include_inactive:
            queryset = queryset.filter(user__is_active=True)

        if staff_kind == 'clinical':
            practitioners_only = True
        elif staff_kind == 'ops':
            non_practitioners_only = True

        if practitioners_only:
            queryset = queryset.filter(practitioner_profile__isnull=False)
        elif non_practitioners_only:
            queryset = queryset.filter(practitioner_profile__isnull=True)

        if user_type_param:
            user_types = [t.strip() for t in user_type_param.split(',') if t.strip()]
            if user_types:
                queryset = queryset.filter(user__user_type__in=user_types)

        normalized_query = (
            query
            .replace('\u2013', '-')
            .replace('\u2014', '-')
            .replace('\u2212', '-')
        )
        is_id_query = bool(re.fullmatch(r"[A-Za-z0-9\-]+", normalized_query)) and any(
            char.isdigit() for char in normalized_query
        )

        if is_id_query:
            queryset = queryset.filter(employee_id__istartswith=normalized_query)
            queryset = queryset.order_by('employee_id')
        else:
            tokens = [token for token in normalized_query.split() if token]
            if len(tokens) >= 2:
                first, second = tokens[0], tokens[1]
                queryset = queryset.filter(
                    Q(user__first_name__icontains=first, user__last_name__icontains=second) |
                    Q(user__first_name__icontains=second, user__last_name__icontains=first)
                )
            else:
                token = tokens[0] if tokens else normalized_query
                queryset = queryset.filter(
                    Q(user__first_name__icontains=token) |
                    Q(user__last_name__icontains=token)
                )
            queryset = queryset.order_by('user__last_name', 'user__first_name')

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = StaffSearchSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        serializer = StaffSearchSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

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
                logger.error(f"Failed to register staff: {str(e)}")
                return Response(
                    {"error": "Failed to register staff. Please try again."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='invite')
    def invite(self, request):
        """
        Invite a staff user without setting a known password.

        Creates/updates the user + staff profile and sends a password reset link email.
        This avoids emailing plaintext passwords.
        """
        from .models import PasswordResetToken
        from .tasks import send_password_reset_email, send_account_setup_email
        from django.conf import settings

        serializer = StaffInviteSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            staff = serializer.save()

            # Generate reset token and email link (admin-initiated)
            plain_token, _ = PasswordResetToken.create_for_user(
                user=staff.user,
                reset_type='admin_force',
                initiated_by=request.user,
                expiry_minutes=getattr(settings, 'PASSWORD_RESET_TOKEN_EXPIRY_MINUTES', 15),
            )

            # First-time creation gets a clearer "set up your password" message.
            if getattr(staff, '_user_created', False):
                send_account_setup_email.delay(
                    user_id=str(staff.user.id),
                    token=plain_token,
                    user_email=staff.user.email,
                    user_name=staff.user.get_full_name() or staff.user.email,
                )
            else:
                send_password_reset_email.delay(
                    user_id=str(staff.user.id),
                    token=plain_token,
                    user_email=staff.user.email,
                    user_name=staff.user.get_full_name() or staff.user.email,
                )

        return Response(StaffSerializer(staff, context={'request': request}).data, status=status.HTTP_201_CREATED)


class PractitionerProfileViewSet(viewsets.ModelViewSet):
    """
    API endpoint for practitioner profiles.
    """
    queryset = PractitionerProfile.objects.all()
    serializer_class = PractitionerProfileSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return PractitionerProfileListSerializer
        return PractitionerProfileSerializer

    def get_permissions(self):
        """
        Instantiate and return the list of permissions that this view requires.
        """
        if self.action == 'create':
            # Only admins can create practitioner profiles
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        elif self.action in ['list', 'search']:
            # Clinical and support staff can view practitioner list
            permission_classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                IsAdmin | IsDoctor | IsNurse | IsReceptionist | IsLabTechnician | IsPharmacist
            ]
        elif self.action in ['retrieve', 'update', 'partial_update', 'destroy']:
            # Admins can edit any practitioner, others can only view
            if self.request.method in permissions.SAFE_METHODS:
                permission_classes = [
                    permissions.IsAuthenticated,
                    FacilityScopedPermission,
                    IsAdmin | IsDoctor | IsNurse | IsReceptionist | IsLabTechnician | IsPharmacist
                ]
            else:
                permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        else:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        """
        Filter the queryset based on the user's role and query parameters.
        """
        facility = get_user_facility(self.request)
        if not facility:
            return PractitionerProfile.objects.none()

        user = self.request.user
        base_qs = PractitionerProfile.objects.select_related(
            'staff',
            'staff__user'
        ).filter(staff__primary_facility=facility)

        if user.user_type in ['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist']:
            queryset = base_qs
        else:
            return PractitionerProfile.objects.none()

        # Filter by user_type (e.g., ?user_type=doctor to get only doctors)
        user_type_filter = self.request.query_params.get('user_type')
        if user_type_filter:
            queryset = queryset.filter(staff__user__user_type=user_type_filter)

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        staff = serializer.validated_data.get('staff')
        if staff and staff.primary_facility_id and staff.primary_facility_id != facility.id:
            raise PermissionDenied("Staff does not belong to the active facility.")
        if staff and staff.primary_facility_id is None:
            staff.primary_facility = facility
            staff.save(update_fields=['primary_facility'])
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
        allow_fhir = request.user.user_type in ['admin', 'doctor', 'nurse']

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
                fhir_resource = None
                if allow_fhir and practitioner.fhir_practitioner_id:
                    cache_key = facility_cache_key(f'fhir_practitioner_snapshot_{practitioner.id}')
                    fhir_resource = cache.get(cache_key)
                    if fhir_resource is None:
                        fetch_practitioner_fhir_snapshot.delay(
                            str(practitioner.id),
                            practitioner.fhir_practitioner_id,
                            facility_code=getattr(request, 'facility_code', None)
                        )
                local_practitioners.append({
                    "fhir_resource": fhir_resource,
                    "local_data": self.get_serializer(practitioner).data
                })

            # If we found local practitioners, return them
            if local_practitioners:
                return Response({
                    "query": query,
                    "total": len(local_practitioners),
                    "practitioners": local_practitioners
                })

            # If no local practitioners found, search in FHIR (clinical only)
            if not allow_fhir:
                return Response({
                    "query": query,
                    "total": 0,
                    "practitioners": [],
                    "fhir_status": "forbidden"
                })

            cache_key = facility_cache_key(
                f'fhir_practitioner_search_{request.user.id}_{hashlib.md5(query.encode()).hexdigest()}'
            )
            cached = cache.get(cache_key)
            if cached is not None:
                return Response({
                    "query": query,
                    "total": len(cached),
                    "practitioners": cached,
                    "fhir_status": "available"
                })

            search_practitioners_in_fhir.delay(
                query,
                str(request.user.id),
                facility_code=getattr(request, 'facility_code', None)
            )

            return Response({
                "query": query,
                "total": 0,
                "practitioners": [],
                "fhir_status": "pending"
            })

        except Exception as e:
            logger.error(f"Failed to search practitioners: {str(e)}")
            return Response(
                {"error": "Failed to search practitioners. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PractitionerFHIRMappingViewSet(viewsets.ModelViewSet):
    """
    API endpoint for practitioner FHIR mappings.
    """
    queryset = PractitionerFHIRMapping.objects.all()
    serializer_class = PractitionerFHIRMappingSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return PractitionerFHIRMappingListSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PractitionerFHIRMapping.objects.none()
        return PractitionerFHIRMapping.objects.select_related(
            'practitioner_profile',
            'practitioner_profile__staff'
        ).filter(practitioner_profile__staff__primary_facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        practitioner_profile = serializer.validated_data.get('practitioner_profile')
        staff = getattr(practitioner_profile, 'staff', None)
        if staff and staff.primary_facility_id and staff.primary_facility_id != facility.id:
            raise PermissionDenied("Practitioner does not belong to the active facility.")
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
            fetch_practitioner_fhir_snapshot.delay(
                str(mapping.practitioner_profile_id),
                mapping.fhir_practitioner_id,
                facility_code=getattr(request, 'facility_code', None)
            )
            return Response({
                "message": "FHIR sync queued.",
                "fhir_status": "queued"
            }, status=status.HTTP_202_ACCEPTED)

        except Exception:
            logger.error("Failed to queue FHIR sync")
            return Response(
                {"error": "Failed to queue FHIR sync."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PatientProfileViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient profiles.
    Shows most recently registered patients first with pagination.
    Includes current ward information in each patient record.
    """
    queryset = PatientProfile.objects.select_related('user').prefetch_related(
        'admissions',
        'admissions__bed',
        'admissions__bed__ward'
    ).order_by('-created_at')
    serializer_class = PatientProfileSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return PatientProfileListSerializer
        return PatientProfileSerializer

    def get_permissions(self):
        """
        Instantiate and return the list of permissions that this view requires.
        """
        if self.action == 'create':
            # Admins, doctors, nurses, and receptionists can create patients
            permission_classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                IsAdmin | IsDoctor | IsNurse | IsReceptionist
            ]
        elif self.action == 'list':
            # All roles except patients can view patient list
            permission_classes = [
                permissions.IsAuthenticated,
                FacilityScopedPermission,
                IsAdmin | IsDoctor | IsNurse | IsReceptionist | IsLabTechnician | IsPharmacist | IsBillingOfficer
            ]
        elif self.action in ['retrieve', 'update', 'partial_update', 'destroy']:
            if self.request.method in permissions.SAFE_METHODS:
                # All roles can view patient details
                permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission]
            else:
                # Only admins, doctors, and nurses can edit patients
                permission_classes = [
                    permissions.IsAuthenticated,
                    FacilityScopedPermission,
                    IsAdmin | IsDoctor | IsNurse
                ]
        else:
            permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        """
        Filter the queryset based on the user's role.
        Returns patients ordered by most recently registered first.
        Includes current ward information via prefetched admissions.
        """
        user = self.request.user
        facility = get_user_facility(self.request)
        if not facility:
            return PatientProfile.objects.none()

        # Base queryset with optimization and ordering
        base_qs = PatientProfile.objects.select_related('user').prefetch_related(
            'admissions',
            'admissions__bed',
            'admissions__bed__ward'
        ).filter(
            facility=facility
        ).order_by('-created_at')

        # Patients can only see their own profile
        if user.user_type == 'patient':
            try:
                patient_profile = PatientProfile.objects.get(user=user)
                return base_qs.filter(id=patient_profile.id)
            except PatientProfile.DoesNotExist:
                return PatientProfile.objects.none()

        # Doctors can see their patients
        elif user.user_type == 'doctor':
            # In a real implementation, this would filter based on doctor-patient relationships
            # For simplicity, we're allowing doctors to see all patients
            return base_qs

        # Admin, nurse, receptionist, lab tech, pharmacist, billing can see all patients
        elif user.user_type in ['admin', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing']:
            return base_qs

        # Other roles can't see patients
        else:
            return PatientProfile.objects.none()

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            facility=facility
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class UserPatientListViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing user's personal patient list (My Patients).
    Each user can maintain their own list of patients for quick access.
    Only clinical providers (doctors, nurses, lab technicians, pharmacists) can access this feature.
    """
    serializer_class = UserPatientListSerializer
    permission_classes = [permissions.IsAuthenticated, FacilityScopedPermission, IsClinicalProvider]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        """Return only the current user's patient list."""
        facility = get_user_facility(self.request)
        if not facility:
            return UserPatientList.objects.none()
        return UserPatientList.objects.filter(
            user=self.request.user,
            patient__facility=facility
        ).select_related(
            'patient',
            'patient__user'
        ).prefetch_related(
            'patient__admissions',
            'patient__admissions__bed',
            'patient__admissions__bed__ward'
        )

    def get_serializer_class(self):
        if self.action == 'create':
            return UserPatientListCreateSerializer
        return UserPatientListSerializer

    def perform_create(self, serializer):
        """Set the user when creating a new list entry."""
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if patient:
            check_demographics_access(self.request.user, patient)
        serializer.save(user=self.request.user)

    @action(detail=True, methods=['post'])
    def toggle_pin(self, request, pk=None):
        """Toggle the pinned status of a patient in the list."""
        list_entry = self.get_object()
        list_entry.is_pinned = not list_entry.is_pinned
        list_entry.save(update_fields=['is_pinned'])
        return Response({
            'id': str(list_entry.id),
            'is_pinned': list_entry.is_pinned,
            'message': 'Pinned' if list_entry.is_pinned else 'Unpinned'
        })

    @action(detail=True, methods=['patch'])
    def update_notes(self, request, pk=None):
        """Update the notes for a patient in the list."""
        list_entry = self.get_object()
        notes = request.data.get('notes', '')
        list_entry.notes = notes
        list_entry.save(update_fields=['notes'])
        return Response({
            'id': str(list_entry.id),
            'notes': list_entry.notes
        })

    @action(detail=False, methods=['post'])
    def add_patient(self, request):
        """
        Add a patient to the user's list.
        Accepts patient_id in the request body.
        """
        patient_id = request.data.get('patient_id')
        if not patient_id:
            return Response(
                {'error': 'patient_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            patient = PatientProfile.objects.get(id=patient_id)
            facility = get_user_facility(request)
            if not facility or patient.facility_id != facility.id:
                raise PermissionDenied("Patient does not belong to the active facility.")
            check_demographics_access(request.user, patient)
        except PatientProfile.DoesNotExist:
            return Response(
                {'error': 'Patient not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Check if already in list
        if UserPatientList.objects.filter(user=request.user, patient=patient).exists():
            return Response(
                {'error': 'Patient is already in your list'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Create the list entry
        list_entry = UserPatientList.objects.create(
            user=request.user,
            patient=patient,
            notes=request.data.get('notes', ''),
            is_pinned=request.data.get('is_pinned', False)
        )

        serializer = UserPatientListSerializer(list_entry)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['delete'])
    def remove_patient(self, request):
        """
        Remove a patient from the user's list by patient_id.
        Accepts patient_id as query parameter.
        """
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {'error': 'patient_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = PatientProfile.objects.filter(id=patient_id).first()
        if not patient:
            return Response(
                {'error': 'Patient not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_demographics_access(request.user, patient)

        deleted_count, _ = UserPatientList.objects.filter(
            user=request.user,
            patient_id=patient_id,
            patient__facility=facility
        ).delete()

        if deleted_count == 0:
            return Response(
                {'error': 'Patient not in your list'},
                status=status.HTTP_404_NOT_FOUND
            )

        return Response(
            {'message': 'Patient removed from list'},
            status=status.HTTP_200_OK
        )

    @action(detail=False, methods=['get'])
    def check_patient(self, request):
        """
        Check if a patient is in the user's list.
        Accepts patient_id as query parameter.
        """
        patient_id = request.query_params.get('patient_id')
        if not patient_id:
            return Response(
                {'error': 'patient_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = PatientProfile.objects.filter(id=patient_id).first()
        if not patient:
            return Response(
                {'error': 'Patient not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        if patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        check_demographics_access(request.user, patient)

        exists = UserPatientList.objects.filter(
            user=request.user,
            patient_id=patient_id,
            patient__facility=facility
        ).exists()

        return Response({'in_list': exists})
