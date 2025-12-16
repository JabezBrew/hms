from django.utils import timezone
from .models import AuditLog, AuditAction, AuditCategory
from .tasks import log_audit_async


class AuditService:
    @staticmethod
    def log(
        request,
        action,
        category,
        resource_type,
        resource_id,
        description,
        user=None,
        resource_name=None,
        changes=None,
    ):
        """
        Create an audit log entry asynchronously.
        """
        if not user and request:
            user = getattr(request, 'user', None)
            if user and not user.is_authenticated:
                user = None

        user_id = str(user.id) if user else None
        user_email = user.email if user else None
        user_type = getattr(user, 'user_type', 'unknown') if user else None

        # Get IP and User Agent safely
        ip_address = None
        user_agent = None

        if request:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_address = x_forwarded_for.split(',')[0]
            else:
                ip_address = request.META.get('REMOTE_ADDR')

            user_agent = request.META.get('HTTP_USER_AGENT', '')[:255]

        # Dispatch async task
        log_audit_async.delay(
            user_id=user_id,
            action=action,
            category=category,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id else None,
            description=description,
            ip_address=ip_address,
            user_agent=user_agent,
            user_email=user_email,
            user_type=user_type,
            resource_name=resource_name,
            changes=changes,
        )

    @staticmethod
    def log_authentication(request, action, user=None, email=None, details=None):
        """
        Log authentication events (login/logout/failed) asynchronously.

        Args:
            request: The HTTP request object
            action: AuditAction (LOGIN, LOGOUT, LOGIN_FAILED, OFFSITE_ACCESS)
            user: The user object (for successful auth events)
            email: Email address (for failed login attempts where user may not exist)
            details: Additional details to append to description
        """
        # Build description based on action
        if action == AuditAction.LOGIN:
            user_identifier = user.email if user else email or 'unknown'
            description = f"User {user_identifier} logged in successfully"
        elif action == AuditAction.LOGOUT:
            user_identifier = user.email if user else email or 'unknown'
            description = f"User {user_identifier} logged out"
        elif action == AuditAction.LOGIN_FAILED:
            user_identifier = email or 'unknown'
            description = f"Failed login attempt for {user_identifier}"
        elif action == AuditAction.OFFSITE_ACCESS:
            user_identifier = user.email if user else email or 'unknown'
            description = f"User {user_identifier} accessed from off-site location"
        else:
            user_identifier = user.email if user else email or 'unknown'
            description = f"Authentication event for {user_identifier}"

        if details:
            description += f". {details}"

        # Get request details
        ip_address = None
        user_agent = None

        if request:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_address = x_forwarded_for.split(',')[0]
            else:
                ip_address = request.META.get('REMOTE_ADDR')

            user_agent = request.META.get('HTTP_USER_AGENT', '')[:255]

        # Get user details
        user_id = str(user.id) if user else None
        user_email = user.email if user else email
        user_type = getattr(user, 'user_type', 'unknown') if user else 'unknown'

        log_audit_async.delay(
            user_id=user_id,
            action=action,
            category=AuditCategory.AUTHENTICATION,
            resource_type='User',
            resource_id=user_id,
            description=description,
            ip_address=ip_address,
            user_agent=user_agent,
            user_email=user_email,
            user_type=user_type,
            resource_name=user_email,
        )

    @classmethod
    def log_model_change(cls, request, instance, action, changes=None, category=None):
        """
        Log model create/update/delete operations.

        Args:
            request: Django request object
            instance: Model instance that was changed
            action: CREATE, UPDATE, or DELETE
            changes: Dict of field changes for UPDATE
            category: Override category (defaults based on model type)
        """
        model_name = instance.__class__.__name__

        # Determine category based on model
        if category is None:
            category = cls._get_category_for_model(model_name)

        # Get resource name
        resource_name = str(instance)[:255]

        # Build description
        description = cls._build_description(action, model_name, resource_name)

        return cls.log(
            request=request,
            action=action,
            category=category,
            resource_type=model_name,
            resource_id=str(instance.pk),
            resource_name=resource_name,
            description=description,
            changes=changes,
        )

    @classmethod
    def get_client_ip(cls, request):
        """
        Extract the real client IP address from the request.
        Handles X-Forwarded-For header for proxied requests.
        """
        if not request:
            return None

        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip

    @classmethod
    def _build_description(cls, action, resource_type, resource_name, user_email=None):
        """Build a human-readable description."""
        action_verbs = {
            AuditAction.CREATE: 'created',
            AuditAction.UPDATE: 'updated',
            AuditAction.DELETE: 'deleted',
            AuditAction.READ: 'viewed',
            AuditAction.NOTE_CREATE: 'created note for',
            AuditAction.NOTE_UPDATE: 'updated note for',
            AuditAction.NOTE_DELETE: 'deleted note for',
            AuditAction.ORDER_CREATE: 'created order for',
            AuditAction.ADMISSION: 'admitted',
            AuditAction.DISCHARGE: 'discharged',
            AuditAction.TRANSFER: 'transferred',
            AuditAction.CANCEL: 'cancelled',
            AuditAction.CHECK_IN: 'checked in',
            AuditAction.USER_CREATE: 'created user',
            AuditAction.USER_UPDATE: 'updated user',
            AuditAction.ROLE_CHANGE: 'changed role for',
        }

        verb = action_verbs.get(action, action.lower())

        if resource_name:
            return f"{verb.capitalize()} {resource_type}: {resource_name}"
        else:
            return f"{verb.capitalize()} {resource_type}"

    @classmethod
    def _get_category_for_model(cls, model_name):
        """Determine audit category based on model name."""
        model_categories = {
            'Patient': AuditCategory.PATIENT,
            'PatientProfile': AuditCategory.PATIENT,
            'Encounter': AuditCategory.ENCOUNTER,
            'NoteEntry': AuditCategory.CLINICAL,
            'NoteTemplate': AuditCategory.CLINICAL,
            'Prescription': AuditCategory.CLINICAL,
            'LabOrder': AuditCategory.CLINICAL,
            'User': AuditCategory.ADMIN,
            'Staff': AuditCategory.ADMIN,
            'PractitionerProfile': AuditCategory.ADMIN,
            'Ward': AuditCategory.WARD,
            'Admission': AuditCategory.WARD,
            'Bed': AuditCategory.WARD,
            'Appointment': AuditCategory.APPOINTMENT,
            'FluidBalance': AuditCategory.NURSING,
            'VitalSigns': AuditCategory.VITALS,
            'NursingTask': AuditCategory.NURSING,
            'MedicationAdministration': AuditCategory.NURSING,
        }

        return model_categories.get(model_name, AuditCategory.ADMIN)

    @classmethod
    def log_fluid_balance(cls, request, instance, action, changes=None):
        """
        Log fluid balance recording actions.

        Args:
            request: Django request object
            instance: FluidBalance instance
            action: FLUID_INTAKE_RECORD, FLUID_OUTPUT_RECORD, FLUID_BALANCE_UPDATE, or FLUID_BALANCE_DELETE
            changes: Dict of field changes for updates
        """
        patient_name = instance.patient.user.get_full_name() if instance.patient else 'Unknown'
        entry_type = instance.entry_type
        volume = instance.volume_ml
        category = instance.category

        if action == AuditAction.FLUID_INTAKE_RECORD:
            description = f"Recorded {volume}ml {category} intake for {patient_name}"
        elif action == AuditAction.FLUID_OUTPUT_RECORD:
            description = f"Recorded {volume}ml {category} output for {patient_name}"
        elif action == AuditAction.FLUID_BALANCE_UPDATE:
            description = f"Updated fluid balance entry ({entry_type}: {volume}ml {category}) for {patient_name}"
        elif action == AuditAction.FLUID_BALANCE_DELETE:
            description = f"Deleted fluid balance entry ({entry_type}: {volume}ml {category}) for {patient_name}"
        else:
            description = f"Fluid balance action on {patient_name}"

        return cls.log(
            request=request,
            action=action,
            category=AuditCategory.NURSING,
            resource_type='FluidBalance',
            resource_id=str(instance.pk),
            resource_name=f"{patient_name} - {entry_type} - {volume}ml",
            description=description,
            changes=changes,
        )
