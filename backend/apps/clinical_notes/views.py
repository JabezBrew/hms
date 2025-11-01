from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from django.db import transaction, models
from django.utils import timezone

from .models import NoteTemplate, NoteEntry
from .serializers import NoteTemplateSerializer, NoteEntrySerializer
from ..users.permissions import IsAdminOrDoctor, IsAdminOrNurse
from ..users.models import PractitionerProfile
from ..fhir_client.client import fhir_client
from ..fhir_client.utils import (
    generate_fhir_id, create_reference, create_codeable_concept, create_coding
)


class NoteTemplateViewSet(viewsets.ModelViewSet):
    """
    API endpoint for note templates.
    """
    queryset = NoteTemplate.objects.all()
    serializer_class = NoteTemplateSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrDoctor | IsAdminOrNurse]

    def get_queryset(self):
        """
        Filter templates based on query parameters and user role.
        Templates are visible to a user if:
        1. They are public AND not a nursing template (for non-nurses), or
        2. They are public AND user is a nurse (for nursing templates), or
        3. The user created them, or
        4. They were created by a user with the same role (except for admins who can see all)
        """
        user = self.request.user

        # Admins can see all templates
        if user.user_type == 'admin':
            queryset = NoteTemplate.objects.all()
        elif user.user_type == 'nurse':
            # Nurses can see public templates, templates they created, and templates created by other nurses
            queryset = NoteTemplate.objects.filter(
                models.Q(is_public=True) | 
                models.Q(created_by=user) |
                models.Q(created_by__user_type='nurse')
            )
        else:
            # For non-nurses, filter out nursing templates
            queryset = NoteTemplate.objects.filter(
                (models.Q(is_public=True) & ~models.Q(title__icontains='nursing')) | 
                models.Q(created_by=user) |
                models.Q(created_by__user_type=user.user_type)
            )

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        # Filter by title
        title = self.request.query_params.get('title')
        if title:
            queryset = queryset.filter(title__icontains=title)

        # Filter by public status
        is_public = self.request.query_params.get('is_public')
        if is_public is not None:
            queryset = queryset.filter(is_public=is_public.lower() == 'true')

        return queryset

    def perform_update(self, serializer):
        """
        Set the updated_by field when updating a template.
        """
        serializer.save(updated_by=self.request.user)


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
        queryset = NoteEntry.objects.all()

        # Filter by encounter ID
        encounter_id = self.request.query_params.get('encounter_id')
        if encounter_id:
            queryset = queryset.filter(encounter_id=encounter_id)

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
        
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        try:
            # Get template and data
            template = serializer.validated_data['template']
            encounter_id = serializer.validated_data['encounter_id']
            note_data = serializer.validated_data['data']

            # Create FHIR resources and Composition
            fhir_resources = self._create_fhir_resources(template, encounter_id, note_data)

            # Create Composition resource
            composition = self._create_composition(
                template, 
                encounter_id, 
                practitioner_profile.fhir_practitioner_id,
                note_data, 
                fhir_resources
            )

            # Save the Composition ID to the note entry
            serializer.validated_data['composition_fhir_id'] = composition['id']

            # Save the note entry
            note_entry = serializer.save()

            return Response(serializer.data, status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response(
                {"error": f"Failed to create FHIR resources: {str(e)}"},
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
        # Get the encounter to extract patient reference
        try:
            encounter = fhir_client.get_resource("Encounter", encounter_id)
            patient_reference = encounter.get("subject", {})
        except Exception as e:
            # Log the error
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error fetching encounter {encounter_id}: {str(e)}")
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
