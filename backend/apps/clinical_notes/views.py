from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action, api_view, permission_classes as api_permission_classes
from rest_framework.pagination import CursorPagination
from django.db import transaction, models
from django.db.models import Q
from django.utils import timezone
from itertools import chain
from operator import attrgetter
import logging

from .models import NoteTemplate, NoteEntry, Prescription
from .serializers import (
    NoteTemplateSerializer, NoteTemplateListSerializer, NoteEntrySerializer,
    PrescriptionSerializer, PrescriptionCreateSerializer,
    PrescriptionUpdateSerializer, PrescriptionDiscontinueSerializer
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

logger = logging.getLogger(__name__)


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
            return Response(
                {"error": f"Failed to create note entry: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

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

        # Process each section in the template
        for section in template.structure:
            section_name = section['section']
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

        # Add sections based on template structure
        for section in template.structure:
            section_name = section['section']
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

    def get_serializer_class(self):
        if self.action == 'create':
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

        # Return full serialized data with encounter_created flag
        output_serializer = PrescriptionSerializer(prescription)
        response_data = output_serializer.data
        response_data['encounter_created'] = encounter_created

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

    Query Parameters:
    - type: Filter by type (notes, vitals, prescriptions, all)
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
    notes_queryset = NoteEntry.objects.filter(
        Q(patient=patient) | Q(patient__isnull=True)
    ).select_related(
        'template', 'practitioner', 'practitioner__staff', 'practitioner__staff__user',
        'encounter', 'encounter__practitioner', 'encounter__practitioner__staff',
        'encounter__practitioner__staff__user'
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

        entries.append({
            'id': str(note.id),
            'type': note_type,
            'entry_type': 'note',
            'timestamp': note.created_at.isoformat(),
            'title': title,
            'content': content_summary,
            'author': author_name,
            'data': note.data,
            'encounter_id': str(note.encounter_id) if note.encounter_id else None,
            'encounter': _format_encounter_details(note.encounter),
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


@api_view(['GET'])
@api_permission_classes([permissions.IsAuthenticated])
def patient_clinical_summary(request, patient_id):
    """
    Get combined clinical summary for a patient in a single request.

    Returns:
    - Active medications/prescriptions
    - Recent vital signs (last 7 days)

    This is an optimized endpoint that combines multiple API calls into one.
    """
    try:
        patient = PatientProfile.objects.get(id=patient_id)
    except PatientProfile.DoesNotExist:
        return Response(
            {'error': 'Patient not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    # Get active prescriptions
    active_prescriptions = Prescription.objects.filter(
        patient=patient,
        status='active'
    ).filter(
        models.Q(end_date__gte=timezone.now().date()) |
        models.Q(end_date__isnull=True)
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

    # Get recent vitals (last 7 days)
    days = int(request.query_params.get('days', 7))
    start_date = timezone.now() - timezone.timedelta(days=days)

    vitals = VitalSigns.objects.filter(
        patient=patient,
        recorded_at__gte=start_date
    ).select_related('recorded_by').order_by('recorded_at')

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

    return Response({
        'medications': medications,
        'vitals': vitals_data,
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
