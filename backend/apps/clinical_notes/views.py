from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action, api_view, permission_classes as api_permission_classes
from rest_framework.pagination import PageNumberPagination
from django.db import transaction, models
from django.db.models import Q
from django.utils import timezone
from itertools import chain
from operator import attrgetter
import copy
import logging

from .models import NoteTemplate, NoteEntry, NoteEntryVersion, Prescription
from .serializers import (
    NoteTemplateSerializer, NoteTemplateListSerializer, NoteEntrySerializer,
    NoteEntryCloneSerializer, NoteEntryVersionSerializer, NoteEntryUpdateSerializer,
    PrescriptionSerializer, PrescriptionCreateSerializer,
    PrescriptionUpdateSerializer, PrescriptionDiscontinueSerializer,
    NoteEntryListSerializer, PrescriptionListSerializer
)
from ..users.permissions import IsAdminOrDoctor, IsAdminOrNurse
from ..users.models import PractitionerProfile, PatientProfile
from ..nursing.models import VitalSigns
from ..fhir_client.client import fhir_client
from ..fhir_client.utils import (
    generate_fhir_id, create_reference, create_codeable_concept, create_coding
)
from ..wards.services import ensure_encounter_for_entry
from ..audit.services import AuditService
from ..audit.models import AuditCategory, AuditAction
from ..referrals.models import Referral
from ..laboratory.models import LabOrder, LabOrderStatus
from ..core.security import check_clinical_access

logger = logging.getLogger(__name__)


class StandardResultsSetPagination(PageNumberPagination):
    """Standard pagination for clinical notes endpoints."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class NoteTemplateViewSet(viewsets.ModelViewSet):
    """
    API endpoint for note templates.

    Templates visibility is controlled by the 'visibility' field:
    - private: Only visible to the creator
    - role: Visible to users with the same user_type (doctor, nurse, etc.)
    - department: Visible to users in the same department
    - public: Visible to all users

    System templates (created_by=None) are always visible to all users.
    """
    queryset = NoteTemplate.objects.all()
    serializer_class = NoteTemplateSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrDoctor | IsAdminOrNurse]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        """Use lightweight serializer for list action."""
        if self.action == 'list':
            return NoteTemplateListSerializer
        return NoteTemplateSerializer

    def get_queryset(self):
        """
        Filter templates based on visibility settings and user context.

        A template is visible to a user if ANY of these conditions are met:
        1. User is admin (sees all templates)
        2. Template visibility is 'public'
        3. Template visibility is 'private' AND user created it
        4. Template visibility is 'role' AND creator has same user_type
        5. Template visibility is 'department' AND user is in same department
        6. Template is a system template (created_by is NULL)
        """
        user = self.request.user

        # Admins can see all templates
        if user.user_type == 'admin':
            queryset = NoteTemplate.objects.all()
        else:
            # Get user's department from Staff profile if available
            user_department = None
            if hasattr(user, 'staff') and user.staff:
                user_department = user.staff.department

            # Build visibility query
            visibility_q = (
                # Public templates
                Q(visibility='public') |
                # System templates (no creator)
                Q(created_by__isnull=True) |
                # User's own private templates
                Q(visibility='private', created_by=user) |
                # Role-shared templates from same user type
                Q(visibility='role', created_by__user_type=user.user_type)
            )

            # Add department visibility if user has a department
            if user_department:
                visibility_q |= Q(visibility='department', department=user_department)

            queryset = NoteTemplate.objects.filter(visibility_q).distinct()

        # Apply query parameter filters
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Filter by title search
        title = self.request.query_params.get('title')
        if title:
            queryset = queryset.filter(title__icontains=title)

        # Filter by visibility
        visibility = self.request.query_params.get('visibility')
        if visibility:
            queryset = queryset.filter(visibility=visibility)

        # Filter by category
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)

        # Filter by "my templates" (created by current user)
        mine_only = self.request.query_params.get('mine')
        if mine_only and mine_only.lower() == 'true':
            queryset = queryset.filter(created_by=user)

        # Legacy filter - keep for backwards compatibility
        is_public = self.request.query_params.get('is_public')
        if is_public is not None:
            queryset = queryset.filter(is_public=is_public.lower() == 'true')

        return queryset.order_by('-updated_at')

    def perform_update(self, serializer):
        """Set the updated_by field when updating a template."""
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def available(self, request):
        """
        Get templates available for the current user to use when creating notes.
        Only returns active templates.
        """
        queryset = self.get_queryset().filter(is_active=True)
        serializer = NoteTemplateListSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def mine(self, request):
        """
        Get templates created by the current user.
        """
        queryset = NoteTemplate.objects.filter(created_by=request.user)
        serializer = NoteTemplateListSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def categories(self, request):
        """
        Get list of available template categories.
        """
        return Response([
            {'value': value, 'label': label}
            for value, label in NoteTemplate.CATEGORY_CHOICES
        ])

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """
        Create a copy of an existing template for the current user.
        The new template will be private by default.
        """
        original = self.get_object()

        # Create a copy with new title and reset ownership
        new_template = NoteTemplate.objects.create(
            title=f"{original.title} (Copy)",
            description=original.description,
            structure=original.structure,
            is_active=True,
            visibility='private',
            category=original.category,
            icon=original.icon,
            estimated_steps=original.estimated_steps,
            created_by=request.user,
        )

        serializer = NoteTemplateSerializer(new_template, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class NoteEntryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for note entries.
    """
    queryset = NoteEntry.objects.all()
    serializer_class = NoteEntrySerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrDoctor | IsAdminOrNurse]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return NoteEntryListSerializer
        return NoteEntrySerializer

    def get_queryset(self):
        """
        Filter note entries based on query parameters.
        """
        queryset = NoteEntry.objects.select_related(
            'template', 'patient', 'patient__user', 'encounter', 'practitioner'
        ).all()

        # Filter by encounter ID
        encounter_id = self.request.query_params.get('encounter_id') or self.request.query_params.get('encounter')
        if encounter_id:
            queryset = queryset.filter(encounter_id=encounter_id)

        # Filter by patient
        patient_id = self.request.query_params.get('patient_id') or self.request.query_params.get('patient')
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by template
        template_id = self.request.query_params.get('template_id')
        if template_id:
            queryset = queryset.filter(template_id=template_id)

        # Filter by practitioner
        practitioner_id = self.request.query_params.get('practitioner_id')
        if practitioner_id:
            queryset = queryset.filter(practitioner_id=practitioner_id)

        return queryset

    @action(detail=True, methods=['get'])
    def sections(self, request, pk=None):
        """
        Get available sections for copying from this note.
        Returns section names with preview of content.

        Used by the frontend to show a section picker before cloning.
        """
        note = self.get_object()
        template_structure = note.template.structure

        # Handle both list and dict structure formats
        if isinstance(template_structure, dict):
            template_sections = template_structure.get('sections', [])
        elif isinstance(template_structure, list):
            template_sections = template_structure
        else:
            template_sections = []

        sections_info = []
        for section in template_sections:
            # Handle different structure formats
            name = section.get('name') or section.get('section', '')
            section_type = section.get('type', 'text')

            # Check if this section has data
            has_data = name in note.data and note.data[name]

            # Generate preview (truncated content)
            preview = None
            if has_data:
                section_data = note.data[name]
                if isinstance(section_data, str):
                    preview = section_data[:150] + ('...' if len(section_data) > 150 else '')
                elif isinstance(section_data, dict):
                    # For structured sections, show first few key-value pairs
                    preview_parts = []
                    for key, value in list(section_data.items())[:3]:
                        if value:
                            preview_parts.append(f"{key}: {str(value)[:50]}")
                    preview = '; '.join(preview_parts)
                    if len(preview) > 150:
                        preview = preview[:150] + '...'
                elif isinstance(section_data, list):
                    preview = f"{len(section_data)} items"

            sections_info.append({
                'name': name,
                'type': section_type,
                'has_data': bool(has_data),
                'preview': preview,
            })

        return Response(sections_info)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def clone(self, request, pk=None):
        """
        Clone an existing note entry with selective section copying.

        Request body:
        {
            "sections": ["Subjective", "Objective"],  // Optional - defaults to all
            "encounter": "uuid",  // Optional - auto-creates if not provided
            "patient": "uuid"     // Optional - defaults to same patient
        }

        Returns: New NoteEntry with selected sections copied.
        Only allows cloning to the same template type.
        """
        source_note = self.get_object()

        # Validate input
        serializer = NoteEntryCloneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated_data = serializer.validated_data

        # Get the practitioner profile
        try:
            practitioner_profile = PractitionerProfile.objects.get(staff__user=request.user)
        except PractitionerProfile.DoesNotExist:
            return Response(
                {"error": "User does not have an associated practitioner profile"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Determine target patient (default: same as source)
        target_patient_id = validated_data.get('patient')
        if target_patient_id:
            try:
                target_patient = PatientProfile.objects.get(id=target_patient_id)
            except PatientProfile.DoesNotExist:
                return Response(
                    {"error": "Target patient not found"},
                    status=status.HTTP_404_NOT_FOUND
                )
        else:
            target_patient = source_note.patient

        if not target_patient:
            return Response(
                {"error": "Patient is required for cloning"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get or create encounter
        encounter_id = validated_data.get('encounter')
        try:
            encounter, encounter_created = ensure_encounter_for_entry(
                patient=target_patient,
                practitioner=practitioner_profile,
                encounter_id=encounter_id,
                reason='Clinical note (copied from previous)'
            )
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get template structure to validate sections
        template_structure = source_note.template.structure
        if isinstance(template_structure, dict):
            template_sections = template_structure.get('sections', [])
        elif isinstance(template_structure, list):
            template_sections = template_structure
        else:
            template_sections = []

        valid_section_names = {
            s.get('name') or s.get('section', '') for s in template_sections
        }

        # Determine which sections to copy
        requested_sections = validated_data.get('sections')
        if requested_sections:
            # Validate requested sections exist in template
            invalid_sections = set(requested_sections) - valid_section_names
            if invalid_sections:
                return Response(
                    {"error": f"Invalid section names: {', '.join(invalid_sections)}"},
                    status=status.HTTP_400_BAD_REQUEST
                )
            sections_to_copy = set(requested_sections)
        else:
            # Default: copy all sections that have data
            sections_to_copy = valid_section_names

        # Build new data by copying selected sections
        new_data = {}
        for section_name in sections_to_copy:
            if section_name in source_note.data:
                # Deep copy the section data
                new_data[section_name] = copy.deepcopy(source_note.data[section_name])

        # Create the new note entry
        new_note = NoteEntry.objects.create(
            template=source_note.template,
            patient=target_patient,
            encounter=encounter,
            practitioner=practitioner_profile,
            data=new_data,
            copied_from=source_note,
        )

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.NOTE_CREATE,
            category=AuditCategory.CLINICAL,
            resource_type='NoteEntry',
            resource_id=new_note.id,
            resource_name=f"{source_note.template.title} (Copy)",
            description=f"Cloned clinical note '{source_note.template.title}' for patient {target_patient.user.get_full_name()}. "
                        f"Sections copied: {', '.join(sections_to_copy)}. Source note: {source_note.id}",
        )

        # Return the new note
        output_serializer = NoteEntrySerializer(new_note, context={'request': request})
        response_data = output_serializer.data
        response_data['encounter_created'] = encounter_created
        response_data['sections_copied'] = list(sections_to_copy)

        return Response(response_data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Create a new note entry and associated FHIR resources.

        If no encounter is provided, automatically finds or creates an active encounter
        for the patient.
        """
        # Get the practitioner profile first
        try:
            practitioner_profile = PractitionerProfile.objects.get(staff__user=request.user)
        except PractitionerProfile.DoesNotExist:
            return Response(
                {"error": "User does not have an associated practitioner profile"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Add practitioner to the request data
        data = request.data.copy()
        data['practitioner'] = practitioner_profile.id

        # Get patient for auto-encounter logic
        patient_id = data.get('patient')
        if not patient_id:
            return Response(
                {"error": "Patient is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            patient = PatientProfile.objects.get(id=patient_id)
        except PatientProfile.DoesNotExist:
            return Response(
                {"error": "Patient not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        # Auto-encounter: Find or create an active encounter
        encounter_id = data.get('encounter')
        try:
            encounter, encounter_created = ensure_encounter_for_entry(
                patient=patient,
                practitioner=practitioner_profile,
                encounter_id=encounter_id,
                reason='Clinical note documentation'
            )
            data['encounter'] = encounter.id
            if encounter_created:
                logger.info(f"Auto-created encounter {encounter.id} for note entry")
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        try:
            # Get template and data
            template = serializer.validated_data['template']
            note_data = serializer.validated_data['data']

            # Get encounter ID for FHIR resources (use encounter UUID or FHIR ID)
            local_encounter_id = str(encounter.id)
            fhir_encounter_id = encounter.fhir_id if encounter.fhir_id else local_encounter_id

            # Create FHIR resources and Composition
            composition_id = None
            try:
                fhir_resources = self._create_fhir_resources(template, fhir_encounter_id, note_data)
                composition = self._create_composition(
                    template,
                    local_encounter_id,  # Use local encounter ID now
                    practitioner_profile.fhir_practitioner_id,
                    note_data,
                    fhir_resources
                )
                composition_id = composition.get('id')
            except Exception as fhir_error:
                # Log but don't fail - FHIR sync can happen later
                logger.warning(f"FHIR resource creation failed: {str(fhir_error)}")

            # Save the Composition ID to the note entry (if created)
            if composition_id:
                serializer.validated_data['composition_fhir_id'] = composition_id

            # Save the note entry
            note_entry = serializer.save()

            # Audit log - clinical note created
            AuditService.log(
                request=request,
                action=AuditAction.NOTE_CREATE,
                category=AuditCategory.CLINICAL,
                resource_type='NoteEntry',
                resource_id=note_entry.id,
                resource_name=f"{template.title} for {patient.user.get_full_name()}",
                description=f"Created clinical note '{template.title}' for patient {patient.user.get_full_name()}",
            )

            # Include encounter_created flag in response for frontend awareness
            response_data = serializer.data
            response_data['encounter_created'] = encounter_created

            return Response(response_data, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f"Failed to create note entry: {str(e)}")
            return Response(
                {"error": "Failed to create note entry. Please try again."},
                status=status.HTTP_400_BAD_REQUEST
            )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        """
        Update a note entry with version tracking.
        Creates a version snapshot before applying changes.
        """
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # Get edit reason from request
        edit_reason = request.data.get('edit_reason', '')

        # Create version snapshot BEFORE updating
        NoteEntryVersion.create_version(
            note_entry=instance,
            edited_by=request.user,
            edit_reason=edit_reason
        )

        # Validate and update the note data
        data = request.data.get('data', instance.data)

        # Update the instance
        instance.data = data
        instance.save()

        # Audit log - clinical note updated
        AuditService.log(
            request=request,
            action=AuditAction.NOTE_UPDATE,
            category=AuditCategory.CLINICAL,
            resource_type='NoteEntry',
            resource_id=instance.id,
            resource_name=f"{instance.template.title}",
            description=f"Updated clinical note '{instance.template.title}'. "
                        f"Reason: {edit_reason or 'Not specified'}",
            changes={'edit_reason': edit_reason}
        )

        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        """Partial update with version tracking."""
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        """
        Get version history for a clinical note.

        Returns all previous versions sorted by version number (newest first).
        """
        note = self.get_object()
        versions = note.versions.select_related('edited_by').all()

        serializer = NoteEntryVersionSerializer(versions, many=True)
        return Response({
            'note_id': str(note.id),
            'current_data': note.data,
            'created_at': note.created_at.isoformat(),
            'updated_at': note.updated_at.isoformat(),
            'version_count': versions.count(),
            'versions': serializer.data
        })

    @action(detail=True, methods=['get'], url_path='history/(?P<version_number>[0-9]+)')
    def version_detail(self, request, pk=None, version_number=None):
        """
        Get a specific version of a clinical note.

        Args:
            version_number: The version number to retrieve (1-indexed)

        Returns the data snapshot for that version.
        """
        note = self.get_object()

        try:
            version = note.versions.select_related('edited_by').get(version_number=int(version_number))
        except NoteEntryVersion.DoesNotExist:
            return Response(
                {"error": f"Version {version_number} not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        serializer = NoteEntryVersionSerializer(version)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='compare/(?P<version_a>[0-9]+)/(?P<version_b>[0-9]+)')
    def compare_versions(self, request, pk=None, version_a=None, version_b=None):
        """
        Compare two versions of a clinical note.

        Args:
            version_a: First version number to compare
            version_b: Second version number to compare

        Returns both versions' data for comparison.
        Use 0 for version_a or version_b to compare against current version.
        """
        note = self.get_object()

        # Get version A data
        if int(version_a) == 0:
            data_a = note.data
            version_a_info = {
                'version_number': 'current',
                'created_at': note.updated_at.isoformat(),
                'edited_by_name': 'Current'
            }
        else:
            try:
                ver_a = note.versions.select_related('edited_by').get(version_number=int(version_a))
                data_a = ver_a.data
                version_a_info = NoteEntryVersionSerializer(ver_a).data
            except NoteEntryVersion.DoesNotExist:
                return Response(
                    {"error": f"Version {version_a} not found"},
                    status=status.HTTP_404_NOT_FOUND
                )

        # Get version B data
        if int(version_b) == 0:
            data_b = note.data
            version_b_info = {
                'version_number': 'current',
                'created_at': note.updated_at.isoformat(),
                'edited_by_name': 'Current'
            }
        else:
            try:
                ver_b = note.versions.select_related('edited_by').get(version_number=int(version_b))
                data_b = ver_b.data
                version_b_info = NoteEntryVersionSerializer(ver_b).data
            except NoteEntryVersion.DoesNotExist:
                return Response(
                    {"error": f"Version {version_b} not found"},
                    status=status.HTTP_404_NOT_FOUND
                )

        return Response({
            'note_id': str(note.id),
            'version_a': version_a_info,
            'version_b': version_b_info,
            'data_a': data_a,
            'data_b': data_b
        })

    def _create_fhir_resources(self, template, encounter_id, data):
        """
        Create FHIR resources based on template sections.

        Args:
            template: The NoteTemplate instance
            encounter_id: The FHIR Encounter ID
            data: The submitted form data

        Returns:
            A dictionary mapping section names to lists of created FHIR resources
        """
        resources = {}

        # Create a reference to the encounter
        encounter_reference = create_reference("Encounter", encounter_id)

        # Handle both list and dict structure formats
        template_structure = template.structure
        if isinstance(template_structure, dict):
            sections_list = template_structure.get('sections', [])
        elif isinstance(template_structure, list):
            sections_list = template_structure
        else:
            sections_list = []

        # Process each section in the template
        for section in sections_list:
            section_name = section.get('name') or section.get('section', '')
            section_type = section.get('type')
            section_data = data.get(section_name)

            if not section_data:
                continue

            if section_type == 'observation':
                observation_type = section.get('observation_type')
                resources[section_name] = self._create_observations(
                    section_name, 
                    section_data, 
                    encounter_reference,
                    observation_type
                )
            elif section_type == 'condition':
                resources[section_name] = self._create_conditions(
                    section_name,
                    section_data,
                    encounter_reference
                )
            elif section_type == 'medication_administration':
                resources[section_name] = self._create_medication_administrations(
                    section_name,
                    section_data,
                    encounter_reference
                )

        return resources

    def _create_observations(self, section_name, section_data, encounter_reference, observation_type):
        """
        Create FHIR Observation resources.
        """
        observations = []

        # Handle different observation types
        if observation_type == 'vitals':
            # Process vitals data (e.g., BP, temp, HR)
            for vital_name, vital_value in section_data.items():
                if not vital_value:
                    continue

                observation_data = {
                    "resourceType": "Observation",
                    "id": generate_fhir_id(),
                    "status": "final",
                    "category": [
                        create_codeable_concept([
                            create_coding(
                                "http://terminology.hl7.org/CodeSystem/observation-category",
                                "vital-signs",
                                "Vital Signs"
                            )
                        ])
                    ],
                    "code": create_codeable_concept([
                        create_coding(
                            "http://loinc.org",
                            self._get_loinc_code(vital_name),
                            vital_name
                        )
                    ]),
                    "subject": encounter_reference.get("subject", {}),
                    "encounter": encounter_reference,
                    "effectiveDateTime": timezone.now().isoformat(),
                    "valueQuantity": {
                        "value": float(vital_value),
                        "unit": self._get_unit(vital_name),
                        "system": "http://unitsofmeasure.org",
                        "code": self._get_unit_code(vital_name)
                    }
                }

                # Create the observation
                observation = fhir_client.create_resource("Observation", observation_data)
                observations.append(observation)

        elif observation_type == 'fluid_balance':
            # Process fluid balance data (I/O chart)
            # Define input types
            input_types = {
                'oral_intake': 'Oral Intake',
                'iv_intake': 'IV Fluids',
                'ng_tube': 'NG Tube Feeding',
                'tpn': 'TPN',
                'other_intake': 'Other Intake'
            }

            # Define output types
            output_types = {
                'urine': 'Urine Output',
                'ng_aspirate': 'N/G Aspirate',
                'drain_fluid': 'Fluid from Drains',
                'stoma': 'Stoma Output',
                'stool': 'Stool',
                'other_output': 'Other Output'
            }

            # Create components and calculate totals for inputs
            input_components = []
            total_input = 0

            for input_key, input_display in input_types.items():
                if input_key in section_data and section_data[input_key]:
                    input_value = float(section_data[input_key])
                    total_input += input_value

                    input_components.append({
                        "code": create_codeable_concept([], input_display),
                        "valueQuantity": {
                            "value": input_value,
                            "unit": "mL",
                            "system": "http://unitsofmeasure.org",
                            "code": "mL"
                        }
                    })

            # Create components and calculate totals for outputs
            output_components = []
            total_output = 0

            for output_key, output_display in output_types.items():
                if output_key in section_data and section_data[output_key]:
                    output_value = float(section_data[output_key])
                    total_output += output_value

                    output_components.append({
                        "code": create_codeable_concept([], output_display),
                        "valueQuantity": {
                            "value": output_value,
                            "unit": "mL",
                            "system": "http://unitsofmeasure.org",
                            "code": "mL"
                        }
                    })

            # Create input observation if there are input components
            if input_components:
                input_observation = {
                    "resourceType": "Observation",
                    "id": generate_fhir_id(),
                    "status": "final",
                    "category": [
                        create_codeable_concept([
                            create_coding(
                                "http://terminology.hl7.org/CodeSystem/observation-category",
                                "vital-signs",
                                "Vital Signs"
                            )
                        ])
                    ],
                    "code": create_codeable_concept([], "Fluid Intake"),
                    "subject": encounter_reference.get("subject", {}),
                    "encounter": encounter_reference,
                    "effectiveDateTime": timezone.now().isoformat(),
                    "valueQuantity": {
                        "value": total_input,
                        "unit": "mL",
                        "system": "http://unitsofmeasure.org",
                        "code": "mL"
                    },
                    "component": input_components
                }

                # Create the input observation
                input_obs = fhir_client.create_resource("Observation", input_observation)
                observations.append(input_obs)

            # Create output observation if there are output components
            if output_components:
                output_observation = {
                    "resourceType": "Observation",
                    "id": generate_fhir_id(),
                    "status": "final",
                    "category": [
                        create_codeable_concept([
                            create_coding(
                                "http://terminology.hl7.org/CodeSystem/observation-category",
                                "vital-signs",
                                "Vital Signs"
                            )
                        ])
                    ],
                    "code": create_codeable_concept([], "Fluid Output"),
                    "subject": encounter_reference.get("subject", {}),
                    "encounter": encounter_reference,
                    "effectiveDateTime": timezone.now().isoformat(),
                    "valueQuantity": {
                        "value": total_output,
                        "unit": "mL",
                        "system": "http://unitsofmeasure.org",
                        "code": "mL"
                    },
                    "component": output_components
                }

                # Create the output observation
                output_obs = fhir_client.create_resource("Observation", output_observation)
                observations.append(output_obs)

            # Create a balance observation (input - output)
            balance_value = total_input - total_output
            balance_observation = {
                "resourceType": "Observation",
                "id": generate_fhir_id(),
                "status": "final",
                "category": [
                    create_codeable_concept([
                        create_coding(
                            "http://terminology.hl7.org/CodeSystem/observation-category",
                            "vital-signs",
                            "Vital Signs"
                        )
                    ])
                ],
                "code": create_codeable_concept([], "Fluid Balance"),
                "subject": encounter_reference.get("subject", {}),
                "encounter": encounter_reference,
                "effectiveDateTime": timezone.now().isoformat(),
                "valueQuantity": {
                    "value": balance_value,
                    "unit": "mL",
                    "system": "http://unitsofmeasure.org",
                    "code": "mL"
                },
                "note": [
                    {
                        "text": f"Total Intake: {total_input} mL, Total Output: {total_output} mL, Balance: {balance_value} mL"
                    }
                ]
            }

            # Create the balance observation
            balance_obs = fhir_client.create_resource("Observation", balance_observation)
            observations.append(balance_obs)

        elif observation_type == 'subjective_symptoms' or observation_type == 'allergy':
            # Process symptoms or allergies as text observations
            if isinstance(section_data, list):
                # Handle list of symptoms/allergies
                for item in section_data:
                    observation_data = {
                        "resourceType": "Observation",
                        "id": generate_fhir_id(),
                        "status": "final",
                        "category": [
                            create_codeable_concept([
                                create_coding(
                                    "http://terminology.hl7.org/CodeSystem/observation-category",
                                    "exam",
                                    "Examination"
                                )
                            ])
                        ],
                        "code": create_codeable_concept([], section_name),
                        "subject": encounter_reference.get("subject", {}),
                        "encounter": encounter_reference,
                        "effectiveDateTime": timezone.now().isoformat(),
                        "valueString": item
                    }

                    # Create the observation
                    observation = fhir_client.create_resource("Observation", observation_data)
                    observations.append(observation)
            else:
                # Handle single text entry
                observation_data = {
                    "resourceType": "Observation",
                    "id": generate_fhir_id(),
                    "status": "final",
                    "category": [
                        create_codeable_concept([
                            create_coding(
                                "http://terminology.hl7.org/CodeSystem/observation-category",
                                "exam",
                                "Examination"
                            )
                        ])
                    ],
                    "code": create_codeable_concept([], section_name),
                    "subject": encounter_reference.get("subject", {}),
                    "encounter": encounter_reference,
                    "effectiveDateTime": timezone.now().isoformat(),
                    "valueString": section_data
                }

                # Create the observation
                observation = fhir_client.create_resource("Observation", observation_data)
                observations.append(observation)

        return observations

    def _create_conditions(self, section_name, section_data, encounter_reference):
        """
        Create FHIR Condition resources.
        """
        conditions = []

        if isinstance(section_data, list):
            # Handle list of conditions
            for condition_text in section_data:
                condition_data = {
                    "resourceType": "Condition",
                    "id": generate_fhir_id(),
                    "clinicalStatus": create_codeable_concept([
                        create_coding(
                            "http://terminology.hl7.org/CodeSystem/condition-clinical",
                            "active",
                            "Active"
                        )
                    ]),
                    "verificationStatus": create_codeable_concept([
                        create_coding(
                            "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                            "confirmed",
                            "Confirmed"
                        )
                    ]),
                    "category": [
                        create_codeable_concept([
                            create_coding(
                                "http://terminology.hl7.org/CodeSystem/condition-category",
                                "encounter-diagnosis",
                                "Encounter Diagnosis"
                            )
                        ])
                    ],
                    "code": create_codeable_concept([], condition_text),
                    "subject": encounter_reference.get("subject", {}),
                    "encounter": encounter_reference,
                    "recordedDate": timezone.now().isoformat()
                }

                # Create the condition
                condition = fhir_client.create_resource("Condition", condition_data)
                conditions.append(condition)
        else:
            # Handle single condition
            condition_data = {
                "resourceType": "Condition",
                "id": generate_fhir_id(),
                "clinicalStatus": create_codeable_concept([
                    create_coding(
                        "http://terminology.hl7.org/CodeSystem/condition-clinical",
                        "active",
                        "Active"
                    )
                ]),
                "verificationStatus": create_codeable_concept([
                    create_coding(
                        "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                        "confirmed",
                        "Confirmed"
                    )
                ]),
                "category": [
                    create_codeable_concept([
                        create_coding(
                            "http://terminology.hl7.org/CodeSystem/condition-category",
                            "encounter-diagnosis",
                            "Encounter Diagnosis"
                        )
                    ])
                ],
                "code": create_codeable_concept([], section_data),
                "subject": encounter_reference.get("subject", {}),
                "encounter": encounter_reference,
                "recordedDate": timezone.now().isoformat()
            }

            # Create the condition
            condition = fhir_client.create_resource("Condition", condition_data)
            conditions.append(condition)

        return conditions

    def _create_medication_administrations(self, section_name, section_data, encounter_reference):
        """
        Create FHIR MedicationAdministration resources.
        """
        administrations = []

        if isinstance(section_data, list):
            # Handle list of medications
            for med_data in section_data:
                if isinstance(med_data, dict) and 'medication' in med_data and 'dosage' in med_data:
                    med_admin_data = {
                        "resourceType": "MedicationAdministration",
                        "id": generate_fhir_id(),
                        "status": "completed",
                        "medicationCodeableConcept": create_codeable_concept([], med_data['medication']),
                        "subject": encounter_reference.get("subject", {}),
                        "context": encounter_reference,
                        "effectiveDateTime": timezone.now().isoformat(),
                        "dosage": {
                            "text": med_data['dosage']
                        }
                    }

                    # Create the medication administration
                    med_admin = fhir_client.create_resource("MedicationAdministration", med_admin_data)
                    administrations.append(med_admin)
        elif isinstance(section_data, dict) and 'medication' in section_data and 'dosage' in section_data:
            # Handle single medication
            med_admin_data = {
                "resourceType": "MedicationAdministration",
                "id": generate_fhir_id(),
                "status": "completed",
                "medicationCodeableConcept": create_codeable_concept([], section_data['medication']),
                "subject": encounter_reference.get("subject", {}),
                "context": encounter_reference,
                "effectiveDateTime": timezone.now().isoformat(),
                "dosage": {
                    "text": section_data['dosage']
                }
            }

            # Create the medication administration
            med_admin = fhir_client.create_resource("MedicationAdministration", med_admin_data)
            administrations.append(med_admin)

        return administrations

    def _create_composition(self, template, encounter_id, practitioner_id, data, fhir_resources):
        """
        Create a FHIR Composition resource that includes all the created resources.

        Args:
            template: The NoteTemplate instance
            encounter_id: The FHIR Encounter ID
            practitioner_id: The FHIR Practitioner ID
            data: The submitted form data
            fhir_resources: Dictionary of created FHIR resources

        Returns:
            The created FHIR Composition resource
        """
        # Get the encounter from local database to extract patient reference
        try:
            from ..wards.models import Encounter
            encounter = Encounter.objects.select_related('patient', 'patient__user').get(id=encounter_id)
            patient_fhir_id = getattr(encounter.patient, 'fhir_patient_id', None) or str(encounter.patient.id)
            patient_reference = {
                "reference": f"Patient/{patient_fhir_id}",
                "display": encounter.patient_name,
            }
        except Exception as e:
            # Log the error
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Encounter {encounter_id} not found locally: {str(e)}")
            # Use a default patient reference
            patient_reference = {}

        # Create the composition
        composition_data = {
            "resourceType": "Composition",
            "id": generate_fhir_id(),
            "status": "final",
            "type": {
                "text": template.title
            },
            "subject": patient_reference,
            "encounter": create_reference("Encounter", encounter_id),
            "author": [create_reference("Practitioner", practitioner_id)],
            "date": timezone.now().isoformat(),
            "title": f"{template.title} for {patient_reference.get('display', 'Patient')}",
            "section": []
        }

        # Handle both list and dict structure formats
        template_structure = template.structure
        if isinstance(template_structure, dict):
            sections_list = template_structure.get('sections', [])
        elif isinstance(template_structure, list):
            sections_list = template_structure
        else:
            sections_list = []

        # Add sections based on template structure
        for section in sections_list:
            section_name = section.get('name') or section.get('section', '')
            section_type = section.get('type')
            section_data = data.get(section_name)

            composition_section = {
                "title": section_name
            }

            if section_type == 'text' and section_data:
                # Add text section
                composition_section["text"] = {
                    "status": "generated",
                    "div": f"<div>{section_data}</div>"
                }
            elif section_type in ['observation', 'condition', 'medication_administration']:
                # Add references to created resources
                resources = fhir_resources.get(section_name, [])
                if resources:
                    composition_section["entry"] = [
                        create_reference(
                            resource["resourceType"],
                            resource["id"]
                        ) for resource in resources
                    ]

            composition_data["section"].append(composition_section)

        # Create the composition
        return fhir_client.create_resource("Composition", composition_data)

    def _get_loinc_code(self, vital_name):
        """
        Get the LOINC code for a vital sign.
        """
        vital_codes = {
            "heart_rate": "8867-4",
            "respiratory_rate": "9279-1",
            "temperature": "8310-5",
            "blood_pressure_systolic": "8480-6",
            "blood_pressure_diastolic": "8462-4",
            "oxygen_saturation": "2708-6",
            "height": "8302-2",
            "weight": "29463-7",
            "bmi": "39156-5"
        }
        return vital_codes.get(vital_name.lower().replace(" ", "_"), "8661-1")  # Default to general observation

    def _get_unit(self, vital_name):
        """
        Get the unit for a vital sign.
        """
        vital_units = {
            "heart_rate": "beats/minute",
            "respiratory_rate": "breaths/minute",
            "temperature": "Cel",
            "blood_pressure_systolic": "mmHg",
            "blood_pressure_diastolic": "mmHg",
            "oxygen_saturation": "%",
            "height": "cm",
            "weight": "kg",
            "bmi": "kg/m2"
        }
        return vital_units.get(vital_name.lower().replace(" ", "_"), "")

    def _get_unit_code(self, vital_name):
        """
        Get the unit code for a vital sign.
        """
        vital_unit_codes = {
            "heart_rate": "/min",
            "respiratory_rate": "/min",
            "temperature": "Cel",
            "blood_pressure_systolic": "mm[Hg]",
            "blood_pressure_diastolic": "mm[Hg]",
            "oxygen_saturation": "%",
            "height": "cm",
            "weight": "kg",
            "bmi": "kg/m2"
        }
        return vital_unit_codes.get(vital_name.lower().replace(" ", "_"), "")


class PrescriptionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for prescriptions.
    Doctors create prescriptions, nurses can view them for administration.
    """
    queryset = Prescription.objects.all()
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardResultsSetPagination

    def get_serializer_class(self):
        if self.action == 'list':
            return PrescriptionListSerializer
        elif self.action == 'create':
            return PrescriptionCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return PrescriptionUpdateSerializer
        elif self.action == 'discontinue':
            return PrescriptionDiscontinueSerializer
        return PrescriptionSerializer

    def get_queryset(self):
        """
        Filter prescriptions based on query parameters.
        """
        queryset = Prescription.objects.all()

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by active only
        active_only = self.request.query_params.get('active_only')
        if active_only and active_only.lower() == 'true':
            queryset = queryset.filter(
                status='active',
                end_date__gte=timezone.now().date()
            ) | queryset.filter(
                status='active',
                end_date__isnull=True
            )

        # Filter by prescribed_by
        prescribed_by = self.request.query_params.get('prescribed_by')
        if prescribed_by:
            queryset = queryset.filter(prescribed_by_id=prescribed_by)

        return queryset.select_related('patient', 'prescribed_by', 'discontinued_by')

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Create a new prescription. Only doctors can prescribe.

        If no encounter is provided, automatically finds or creates an active encounter
        for the patient.
        """
        # Check if user is a doctor (admins cannot prescribe - clinical function only)
        if request.user.user_type != 'doctor':
            return Response(
                {'error': 'Only doctors can prescribe medications'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Get the practitioner profile
        try:
            practitioner_profile = PractitionerProfile.objects.get(staff__user=request.user)
        except PractitionerProfile.DoesNotExist:
            return Response(
                {'error': 'User does not have an associated practitioner profile'},
                status=status.HTTP_400_BAD_REQUEST
            )

        data = request.data.copy()

        # Get patient for auto-encounter logic
        patient_id = data.get('patient')
        if not patient_id:
            return Response(
                {"error": "Patient is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            patient = PatientProfile.objects.get(id=patient_id)
        except PatientProfile.DoesNotExist:
            return Response(
                {"error": "Patient not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        # Auto-encounter: Find or create an active encounter
        encounter_id = data.get('encounter')
        try:
            encounter, encounter_created = ensure_encounter_for_entry(
                patient=patient,
                practitioner=practitioner_profile,
                encounter_id=encounter_id,
                reason='Prescription'
            )
            data['encounter'] = encounter.id
            if encounter_created:
                logger.info(f"Auto-created encounter {encounter.id} for prescription")
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        # Create prescription with prescribed_by
        prescription = serializer.save(prescribed_by=practitioner_profile)

        # Audit log - prescription created
        AuditService.log(
            request=request,
            action=AuditAction.PRESCRIPTION_CREATE,
            category=AuditCategory.PRESCRIPTION,
            resource_type='Prescription',
            resource_id=prescription.id,
            resource_name=f"{prescription.medication_name} for {patient.user.get_full_name()}",
            description=f"Prescribed {prescription.medication_name} {prescription.dosage} "
                        f"({prescription.get_route_display()}, {prescription.get_frequency_display()}) "
                        f"for patient {patient.user.get_full_name()}",
        )

        # Auto-generate MAR entries if requested or if patient is admitted
        mar_generated = False
        generate_mar = data.get('generate_mar', 'auto')  # 'auto', 'yes', 'no'

        if generate_mar != 'no':
            # Check if patient is currently admitted (inpatient)
            from ..wards.models import Admission
            is_admitted = Admission.objects.filter(
                patient=patient,
                status='admitted'
            ).exists()

            # Generate MAR if explicitly requested OR if auto and patient is admitted
            if generate_mar == 'yes' or (generate_mar == 'auto' and is_admitted):
                from ..nursing.services import generate_mar_entries_for_prescription
                try:
                    days = int(data.get('mar_days', 7))  # Default 7 days
                    mar_entries = generate_mar_entries_for_prescription(
                        prescription,
                        days=days,
                        created_by=request.user
                    )
                    mar_generated = len(mar_entries) > 0
                    if mar_generated:
                        logger.info(f"Auto-generated {len(mar_entries)} MAR entries for prescription {prescription.id}")
                except Exception as e:
                    logger.error(f"Failed to auto-generate MAR entries: {e}")

        # Return full serialized data with encounter_created flag
        output_serializer = PrescriptionSerializer(prescription)
        response_data = output_serializer.data
        response_data['encounter_created'] = encounter_created
        response_data['mar_generated'] = mar_generated

        return Response(response_data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def discontinue(self, request, pk=None):
        """
        Discontinue a prescription. Only doctors can discontinue.
        """
        if request.user.user_type != 'doctor':
            return Response(
                {'error': 'Only doctors can discontinue prescriptions'},
                status=status.HTTP_403_FORBIDDEN
            )

        prescription = self.get_object()

        if prescription.status == 'discontinued':
            return Response(
                {'error': 'Prescription is already discontinued'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Get the practitioner profile
        try:
            practitioner_profile = PractitionerProfile.objects.get(staff__user=request.user)
        except PractitionerProfile.DoesNotExist:
            return Response(
                {'error': 'User does not have an associated practitioner profile'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Update the prescription
        prescription.status = 'discontinued'
        prescription.discontinued_at = timezone.now()
        prescription.discontinued_by = practitioner_profile
        prescription.discontinue_reason = serializer.validated_data['reason']
        prescription.save()

        # Audit log - prescription discontinued
        AuditService.log(
            request=request,
            action=AuditAction.PRESCRIPTION_DISCONTINUE,
            category=AuditCategory.PRESCRIPTION,
            resource_type='Prescription',
            resource_id=prescription.id,
            resource_name=f"{prescription.medication_name}",
            description=f"Discontinued {prescription.medication_name} for patient "
                        f"{prescription.patient.user.get_full_name()}. Reason: {prescription.discontinue_reason}",
        )

        output_serializer = PrescriptionSerializer(prescription)
        return Response(output_serializer.data)

    @action(detail=True, methods=['post'])
    def hold(self, request, pk=None):
        """
        Put a prescription on hold. Only doctors can hold prescriptions.
        """
        if request.user.user_type != 'doctor':
            return Response(
                {'error': 'Only doctors can hold prescriptions'},
                status=status.HTTP_403_FORBIDDEN
            )

        prescription = self.get_object()

        if prescription.status != 'active':
            return Response(
                {'error': 'Only active prescriptions can be put on hold'},
                status=status.HTTP_400_BAD_REQUEST
            )

        reason = request.data.get('reason', '')

        prescription.status = 'on_hold'
        prescription.save()

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.UPDATE,
            category=AuditCategory.PRESCRIPTION,
            resource_type='Prescription',
            resource_id=prescription.id,
            resource_name=f"{prescription.medication_name}",
            description=f"Put {prescription.medication_name} on hold for patient "
                        f"{prescription.patient.user.get_full_name()}. Reason: {reason}",
            changes={'status': {'old': 'active', 'new': 'on_hold'}, 'hold_reason': reason}
        )

        output_serializer = PrescriptionSerializer(prescription)
        return Response(output_serializer.data)

    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        """
        Resume a prescription that was on hold. Only doctors can resume.
        """
        if request.user.user_type != 'doctor':
            return Response(
                {'error': 'Only doctors can resume prescriptions'},
                status=status.HTTP_403_FORBIDDEN
            )

        prescription = self.get_object()

        if prescription.status != 'on_hold':
            return Response(
                {'error': 'Only prescriptions on hold can be resumed'},
                status=status.HTTP_400_BAD_REQUEST
            )

        prescription.status = 'active'
        prescription.save()

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.UPDATE,
            category=AuditCategory.PRESCRIPTION,
            resource_type='Prescription',
            resource_id=prescription.id,
            resource_name=f"{prescription.medication_name}",
            description=f"Resumed {prescription.medication_name} for patient "
                        f"{prescription.patient.user.get_full_name()}",
            changes={'status': {'old': 'on_hold', 'new': 'active'}}
        )

        output_serializer = PrescriptionSerializer(prescription)
        return Response(output_serializer.data)

    @action(detail=True, methods=['post'])
    def renew(self, request, pk=None):
        """
        Renew a prescription by creating a new one with the same details.
        Only doctors can renew prescriptions.
        """
        if request.user.user_type != 'doctor':
            return Response(
                {'error': 'Only doctors can renew prescriptions'},
                status=status.HTTP_403_FORBIDDEN
            )

        original = self.get_object()

        # Get the practitioner profile
        try:
            practitioner_profile = PractitionerProfile.objects.get(staff__user=request.user)
        except PractitionerProfile.DoesNotExist:
            return Response(
                {'error': 'User does not have an associated practitioner profile'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get new duration from request or use original
        duration_days = request.data.get('duration_days', original.duration_days)
        instructions = request.data.get('instructions', original.instructions)

        # Auto-encounter: Find or create an active encounter
        try:
            encounter, encounter_created = ensure_encounter_for_entry(
                patient=original.patient,
                practitioner=practitioner_profile,
                encounter_id=request.data.get('encounter'),
                reason='Prescription Renewal'
            )
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Calculate new dates
        start_date = timezone.now().date()
        end_date = None
        if duration_days:
            end_date = start_date + timedelta(days=int(duration_days))

        # Create new prescription
        new_prescription = Prescription.objects.create(
            patient=original.patient,
            prescribed_by=practitioner_profile,
            medication_name=original.medication_name,
            dosage=original.dosage,
            route=original.route,
            frequency=original.frequency,
            duration_days=duration_days,
            start_date=start_date,
            end_date=end_date,
            instructions=instructions,
            reason=f"Renewal of {original.medication_name}",
            status='active',
            encounter=encounter,
        )

        # Mark original as completed if still active
        if original.status == 'active':
            original.status = 'completed'
            original.save()

        # Audit log
        AuditService.log(
            request=request,
            action=AuditAction.PRESCRIPTION_CREATE,
            category=AuditCategory.PRESCRIPTION,
            resource_type='Prescription',
            resource_id=new_prescription.id,
            resource_name=f"{new_prescription.medication_name} (Renewal)",
            description=f"Renewed {new_prescription.medication_name} for patient "
                        f"{original.patient.user.get_full_name()}. Original Rx: {original.id}",
        )

        output_serializer = PrescriptionSerializer(new_prescription)
        response_data = output_serializer.data
        response_data['original_prescription_id'] = str(original.id)
        response_data['encounter_created'] = encounter_created

        return Response(response_data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def patient_active(self, request):
        """
        Get active prescriptions for a patient.
        """
        patient_id = request.query_params.get('patient')
        if not patient_id:
            return Response(
                {'error': 'patient parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        prescriptions = Prescription.objects.filter(
            patient_id=patient_id,
            status='active'
        ).filter(
            models.Q(end_date__gte=timezone.now().date()) |
            models.Q(end_date__isnull=True)
        ).select_related('prescribed_by')

        serializer = PrescriptionSerializer(prescriptions, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def generate_mar(self, request, pk=None):
        """
        Generate Medication Administration Record entries for a prescription.
        Only doctors and nurses can generate MAR entries.
        """
        if request.user.user_type not in ['doctor', 'nurse', 'admin']:
            return Response(
                {'error': 'Only clinical staff can generate MAR entries'},
                status=status.HTTP_403_FORBIDDEN
            )

        prescription = self.get_object()

        if prescription.status not in ['active']:
            return Response(
                {'error': 'MAR can only be generated for active prescriptions'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get parameters
        days = request.data.get('days', 7)
        start_date_str = request.data.get('start_date')

        start_date = None
        if start_date_str:
            try:
                start_date = timezone.datetime.fromisoformat(start_date_str.replace('Z', '+00:00')).date()
            except ValueError:
                return Response(
                    {'error': 'Invalid start_date format'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Import and use the MAR generation service
        from apps.nursing.services import generate_mar_entries_for_prescription

        entries = generate_mar_entries_for_prescription(
            prescription,
            days=days,
            start_date=start_date,
            created_by=request.user
        )

        return Response({
            'prescription_id': str(prescription.id),
            'medication': prescription.medication_name,
            'entries_created': len(entries),
            'entries': [
                {
                    'id': str(e.id),
                    'scheduled_time': e.scheduled_time.isoformat(),
                    'status': e.status
                }
                for e in entries
            ]
        }, status=status.HTTP_201_CREATED)


# ========== Patient Timeline API ==========

@api_view(['GET'])
@api_permission_classes([permissions.IsAuthenticated])
def patient_timeline(request, patient_id):
    """
    Get a unified timeline of clinical events for a patient.

    Aggregates:
    - Clinical notes (NoteEntry)
    - Prescriptions
    - Vital signs
    - Referrals (sent and received)

    Query Parameters:
    - type: Filter by type (notes, vitals, prescriptions, referrals, all)
    - search: Text search across entries
    - page: Page number (default: 1)
    - page_size: Items per page (default: 20, max: 100)
    - start_date: Filter entries from this date (ISO format)
    - end_date: Filter entries until this date (ISO format)
    - encounter_id: Filter entries by specific encounter (UUID)

    Returns paginated timeline entries sorted by timestamp (newest first).
    """
    # Validate patient exists
    try:
        patient = PatientProfile.objects.get(id=patient_id)
    except PatientProfile.DoesNotExist:
        return Response(
            {'error': 'Patient not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # SECURITY: Check clinical data access
    check_clinical_access(request.user, patient)

    # Parse query parameters
    entry_type = request.query_params.get('type', 'all')
    search_query = request.query_params.get('search', '').strip()
    page = int(request.query_params.get('page', 1))
    page_size = min(int(request.query_params.get('page_size', 20)), 100)
    start_date = request.query_params.get('start_date')
    end_date = request.query_params.get('end_date')
    encounter_id = request.query_params.get('encounter_id')

    # Parse dates
    start_datetime = None
    end_datetime = None
    if start_date:
        try:
            start_datetime = timezone.datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except ValueError:
            pass
    if end_date:
        try:
            end_datetime = timezone.datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except ValueError:
            pass

    timeline_entries = []

    # Fetch notes
    if entry_type in ['all', 'notes']:
        notes = _get_patient_notes(patient, search_query, start_datetime, end_datetime, encounter_id)
        timeline_entries.extend(notes)

    # Fetch prescriptions
    if entry_type in ['all', 'prescriptions']:
        prescriptions = _get_patient_prescriptions(patient, search_query, start_datetime, end_datetime, encounter_id)
        timeline_entries.extend(prescriptions)

    # Fetch vitals
    if entry_type in ['all', 'vitals']:
        vitals = _get_patient_vitals(patient, search_query, start_datetime, end_datetime, encounter_id)
        timeline_entries.extend(vitals)

    # Fetch referrals
    if entry_type in ['all', 'referrals']:
        referrals = _get_patient_referrals(patient, search_query, start_datetime, end_datetime, encounter_id)
        timeline_entries.extend(referrals)

    # Fetch lab results (bundled by order)
    if entry_type in ['all', 'labs']:
        labs = _get_patient_labs(patient, search_query, start_datetime, end_datetime, encounter_id)
        timeline_entries.extend(labs)

    # Sort all entries by timestamp (newest first)
    timeline_entries.sort(key=lambda x: x['timestamp'], reverse=True)

    # Calculate pagination
    total_count = len(timeline_entries)
    total_pages = (total_count + page_size - 1) // page_size
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size

    paginated_entries = timeline_entries[start_idx:end_idx]

    return Response({
        'count': total_count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
        'has_next': page < total_pages,
        'has_previous': page > 1,
        'results': paginated_entries
    })


def _format_encounter_details(encounter):
    """
    Format encounter details for timeline entries.
    Returns None if no encounter.
    """
    if not encounter:
        return None

    return {
        'id': str(encounter.id),
        'type': encounter.encounter_type,
        'status': encounter.status,
        'start_time': encounter.start_time.isoformat() if encounter.start_time else None,
        'end_time': encounter.end_time.isoformat() if encounter.end_time else None,
        'reason': encounter.reason,
        'location': encounter.location,
        'practitioner_name': encounter.practitioner_name,
    }


def _get_patient_notes(patient, search_query, start_datetime, end_datetime, encounter_id=None):
    """
    Fetch and format clinical notes for a patient.
    """
    # Get notes for this patient using the patient FK
    # Also include legacy notes where patient is NULL (backwards compatibility)
    from django.db.models import Count
    notes_queryset = NoteEntry.objects.filter(
        Q(patient=patient) | Q(patient__isnull=True)
    ).select_related(
        'template', 'practitioner', 'practitioner__staff', 'practitioner__staff__user',
        'encounter', 'encounter__practitioner', 'encounter__practitioner__staff',
        'encounter__practitioner__staff__user'
    ).annotate(
        version_count=Count('versions')
    )

    # Filter by encounter if specified
    if encounter_id:
        notes_queryset = notes_queryset.filter(encounter_id=encounter_id)

    # Apply date filters
    if start_datetime:
        notes_queryset = notes_queryset.filter(created_at__gte=start_datetime)
    if end_datetime:
        notes_queryset = notes_queryset.filter(created_at__lte=end_datetime)

    # Apply search filter
    if search_query:
        notes_queryset = notes_queryset.filter(
            Q(template__title__icontains=search_query) |
            Q(data__icontains=search_query)
        )

    entries = []
    for note in notes_queryset[:500]:  # Limit to prevent memory issues
        # Try to get author name
        author_name = 'Unknown'
        if note.practitioner and note.practitioner.staff and note.practitioner.staff.user:
            user = note.practitioner.staff.user
            author_name = f"{user.first_name} {user.last_name}".strip() or user.email

        # Extract note type from template
        note_type = 'progress_note'
        if note.template:
            title_lower = note.template.title.lower()
            if 'soap' in title_lower:
                note_type = 'soap_note'
            elif 'admission' in title_lower:
                note_type = 'admission_note'
            elif 'discharge' in title_lower:
                note_type = 'discharge_note'
            elif 'consult' in title_lower:
                note_type = 'consult_note'
            elif 'nursing' in title_lower:
                note_type = 'nursing_note'

        # Extract title and content summary
        title = note.template.title if note.template else 'Clinical Note'
        content_summary = ''
        if isinstance(note.data, dict):
            # Try to extract key content
            for key in ['chief_complaint', 'subjective', 'assessment', 'notes', 'summary']:
                if key in note.data and note.data[key]:
                    content_summary = str(note.data[key])[:200]
                    break

        # Include template info for copy forward feature
        template_info = None
        if note.template:
            template_info = {
                'id': str(note.template.id),
                'title': note.template.title,
                'category': note.template.category,
                'structure': note.template.structure,
            }

        entries.append({
            'id': str(note.id),
            'type': note_type,
            'entry_type': 'note',
            'timestamp': note.created_at.isoformat(),
            'updated_at': note.updated_at.isoformat() if note.updated_at else None,
            'title': title,
            'content': content_summary,
            'author': author_name,
            'data': note.data,
            'template_id': str(note.template_id) if note.template_id else None,
            'template_title': note.template.title if note.template else None,
            'template': template_info,
            'encounter_id': str(note.encounter_id) if note.encounter_id else None,
            'encounter': _format_encounter_details(note.encounter),
            'version_count': note.version_count,
            'has_edits': note.version_count > 0,
        })

    return entries


def _get_patient_prescriptions(patient, search_query, start_datetime, end_datetime, encounter_id=None):
    """
    Fetch and format prescriptions for a patient.
    """
    prescriptions_queryset = Prescription.objects.filter(
        patient=patient
    ).select_related(
        'prescribed_by', 'prescribed_by__staff', 'prescribed_by__staff__user',
        'encounter', 'encounter__practitioner', 'encounter__practitioner__staff',
        'encounter__practitioner__staff__user'
    )

    # Filter by encounter if specified
    if encounter_id:
        prescriptions_queryset = prescriptions_queryset.filter(encounter_id=encounter_id)

    # Apply date filters
    if start_datetime:
        prescriptions_queryset = prescriptions_queryset.filter(created_at__gte=start_datetime)
    if end_datetime:
        prescriptions_queryset = prescriptions_queryset.filter(created_at__lte=end_datetime)

    # Apply search filter
    if search_query:
        prescriptions_queryset = prescriptions_queryset.filter(
            Q(medication_name__icontains=search_query) |
            Q(reason__icontains=search_query) |
            Q(instructions__icontains=search_query)
        )

    entries = []
    for rx in prescriptions_queryset[:500]:
        # Get prescriber name
        author_name = 'Unknown'
        if rx.prescribed_by and rx.prescribed_by.staff and rx.prescribed_by.staff.user:
            user = rx.prescribed_by.staff.user
            author_name = f"Dr. {user.first_name} {user.last_name}".strip()

        entries.append({
            'id': str(rx.id),
            'type': 'prescription',
            'entry_type': 'prescription',
            'timestamp': rx.created_at.isoformat(),
            'title': f'{rx.medication_name} {rx.dosage}',
            'content': f'{rx.get_route_display()} - {rx.get_frequency_display()}' +
                       (f' for {rx.duration_days} days' if rx.duration_days else ''),
            'author': author_name,
            'data': {
                'id': str(rx.id),
                'medication_name': rx.medication_name,
                'name': rx.medication_name,  # alias for frontend compatibility
                'dosage': rx.dosage,
                'dose': rx.dosage,  # alias for frontend compatibility
                'route': rx.route,
                'route_display': rx.get_route_display(),
                'frequency': rx.frequency,
                'frequency_display': rx.get_frequency_display(),
                'duration_days': rx.duration_days,
                'start_date': rx.start_date.isoformat() if rx.start_date else None,
                'end_date': rx.end_date.isoformat() if rx.end_date else None,
                'instructions': rx.instructions,
                'reason': rx.reason,
                'status': rx.status,
                'status_display': rx.get_status_display(),
                'discontinue_reason': rx.discontinue_reason if hasattr(rx, 'discontinue_reason') else None,
            },
            'status': rx.status,
            'encounter_id': str(rx.encounter_id) if rx.encounter_id else None,
            'encounter': _format_encounter_details(rx.encounter),
        })

    return entries


def _get_patient_vitals(patient, search_query, start_datetime, end_datetime, encounter_id=None):
    """
    Fetch and format vital signs for a patient.
    """
    vitals_queryset = VitalSigns.objects.filter(
        patient=patient
    ).select_related(
        'recorded_by', 'recorded_by__staff', 'recorded_by__staff__user',
        'encounter', 'encounter__practitioner', 'encounter__practitioner__staff',
        'encounter__practitioner__staff__user'
    )

    # Filter by encounter if specified
    if encounter_id:
        vitals_queryset = vitals_queryset.filter(encounter_id=encounter_id)

    # Apply date filters
    if start_datetime:
        vitals_queryset = vitals_queryset.filter(recorded_at__gte=start_datetime)
    if end_datetime:
        vitals_queryset = vitals_queryset.filter(recorded_at__lte=end_datetime)

    # Apply search filter (search in notes)
    if search_query:
        vitals_queryset = vitals_queryset.filter(
            Q(notes__icontains=search_query)
        )

    entries = []
    for vital in vitals_queryset[:500]:
        # Get recorder name
        author_name = 'Unknown'
        if vital.recorded_by and vital.recorded_by.staff and vital.recorded_by.staff.user:
            user = vital.recorded_by.staff.user
            author_name = f"{user.first_name} {user.last_name}".strip() or user.email

        # Build summary
        summary_parts = []
        if vital.temperature:
            summary_parts.append(f'Temp: {vital.temperature}°C')
        if vital.blood_pressure:
            summary_parts.append(f'BP: {vital.blood_pressure}')
        if vital.heart_rate:
            summary_parts.append(f'HR: {vital.heart_rate}')
        if vital.oxygen_saturation:
            summary_parts.append(f'SpO2: {vital.oxygen_saturation}%')
        if vital.respiratory_rate:
            summary_parts.append(f'RR: {vital.respiratory_rate}')

        entries.append({
            'id': str(vital.id),
            'type': 'vitals',
            'entry_type': 'vitals',
            'timestamp': vital.recorded_at.isoformat(),
            'title': 'Vital Signs',
            'content': ', '.join(summary_parts) if summary_parts else 'Vital signs recorded',
            'author': author_name,
            'data': {
                'temperature': float(vital.temperature) if vital.temperature else None,
                'heart_rate': vital.heart_rate,
                'blood_pressure': vital.blood_pressure,
                'blood_pressure_systolic': vital.blood_pressure_systolic,
                'blood_pressure_diastolic': vital.blood_pressure_diastolic,
                'respiratory_rate': vital.respiratory_rate,
                'oxygen_saturation': vital.oxygen_saturation,
                'pain_level': vital.pain_level,
                'notes': vital.notes,
            },
            'is_critical': vital.is_critical,
            'encounter_id': str(vital.encounter_id) if vital.encounter_id else None,
            'encounter': _format_encounter_details(vital.encounter),
        })

    return entries


def _get_patient_referrals(patient, search_query, start_datetime, end_datetime, encounter_id=None):
    """
    Fetch and format referrals for a patient (both sent and received consultations).
    """
    # Get referrals where patient is the subject - includes both outgoing and incoming
    referrals_queryset = Referral.objects.filter(
        patient=patient,
        status__in=['pending', 'accepted', 'scheduled', 'completed']
    ).select_related(
        'referring_provider', 'referring_provider__staff', 'referring_provider__staff__user',
        'referred_to_provider', 'referred_to_provider__staff', 'referred_to_provider__staff__user',
        'encounter', 'encounter__practitioner', 'encounter__practitioner__staff',
        'encounter__practitioner__staff__user',
        'consultation_encounter'
    )

    # Filter by encounter if specified
    if encounter_id:
        referrals_queryset = referrals_queryset.filter(
            Q(encounter_id=encounter_id) | Q(consultation_encounter_id=encounter_id)
        )

    # Apply date filters - use submitted_at as the primary timestamp
    if start_datetime:
        referrals_queryset = referrals_queryset.filter(
            Q(submitted_at__gte=start_datetime) | Q(created_at__gte=start_datetime)
        )
    if end_datetime:
        referrals_queryset = referrals_queryset.filter(
            Q(submitted_at__lte=end_datetime) | Q(created_at__lte=end_datetime)
        )

    # Apply search filter
    if search_query:
        referrals_queryset = referrals_queryset.filter(
            Q(reason__icontains=search_query) |
            Q(clinical_summary__icontains=search_query) |
            Q(specialist_notes__icontains=search_query) |
            Q(referred_to_department__icontains=search_query) |
            Q(referred_to_specialty__icontains=search_query)
        )

    entries = []
    for referral in referrals_queryset[:500]:
        # Get referring provider name
        referring_name = 'Unknown'
        if referral.referring_provider and referral.referring_provider.staff and referral.referring_provider.staff.user:
            user = referral.referring_provider.staff.user
            referring_name = f"Dr. {user.first_name} {user.last_name}".strip()

        # Get referred-to provider name
        referred_to_name = None
        if referral.referred_to_provider and referral.referred_to_provider.staff and referral.referred_to_provider.staff.user:
            user = referral.referred_to_provider.staff.user
            referred_to_name = f"Dr. {user.first_name} {user.last_name}".strip()

        # Determine the timestamp - use submitted_at if available, otherwise created_at
        timestamp = referral.submitted_at or referral.created_at

        # Build title based on status
        if referral.status == 'completed':
            title = f"Consultation Complete: {referral.referred_to_specialty or referral.referred_to_department}"
        elif referral.status == 'scheduled':
            title = f"Consultation Scheduled: {referral.referred_to_specialty or referral.referred_to_department}"
        elif referral.status == 'accepted':
            title = f"Referral Accepted: {referral.referred_to_specialty or referral.referred_to_department}"
        else:
            title = f"Referral: {referral.referred_to_specialty or referral.referred_to_department}"

        # Build content summary
        content = referral.reason[:200] if referral.reason else ''
        if referral.status == 'completed' and referral.specialist_notes:
            content = referral.specialist_notes[:200]

        entries.append({
            'id': str(referral.id),
            'type': 'referral',
            'entry_type': 'referral',
            'timestamp': timestamp.isoformat(),
            'title': title,
            'content': content,
            'author': referring_name,
            'data': {
                'referral_number': referral.referral_number,
                'status': referral.status,
                'status_display': referral.get_status_display(),
                'urgency': referral.urgency,
                'urgency_display': referral.get_urgency_display(),
                'is_urgent': referral.is_urgent,
                'referring_provider': referring_name,
                'referring_department': referral.referring_department,
                'referred_to_provider': referred_to_name,
                'referred_to_department': referral.referred_to_department,
                'referred_to_specialty': referral.referred_to_specialty,
                'reason': referral.reason,
                'clinical_summary': referral.clinical_summary,
                'questions_for_specialist': referral.questions_for_specialist,
                'specialist_notes': referral.specialist_notes,
                'recommendations': referral.recommendations,
                'submitted_at': referral.submitted_at.isoformat() if referral.submitted_at else None,
                'accepted_at': referral.accepted_at.isoformat() if referral.accepted_at else None,
                'completed_at': referral.completed_at.isoformat() if referral.completed_at else None,
                'referral_type': referral.referral_type,
                'consultation_workflow_id': str(referral.consultation_workflow_id) if referral.consultation_workflow_id else None,
            },
            'encounter_id': str(referral.encounter_id) if referral.encounter_id else None,
            'encounter': _format_encounter_details(referral.encounter),
            'consultation_encounter_id': str(referral.consultation_encounter_id) if referral.consultation_encounter_id else None,
        })

    return entries


def _get_patient_labs(patient, search_query, start_datetime, end_datetime, encounter_id=None):
    """
    Fetch and format completed lab orders for a patient's timeline.

    Lab results are bundled by order, not shown as individual results.
    Only completed orders (all results verified) are shown.
    """
    from django.db.models import Q as DQ, Prefetch
    from ..laboratory.models import LabOrderTest

    # Base queryset - only completed orders with verified results
    labs_queryset = LabOrder.objects.filter(
        patient=patient,
        status=LabOrderStatus.COMPLETED
    ).select_related(
        'ordering_provider', 'ordering_provider__staff', 'ordering_provider__staff__user',
        'encounter'
    ).prefetch_related(
        Prefetch(
            'order_tests',
            queryset=LabOrderTest.objects.select_related('test', 'result')
        ),
        'panels'
    )

    # Filter by encounter if specified
    if encounter_id:
        labs_queryset = labs_queryset.filter(encounter_id=encounter_id)

    # Apply date filters - use completed_at as the primary timestamp
    if start_datetime:
        labs_queryset = labs_queryset.filter(completed_at__gte=start_datetime)
    if end_datetime:
        labs_queryset = labs_queryset.filter(completed_at__lte=end_datetime)

    # Apply search filter
    if search_query:
        labs_queryset = labs_queryset.filter(
            DQ(order_number__icontains=search_query) |
            DQ(order_tests__test__name__icontains=search_query) |
            DQ(order_tests__test__short_name__icontains=search_query) |
            DQ(clinical_notes__icontains=search_query)
        ).distinct()

    entries = []
    for order in labs_queryset[:100]:
        # Get ordering provider name
        provider_name = 'Unknown'
        if order.ordering_provider and order.ordering_provider.staff and order.ordering_provider.staff.user:
            user = order.ordering_provider.staff.user
            provider_name = f"Dr. {user.first_name} {user.last_name}".strip()

        # Build test names and results
        order_tests = list(order.order_tests.all())
        test_names = [ot.test.short_name for ot in order_tests]

        # Gather results and calculate summary
        results = []
        summary = {'total': 0, 'normal': 0, 'abnormal': 0, 'critical': 0}

        for order_test in order_tests:
            result = getattr(order_test, 'result', None)
            if result:
                summary['total'] += 1

                # Categorize by flag
                if result.flag in ['critical_low', 'critical_high']:
                    summary['critical'] += 1
                elif result.flag in ['low', 'high', 'abnormal']:
                    summary['abnormal'] += 1
                else:
                    summary['normal'] += 1

                # Format reference range
                ref_range = None
                if result.reference_low is not None and result.reference_high is not None:
                    ref_range = f"{result.reference_low} - {result.reference_high}"
                elif result.reference_low is not None:
                    ref_range = f"> {result.reference_low}"
                elif result.reference_high is not None:
                    ref_range = f"< {result.reference_high}"

                results.append({
                    'test_name': order_test.test.short_name,
                    'test_full_name': order_test.test.name,
                    'value': result.value,
                    'unit': result.unit,
                    'reference_range': ref_range,
                    'flag': result.flag,
                    'flag_display': result.get_flag_display(),
                    'is_critical': result.is_critical(),
                    'is_abnormal': result.flag not in ['normal', None],
                    'interpretation': result.interpretation,
                })

        # Build title - use panel names if available, otherwise test names
        panels = list(order.panels.all())
        if panels:
            title = ', '.join(p.name for p in panels)
        elif len(test_names) <= 3:
            title = ', '.join(test_names)
        else:
            title = f"{test_names[0]} + {len(test_names) - 1} more tests"

        # Build content summary
        content_parts = [f"{summary['total']} results"]
        if summary['critical'] > 0:
            content_parts.append(f"{summary['critical']} critical")
        if summary['abnormal'] > 0:
            content_parts.append(f"{summary['abnormal']} abnormal")
        content = ' · '.join(content_parts)

        entries.append({
            'id': str(order.id),
            'type': 'lab_result',
            'entry_type': 'lab_result',
            'timestamp': order.completed_at.isoformat() if order.completed_at else order.created_at.isoformat(),
            'title': title,
            'content': content,
            'author': provider_name,
            'data': {
                'order_id': str(order.id),
                'order_number': order.order_number,
                'status': order.status,
                'priority': order.priority,
                'priority_display': order.get_priority_display(),
                'clinical_notes': order.clinical_notes,
                'ordered_at': order.ordered_at.isoformat() if order.ordered_at else None,
                'completed_at': order.completed_at.isoformat() if order.completed_at else None,
                'tests_ordered': test_names,
                'results_summary': summary,
                'results': results,
            },
            'encounter_id': str(order.encounter_id) if order.encounter_id else None,
            'encounter': _format_encounter_details(order.encounter),
        })

    return entries


@api_view(['GET'])
@api_permission_classes([permissions.IsAuthenticated])
def patient_clinical_summary(request, patient_id):
    """
    Get combined clinical summary for a patient in a single request.

    Returns:
    - Active medications/prescriptions
    - Recent vital signs (last 7 days)
    - Active problems/diagnoses (from notes and admissions)

    This is an optimized endpoint that combines multiple API calls into one.
    """
    try:
        # Try to find patient by local ID first, then by FHIR ID
        patient = PatientProfile.objects.filter(id=patient_id).first()
        if not patient:
            patient = PatientProfile.objects.filter(fhir_patient_id=patient_id).first()
        if not patient:
            return Response(
                {'error': 'Patient not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    except Exception:
        return Response(
            {'error': 'Patient not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # Get active prescriptions
    # Show all prescriptions with status='active' regardless of end_date
    # If a medication course is completed, its status should be changed to 'completed'
    active_prescriptions = Prescription.objects.filter(
        patient=patient,
        status='active'
    ).select_related('prescribed_by', 'prescribed_by__staff', 'prescribed_by__staff__user')

    medications = []
    for rx in active_prescriptions:
        prescriber_name = 'Unknown'
        if rx.prescribed_by and rx.prescribed_by.staff and rx.prescribed_by.staff.user:
            user = rx.prescribed_by.staff.user
            prescriber_name = f"Dr. {user.first_name} {user.last_name}".strip()

        medications.append({
            'id': str(rx.id),
            'medication_name': rx.medication_name,
            'dosage': rx.dosage,
            'route': rx.route,
            'route_display': rx.get_route_display(),
            'frequency': rx.frequency,
            'frequency_display': rx.get_frequency_display(),
            'status': rx.status,
            'start_date': rx.start_date.isoformat() if rx.start_date else None,
            'end_date': rx.end_date.isoformat() if rx.end_date else None,
            'prescribed_by_name': prescriber_name,
            'instructions': rx.instructions,
        })

    # Get recent vitals
    # First try to get vitals from the specified days window (default 7 days)
    # If none found, get the most recent vitals regardless of date
    days = int(request.query_params.get('days', 7))
    start_date = timezone.now() - timezone.timedelta(days=days)

    vitals = VitalSigns.objects.filter(
        patient=patient,
        recorded_at__gte=start_date
    ).select_related('recorded_by').order_by('recorded_at')

    # If no vitals in the time window, get the most recent ones (up to 5)
    # Order ascending so the frontend can take the last element as most recent
    if not vitals.exists():
        recent_vitals = VitalSigns.objects.filter(
            patient=patient
        ).select_related('recorded_by').order_by('-recorded_at')[:5]
        # Reverse to get ascending order (oldest first, newest last)
        vitals = list(reversed(list(recent_vitals)))

    vitals_data = []
    for vital in vitals:
        vitals_data.append({
            'id': str(vital.id),
            'recorded_at': vital.recorded_at.isoformat(),
            'temperature': float(vital.temperature) if vital.temperature else None,
            'heart_rate': vital.heart_rate,
            'blood_pressure': vital.blood_pressure,
            'respiratory_rate': vital.respiratory_rate,
            'oxygen_saturation': vital.oxygen_saturation,
            'is_critical': vital.is_critical,
        })

    # Get active problems/diagnoses from multiple sources
    problems = []
    seen_problems = set()  # Track unique problems by name to avoid duplicates

    # Source 1: Get diagnoses from recent clinical notes (Assessment section)
    # Look at the last 30 days of notes for active problems
    notes_start_date = timezone.now() - timezone.timedelta(days=30)
    recent_notes = NoteEntry.objects.filter(
        patient=patient,
        created_at__gte=notes_start_date
    ).select_related('template').order_by('-created_at')[:20]

    for note in recent_notes:
        note_data = note.data or {}
        # Look for Assessment section with Primary Diagnosis or Differential Diagnoses
        assessment = note_data.get('Assessment', {})

        # Handle both dict format (SOAP template) and string format (simple notes)
        if isinstance(assessment, dict):
            # Extract primary diagnosis from structured SOAP notes
            primary_dx = assessment.get('Primary Diagnosis', '')
            if primary_dx and primary_dx.strip():
                dx_text = primary_dx.strip()
                if dx_text.lower() not in seen_problems:
                    seen_problems.add(dx_text.lower())
                    problems.append({
                        'id': f'note-{note.id}-primary',
                        'name': dx_text,
                        'source': 'clinical_note',
                        'source_date': note.created_at.isoformat(),
                        'is_primary': True,
                        'severity': 'medium',
                    })

            # Extract differential diagnoses (if present)
            differential = assessment.get('Differential Diagnoses', '')
            if differential and differential.strip():
                # Split by common delimiters
                for dx in differential.replace('\n', ',').split(','):
                    dx_text = dx.strip().strip('-').strip('•').strip()
                    if dx_text and dx_text.lower() not in seen_problems:
                        seen_problems.add(dx_text.lower())
                        problems.append({
                            'id': f'note-{note.id}-diff-{len(problems)}',
                            'name': dx_text,
                            'source': 'clinical_note',
                            'source_date': note.created_at.isoformat(),
                            'is_primary': False,
                            'severity': 'low',
                        })
        elif isinstance(assessment, str) and assessment.strip():
            # Handle plain text Assessment (simple notes)
            # Take the first sentence or line as the primary diagnosis
            dx_text = assessment.strip().split('.')[0].split('\n')[0].strip()
            if dx_text and dx_text.lower() not in seen_problems:
                seen_problems.add(dx_text.lower())
                problems.append({
                    'id': f'note-{note.id}-assessment',
                    'name': dx_text,
                    'source': 'clinical_note',
                    'source_date': note.created_at.isoformat(),
                    'is_primary': True,
                    'severity': 'medium',
                })

    # Source 2: Get initial diagnosis from active admission workflow
    try:
        from apps.workflows.models import AdmissionWorkflow
        # AdmissionWorkflow is accessed through workflow.patient
        # Only consider in_progress admissions (completed means discharged)
        active_admission = AdmissionWorkflow.objects.filter(
            workflow__patient=patient,
            workflow__status='in_progress'
        ).select_related('workflow').order_by('-workflow__created_at').first()

        if active_admission and active_admission.initial_diagnosis:
            dx_text = active_admission.initial_diagnosis.strip()
            if dx_text and dx_text.lower() not in seen_problems:
                seen_problems.add(dx_text.lower())
                problems.insert(0, {  # Insert at beginning as it's the admission diagnosis
                    'id': f'admission-{active_admission.id}',
                    'name': dx_text,
                    'source': 'admission',
                    'source_date': active_admission.workflow.created_at.isoformat(),
                    'is_primary': True,
                    'severity': 'high',
                })
    except (ImportError, Exception):
        pass  # workflows app not available

    return Response({
        'medications': medications,
        'vitals': vitals_data,
        'problems': problems,
    })


@api_view(['GET'])
@api_permission_classes([permissions.IsAuthenticated])
def timeline_stats(request, patient_id):
    """
    Get statistics about a patient's timeline entries.

    Returns counts of each entry type and other useful metadata.
    """
    try:
        patient = PatientProfile.objects.get(id=patient_id)
    except PatientProfile.DoesNotExist:
        return Response(
            {'error': 'Patient not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # SECURITY: Check clinical data access
    check_clinical_access(request.user, patient)

    # Count entries by type
    notes_count = NoteEntry.objects.count()  # TODO: Filter by patient when we have proper linking
    prescriptions_count = Prescription.objects.filter(patient=patient).count()
    vitals_count = VitalSigns.objects.filter(patient=patient).count()

    # Get latest entries
    latest_vitals = VitalSigns.objects.filter(patient=patient).first()
    latest_prescription = Prescription.objects.filter(patient=patient).first()

    return Response({
        'total_entries': notes_count + prescriptions_count + vitals_count,
        'counts': {
            'notes': notes_count,
            'prescriptions': prescriptions_count,
            'vitals': vitals_count,
        },
        'latest': {
            'vitals_at': latest_vitals.recorded_at.isoformat() if latest_vitals else None,
            'prescription_at': latest_prescription.created_at.isoformat() if latest_prescription else None,
        },
        'active_prescriptions': Prescription.objects.filter(
            patient=patient,
            status='active'
        ).filter(
            Q(end_date__gte=timezone.now().date()) |
            Q(end_date__isnull=True)
        ).count()
    })


# =============================================================================
# Chronicle V2 Endpoints (Optimized)
# =============================================================================

@api_view(['GET'])
@api_permission_classes([permissions.IsAuthenticated])
def chronicle_context(request, patient_id):
    """
    Get patient context data for the Chronicle page.

    Returns consolidated patient info, allergies, active problems,
    active medications, and admission status in a single call.

    This endpoint consolidates multiple API calls into one for efficiency.
    """
    from datetime import date
    from apps.wards.models import Encounter

    # Validate patient exists
    try:
        patient = PatientProfile.objects.select_related('user').get(id=patient_id)
    except PatientProfile.DoesNotExist:
        return Response(
            {'error': 'Patient not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # SECURITY: Check clinical data access
    check_clinical_access(request.user, patient)

    user = patient.user

    # Calculate age
    age = None
    date_of_birth = user.date_of_birth if user else None
    if date_of_birth:
        today = date.today()
        age = today.year - date_of_birth.year - (
            (today.month, today.day) < (date_of_birth.month, date_of_birth.day)
        )

    # Build patient info
    patient_info = {
        'id': str(patient.id),
        'mrn': patient.medical_record_number,
        'name': user.get_full_name() if user else 'Unknown',
        'first_name': user.first_name if user else '',
        'last_name': user.last_name if user else '',
        'age': age,
        'gender': user.gender if user else None,
        'date_of_birth': date_of_birth.isoformat() if date_of_birth else None,
        'blood_type': patient.blood_group,
        'phone': user.phone_number if user else None,
        'email': user.email if user else None,
        'photo_url': None,  # PatientProfile doesn't have a photo field
    }

    # Parse allergies
    allergies = []
    if patient.allergies:
        allergy_text = patient.allergies
        if isinstance(allergy_text, str):
            # Split by common separators
            for sep in [',', ';', '\n']:
                if sep in allergy_text:
                    allergies = [a.strip() for a in allergy_text.split(sep) if a.strip()]
                    break
            if not allergies and allergy_text.strip():
                allergies = [allergy_text.strip()]

    # Get active problems/diagnoses from multiple sources
    problems = []
    seen_problems = set()  # Track unique problems by name to avoid duplicates

    # Source 1: Get diagnoses from recent clinical notes (Assessment section)
    notes_start_date = timezone.now() - timezone.timedelta(days=30)
    recent_notes = NoteEntry.objects.filter(
        patient=patient,
        created_at__gte=notes_start_date
    ).select_related('template').order_by('-created_at')[:20]

    for note in recent_notes:
        note_data = note.data or {}
        assessment = note_data.get('Assessment', {})

        if isinstance(assessment, dict):
            # Extract primary diagnosis from structured SOAP notes
            primary_dx = assessment.get('Primary Diagnosis', '')
            if primary_dx and primary_dx.strip():
                dx_text = primary_dx.strip()
                if dx_text.lower() not in seen_problems:
                    seen_problems.add(dx_text.lower())
                    problems.append({
                        'id': f'note-{note.id}-primary',
                        'name': dx_text,
                        'source': 'clinical_note',
                        'source_date': note.created_at.isoformat(),
                        'is_primary': True,
                        'severity': 'medium',
                    })

            # Extract differential diagnoses
            differential = assessment.get('Differential Diagnoses', '')
            if differential and differential.strip():
                for dx in differential.replace('\n', ',').split(','):
                    dx_text = dx.strip().strip('-').strip('•').strip()
                    if dx_text and dx_text.lower() not in seen_problems:
                        seen_problems.add(dx_text.lower())
                        problems.append({
                            'id': f'note-{note.id}-diff-{len(problems)}',
                            'name': dx_text,
                            'source': 'clinical_note',
                            'source_date': note.created_at.isoformat(),
                            'is_primary': False,
                            'severity': 'low',
                        })
        elif isinstance(assessment, str) and assessment.strip():
            # Handle plain text Assessment
            dx_text = assessment.strip().split('.')[0].split('\n')[0].strip()
            if dx_text and dx_text.lower() not in seen_problems:
                seen_problems.add(dx_text.lower())
                problems.append({
                    'id': f'note-{note.id}-assessment',
                    'name': dx_text,
                    'source': 'clinical_note',
                    'source_date': note.created_at.isoformat(),
                    'is_primary': True,
                    'severity': 'medium',
                })

    # Source 2: Get initial diagnosis from active admission workflow
    try:
        from apps.workflows.models import AdmissionWorkflow
        active_admission_wf = AdmissionWorkflow.objects.filter(
            workflow__patient=patient,
            workflow__status='in_progress'
        ).select_related('workflow').order_by('-workflow__created_at').first()

        if active_admission_wf and active_admission_wf.initial_diagnosis:
            dx_text = active_admission_wf.initial_diagnosis.strip()
            if dx_text and dx_text.lower() not in seen_problems:
                seen_problems.add(dx_text.lower())
                problems.insert(0, {
                    'id': f'admission-{active_admission_wf.id}',
                    'name': dx_text,
                    'source': 'admission',
                    'source_date': active_admission_wf.workflow.created_at.isoformat(),
                    'is_primary': True,
                    'severity': 'high',
                })
    except (ImportError, Exception):
        pass

    # Get admission status
    admission_status = None
    try:
        from apps.wards.models import Admission
        active_admission = Admission.objects.filter(
            patient=patient,
            status__in=['admitted', 'waiting']
        ).select_related('bed__ward').first()

        if active_admission:
            admission_status = {
                'is_admitted': True,
                'admission_id': str(active_admission.id),
                'ward_name': active_admission.bed.ward.name if active_admission.bed else None,
                'ward_id': str(active_admission.bed.ward.id) if active_admission.bed else None,
                'bed_number': active_admission.bed.bed_number if active_admission.bed else None,
                'admitted_at': active_admission.admission_date.isoformat() if active_admission.admission_date else None,
            }
    except (ImportError, Exception):
        pass

    # Get active encounter
    active_encounter = None
    try:
        encounter = Encounter.objects.filter(
            patient=patient,
            status__in=['planned', 'in-progress', 'onleave']
        ).order_by('-start_time').first()

        if encounter:
            active_encounter = {
                'id': str(encounter.id),
                'type': encounter.encounter_type,
                'status': encounter.status,
                'start_time': encounter.start_time.isoformat() if encounter.start_time else None,
                'reason': encounter.reason,
                'practitioner_name': encounter.practitioner_name,
            }
    except Exception:
        pass

    # Get active medications - show all with status='active'
    active_medications = []
    active_meds = Prescription.objects.filter(
        patient=patient,
        status='active'
    ).select_related('prescribed_by__staff__user').order_by('-created_at')[:20]

    for med in active_meds:
        active_medications.append({
            'id': str(med.id),
            'name': f"{med.medication_name} {med.dosage}",
            'medication_name': med.medication_name,
            'dosage': med.dosage,
            'frequency': med.get_frequency_display(),
            'route': med.get_route_display(),
            'status': med.status,
            'start_date': med.start_date.isoformat() if med.start_date else None,
            'end_date': med.end_date.isoformat() if med.end_date else None,
        })

    # Get latest vitals
    latest_vitals = None
    try:
        from apps.nursing.models import VitalSigns
        vital = VitalSigns.objects.filter(
            patient=patient
        ).order_by('-recorded_at').first()

        if vital:
            latest_vitals = {
                'id': str(vital.id),
                'recorded_at': vital.recorded_at.isoformat() if vital.recorded_at else None,
                'temperature': str(vital.temperature) if vital.temperature else None,
                'heart_rate': vital.heart_rate,
                'blood_pressure': vital.blood_pressure,
                'respiratory_rate': vital.respiratory_rate,
                'oxygen_saturation': vital.oxygen_saturation,
                'is_critical': getattr(vital, 'is_critical', False),
            }
    except (ImportError, Exception):
        pass

    return Response({
        'patient': patient_info,
        'allergies': allergies,
        'active_problems': problems,
        'active_medications': active_medications,
        'admission_status': admission_status,
        'active_encounter': active_encounter,
        'latest_vitals': latest_vitals,
    })


@api_view(['GET'])
@api_permission_classes([permissions.IsAuthenticated])
def patient_timeline_v2(request, patient_id):
    """
    Get patient timeline using TimelineEvent for efficient pagination.

    Uses the denormalized TimelineEvent table for O(1) database pagination,
    then fetches full details from source models for the paginated results.

    Query Parameters:
    - type: Filter by type (note, vitals, prescription, lab, referral, all)
    - search: Text search across entries
    - page: Page number (default: 1)
    - page_size: Items per page (default: 20, max: 100)
    - start_date: Filter entries from this date (ISO format)
    - end_date: Filter entries until this date (ISO format)
    - encounter_id: Filter entries by specific encounter (UUID)

    Returns paginated timeline entries with full source model details.
    """
    from .models import TimelineEvent
    from apps.wards.models import Encounter

    # Validate patient exists
    try:
        patient = PatientProfile.objects.get(id=patient_id)
    except PatientProfile.DoesNotExist:
        return Response(
            {'error': 'Patient not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # SECURITY: Check clinical data access
    check_clinical_access(request.user, patient)

    # Parse query parameters
    entry_type = request.query_params.get('type', 'all')
    search_query = request.query_params.get('search', '').strip()
    page = int(request.query_params.get('page', 1))
    page_size = min(int(request.query_params.get('page_size', 20)), 100)
    start_date = request.query_params.get('start_date')
    end_date = request.query_params.get('end_date')
    encounter_id = request.query_params.get('encounter_id')

    # Build base queryset on TimelineEvent
    events = TimelineEvent.objects.filter(patient=patient)

    # Apply type filter
    # Map frontend filter types to backend event_type
    type_mapping = {
        'notes': 'note',
        'vitals': 'vitals',
        'prescriptions': 'prescription',
        'labs': 'lab',
        'referrals': 'referral',
    }
    if entry_type != 'all':
        backend_type = type_mapping.get(entry_type, entry_type)
        events = events.filter(event_type=backend_type)

    # Apply search filter
    if search_query:
        events = events.filter(
            Q(title__icontains=search_query) |
            Q(content_summary__icontains=search_query) |
            Q(search_text__icontains=search_query)
        )

    # Apply date filters
    if start_date:
        try:
            start_datetime = timezone.datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            events = events.filter(timestamp__gte=start_datetime)
        except ValueError:
            pass
    if end_date:
        try:
            end_datetime = timezone.datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            events = events.filter(timestamp__lte=end_datetime)
        except ValueError:
            pass

    # Apply encounter filter
    if encounter_id:
        events = events.filter(encounter_id=encounter_id)

    # Order by timestamp (newest first)
    events = events.order_by('-timestamp')

    # Get total count (efficient single COUNT query)
    total_count = events.count()

    # Calculate pagination
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1
    offset = (page - 1) * page_size

    # Get paginated timeline events
    paginated_events = list(events[offset:offset + page_size])

    # Group events by source model to batch fetch details
    events_by_model = {}
    for event in paginated_events:
        if event.source_model not in events_by_model:
            events_by_model[event.source_model] = []
        events_by_model[event.source_model].append(event.source_id)

    # Fetch full source model data
    source_data = {}

    # Fetch NoteEntry details
    if 'NoteEntry' in events_by_model:
        notes = NoteEntry.objects.filter(
            id__in=events_by_model['NoteEntry']
        ).select_related(
            'template', 'practitioner__staff__user', 'encounter'
        ).prefetch_related('versions')
        for note in notes:
            source_data[('NoteEntry', str(note.id))] = note

    # Fetch Prescription details
    if 'Prescription' in events_by_model:
        prescriptions = Prescription.objects.filter(
            id__in=events_by_model['Prescription']
        ).select_related('prescribed_by__staff__user', 'encounter')
        for rx in prescriptions:
            source_data[('Prescription', str(rx.id))] = rx

    # Fetch VitalSigns details
    if 'VitalSigns' in events_by_model:
        vitals = VitalSigns.objects.filter(
            id__in=events_by_model['VitalSigns']
        ).select_related('recorded_by__staff__user', 'encounter')
        for v in vitals:
            source_data[('VitalSigns', str(v.id))] = v

    # Fetch LabOrder details
    if 'LabOrder' in events_by_model:
        labs = LabOrder.objects.filter(
            id__in=events_by_model['LabOrder']
        ).select_related(
            'ordering_provider__staff__user', 'encounter'
        ).prefetch_related('order_tests__test', 'order_tests__results')
        for lab in labs:
            source_data[('LabOrder', str(lab.id))] = lab

    # Fetch Referral details
    if 'Referral' in events_by_model:
        referrals = Referral.objects.filter(
            id__in=events_by_model['Referral']
        ).select_related(
            'referring_provider__staff__user',
            'referred_to_provider__staff__user',
            'encounter'
        )
        for ref in referrals:
            source_data[('Referral', str(ref.id))] = ref

    # Build response entries with full details
    results = []
    for event in paginated_events:
        source_obj = source_data.get((event.source_model, str(event.source_id)))
        entry = _build_timeline_entry_v2(event, source_obj)
        if entry:
            results.append(entry)

    return Response({
        'count': total_count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
        'has_next': page < total_pages,
        'has_previous': page > 1,
        'results': results,
    })


def _build_timeline_entry_v2(event, source_obj):
    """
    Build a full timeline entry from TimelineEvent and source model.

    Returns the same rich data structure as v1 patient_timeline.
    """
    if not source_obj:
        # Fallback to event data only if source not found
        return {
            'id': str(event.id),
            'type': event.event_type,
            'subtype': event.event_subtype,
            'timestamp': event.timestamp.isoformat(),
            'title': event.title,
            'content_summary': event.content_summary,
            'author_name': event.author_name,
            'is_critical': event.is_critical,
            'status': event.status,
            'encounter_id': str(event.encounter_id) if event.encounter_id else None,
        }

    # Build entry based on source model type
    if event.source_model == 'NoteEntry':
        return _format_note_entry_v2(source_obj, event)
    elif event.source_model == 'Prescription':
        return _format_prescription_entry_v2(source_obj, event)
    elif event.source_model == 'VitalSigns':
        return _format_vitals_entry_v2(source_obj, event)
    elif event.source_model == 'LabOrder':
        return _format_lab_entry_v2(source_obj, event)
    elif event.source_model == 'Referral':
        return _format_referral_entry_v2(source_obj, event)

    return None


def _format_note_entry_v2(note, event):
    """Format NoteEntry for timeline (full details like v1)."""
    # Get author name
    author_name = event.author_name or 'Unknown'

    # Extract note type from template
    note_type = 'progress_note'
    if note.template:
        title_lower = note.template.title.lower()
        if 'soap' in title_lower:
            note_type = 'soap_note'
        elif 'admission' in title_lower:
            note_type = 'admission_note'
        elif 'discharge' in title_lower:
            note_type = 'discharge_note'
        elif 'consult' in title_lower:
            note_type = 'consult_note'
        elif 'nursing' in title_lower:
            note_type = 'nursing_note'

    # Include template info for copy forward feature
    template_info = None
    if note.template:
        template_info = {
            'id': str(note.template.id),
            'title': note.template.title,
            'category': note.template.category,
            'structure': note.template.structure,
        }

    return {
        'id': str(note.id),
        'type': 'note',
        'note_type': note_type,
        'timestamp': note.created_at.isoformat(),
        'title': note.template.title if note.template else 'Clinical Note',
        'content_summary': event.content_summary,
        'author_name': author_name,
        'author_id': str(event.author_id) if event.author_id else None,
        'practitioner_id': str(note.practitioner_id) if note.practitioner_id else None,
        'data': note.data,  # Full note data
        'template': template_info,
        'encounter': _format_encounter_details(note.encounter),
        'encounter_id': str(note.encounter_id) if note.encounter_id else None,
        'has_edits': event.has_edits,
        'version_count': event.version_count,
        'composition_fhir_id': note.composition_fhir_id,
        'copied_from_id': str(note.copied_from_id) if note.copied_from_id else None,
        'created_at': note.created_at.isoformat(),
        'updated_at': note.updated_at.isoformat(),
    }


def _format_prescription_entry_v2(rx, event):
    """Format Prescription for timeline (full details like v1)."""
    return {
        'id': str(rx.id),
        'type': 'prescription',
        'timestamp': rx.created_at.isoformat(),
        'title': f"Rx: {rx.medication_name}",
        'content_summary': event.content_summary,
        'author_name': event.author_name,
        'author_id': str(event.author_id) if event.author_id else None,
        'medication_name': rx.medication_name,
        'dosage': rx.dosage,
        'route': rx.route,
        'route_display': rx.get_route_display(),
        'frequency': rx.frequency,
        'frequency_display': rx.get_frequency_display(),
        'duration_days': rx.duration_days,
        'start_date': rx.start_date.isoformat() if rx.start_date else None,
        'end_date': rx.end_date.isoformat() if rx.end_date else None,
        'instructions': rx.instructions,
        'reason': rx.reason,
        'status': rx.status,
        'is_critical': event.is_critical,
        'encounter': _format_encounter_details(rx.encounter),
        'encounter_id': str(rx.encounter_id) if rx.encounter_id else None,
        'created_at': rx.created_at.isoformat(),
        'updated_at': rx.updated_at.isoformat(),
    }


def _format_vitals_entry_v2(v, event):
    """Format VitalSigns for timeline (full details like v1)."""
    return {
        'id': str(v.id),
        'type': 'vitals',
        'timestamp': v.recorded_at.isoformat(),
        'title': 'Vital Signs',
        'content_summary': event.content_summary,
        'author_name': event.author_name,
        'author_id': str(event.author_id) if event.author_id else None,
        'temperature': float(v.temperature) if v.temperature else None,
        'heart_rate': v.heart_rate,
        'blood_pressure_systolic': v.blood_pressure_systolic,
        'blood_pressure_diastolic': v.blood_pressure_diastolic,
        'blood_pressure': v.blood_pressure,
        'respiratory_rate': v.respiratory_rate,
        'oxygen_saturation': v.oxygen_saturation,
        'pain_level': v.pain_level,
        'notes': v.notes,
        'is_critical': v.is_critical,
        'encounter': _format_encounter_details(v.encounter),
        'encounter_id': str(v.encounter_id) if v.encounter_id else None,
        'recorded_at': v.recorded_at.isoformat(),
        'created_at': v.created_at.isoformat(),
    }


def _format_lab_entry_v2(lab, event):
    """Format LabOrder for timeline (full details like v1)."""
    # Format tests
    tests = []
    for order_test in lab.order_tests.all():
        test_data = {
            'id': str(order_test.id),
            'test_id': str(order_test.test_id),
            'test_code': order_test.test.code,
            'test_name': order_test.test.name,
            'short_name': order_test.test.short_name,
            'status': order_test.status,
            'results': [],
        }
        # Include results if any
        for result in order_test.results.all():
            test_data['results'].append({
                'id': str(result.id),
                'value': result.value,
                'unit': result.unit,
                'reference_range': result.reference_range,
                'interpretation': result.interpretation,
                'is_abnormal': result.is_abnormal,
                'verified_at': result.verified_at.isoformat() if result.verified_at else None,
            })
        tests.append(test_data)

    return {
        'id': str(lab.id),
        'type': 'lab',
        'timestamp': lab.created_at.isoformat(),
        'title': f"Lab Order #{lab.order_number}",
        'content_summary': event.content_summary,
        'author_name': event.author_name,
        'author_id': str(event.author_id) if event.author_id else None,
        'order_number': lab.order_number,
        'status': lab.status,
        'priority': lab.priority,
        'is_critical': event.is_critical,
        'clinical_notes': getattr(lab, 'clinical_notes', ''),
        'tests': tests,
        'encounter': _format_encounter_details(lab.encounter),
        'encounter_id': str(lab.encounter_id) if lab.encounter_id else None,
        'created_at': lab.created_at.isoformat(),
    }


def _format_referral_entry_v2(ref, event):
    """Format Referral for timeline (full details like v1)."""
    return {
        'id': str(ref.id),
        'type': 'referral',
        'timestamp': ref.created_at.isoformat(),
        'title': f"Referral: {ref.referred_to_specialty}",
        'content_summary': event.content_summary,
        'author_name': event.author_name,
        'author_id': str(event.author_id) if event.author_id else None,
        'referral_number': ref.referral_number,
        'referred_to_specialty': ref.referred_to_specialty,
        'referred_to_department': ref.referred_to_department,
        'referred_to_provider_name': (
            ref.referred_to_provider.staff.user.get_full_name()
            if ref.referred_to_provider and ref.referred_to_provider.staff and ref.referred_to_provider.staff.user
            else None
        ),
        'urgency': ref.urgency,
        'status': ref.status,
        'is_critical': event.is_critical,
        'reason': ref.reason,
        'clinical_summary': ref.clinical_summary,
        'questions_for_specialist': ref.questions_for_specialist,
        'specialist_notes': ref.specialist_notes,
        'recommendations': ref.recommendations,
        'encounter': _format_encounter_details(ref.encounter),
        'encounter_id': str(ref.encounter_id) if ref.encounter_id else None,
        'created_at': ref.created_at.isoformat(),
    }
