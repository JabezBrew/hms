"""
Unit tests for the FHIR client.
"""
from django.test import TestCase
from unittest.mock import patch, MagicMock
from .client import FHIRClient
from .utils import (
    generate_fhir_id, create_reference, extract_id_from_reference,
    extract_resource_type_from_reference, create_identifier, find_identifier,
    create_coding, create_codeable_concept, create_quantity, create_period,
    create_human_name, create_address, create_contact_point
)


class FHIRClientTests(TestCase):
    """
    Test cases for the FHIR client.
    """
    def setUp(self):
        self.client = FHIRClient()
        
    def test_build_url(self):
        """
        Test building URLs for FHIR API requests.
        """
        # Test URL for resource type only
        url = self.client._build_url("Patient")
        self.assertTrue(url.endswith("/fhir/Patient"))
        
        # Test URL for resource type and ID
        url = self.client._build_url("Patient", "123")
        self.assertTrue(url.endswith("/fhir/Patient/123"))
        
        # Test URL for resource type, ID, and operation
        url = self.client._build_url("Patient", "123", "_history")
        self.assertTrue(url.endswith("/fhir/Patient/123/_history"))
        
    def test_mock_mode_get(self):
        """
        Test that the client returns mock data in mock mode for GET requests.
        """
        # Ensure client is in mock mode
        self.client.session = None
        
        # Test GET request for a Patient resource
        url = self.client._build_url("Patient", "mock-id")
        response = self.client.query_with_retries("GET", url)
        self.assertEqual(response.get("resourceType"), "Patient")
        self.assertEqual(response.get("id"), "mock-id")
        
        # Test GET request for a search
        url = self.client._build_url("Patient")
        response = self.client.query_with_retries("GET", url, params={"name": "test"})
        self.assertEqual(response.get("resourceType"), "Bundle")
        self.assertEqual(response.get("type"), "searchset")
        
    def test_mock_mode_post(self):
        """
        Test that the client returns mock data in mock mode for POST requests.
        """
        # Ensure client is in mock mode
        self.client.session = None
        
        # Test POST request to create a resource
        data = {
            "resourceType": "Patient",
            "name": [{"family": "Smith", "given": ["John"]}]
        }
        response = self.client.create_resource("Patient", data)
        self.assertTrue(response.get("id", "").startswith("mock-"))
        self.assertEqual(response.get("name"), data.get("name"))
        
    def test_mock_mode_put(self):
        """
        Test that the client returns mock data in mock mode for PUT requests.
        """
        # Ensure client is in mock mode
        self.client.session = None
        
        # Test PUT request to update a resource
        data = {
            "resourceType": "Patient",
            "id": "123",
            "name": [{"family": "Smith", "given": ["John"]}]
        }
        response = self.client.update_resource("Patient", "123", data)
        self.assertTrue(response.get("id", "").startswith("mock-"))
        self.assertEqual(response.get("name"), data.get("name"))
        
    def test_mock_mode_delete(self):
        """
        Test that the client returns mock data in mock mode for DELETE requests.
        """
        # Ensure client is in mock mode
        self.client.session = None
        
        # Test DELETE request
        response = self.client.delete_resource("Patient", "123")
        self.assertEqual(response, {})
        
    @patch('google.auth.transport.requests.AuthorizedSession')
    def test_query_with_retries(self, mock_session):
        """
        Test that the client retries failed requests.
        """
        # Mock the session
        mock_response = MagicMock()
        mock_response.json.return_value = {"resourceType": "Patient", "id": "123"}
        mock_response.content = b'{"resourceType": "Patient", "id": "123"}'
        mock_session.return_value.request.return_value = mock_response
        
        # Create a client with the mocked session
        self.client.session = mock_session.return_value
        
        # Test a successful request
        response = self.client.query_with_retries("GET", "https://example.com")
        self.assertEqual(response.get("resourceType"), "Patient")
        self.assertEqual(response.get("id"), "123")
        
        # Test that the request was called once
        mock_session.return_value.request.assert_called_once()


class FHIRUtilsTests(TestCase):
    """
    Test cases for the FHIR utility functions.
    """
    def test_generate_fhir_id(self):
        """
        Test generating a FHIR ID.
        """
        id1 = generate_fhir_id()
        id2 = generate_fhir_id()
        
        # IDs should be strings
        self.assertIsInstance(id1, str)
        self.assertIsInstance(id2, str)
        
        # IDs should be 32 characters long (UUID without hyphens)
        self.assertEqual(len(id1), 32)
        self.assertEqual(len(id2), 32)
        
        # IDs should be unique
        self.assertNotEqual(id1, id2)
        
    def test_create_reference(self):
        """
        Test creating a FHIR reference.
        """
        reference = create_reference("Patient", "123")
        self.assertEqual(reference, {"reference": "Patient/123"})
        
    def test_extract_id_from_reference(self):
        """
        Test extracting an ID from a FHIR reference.
        """
        # Valid reference
        id = extract_id_from_reference("Patient/123")
        self.assertEqual(id, "123")
        
        # Invalid reference
        id = extract_id_from_reference("Invalid")
        self.assertIsNone(id)
        
        # Empty reference
        id = extract_id_from_reference("")
        self.assertIsNone(id)
        
    def test_extract_resource_type_from_reference(self):
        """
        Test extracting a resource type from a FHIR reference.
        """
        # Valid reference
        resource_type = extract_resource_type_from_reference("Patient/123")
        self.assertEqual(resource_type, "Patient")
        
        # Invalid reference
        resource_type = extract_resource_type_from_reference("Invalid")
        self.assertIsNone(resource_type)
        
        # Empty reference
        resource_type = extract_resource_type_from_reference("")
        self.assertIsNone(resource_type)
        
    def test_create_identifier(self):
        """
        Test creating a FHIR identifier.
        """
        identifier = create_identifier("http://example.org/fhir/identifier/mrn", "MRN123")
        self.assertEqual(identifier, {
            "system": "http://example.org/fhir/identifier/mrn",
            "value": "MRN123"
        })
        
    def test_find_identifier(self):
        """
        Test finding an identifier by system.
        """
        identifiers = [
            {"system": "http://example.org/fhir/identifier/mrn", "value": "MRN123"},
            {"system": "http://example.org/fhir/identifier/ssn", "value": "SSN456"}
        ]
        
        # Find existing identifier
        value = find_identifier(identifiers, "http://example.org/fhir/identifier/mrn")
        self.assertEqual(value, "MRN123")
        
        # Find non-existent identifier
        value = find_identifier(identifiers, "http://example.org/fhir/identifier/other")
        self.assertIsNone(value)
        
        # Empty identifiers list
        value = find_identifier([], "http://example.org/fhir/identifier/mrn")
        self.assertIsNone(value)
        
    def test_create_coding(self):
        """
        Test creating a FHIR coding.
        """
        # Coding with display
        coding = create_coding("http://loinc.org", "8480-6", "Systolic blood pressure")
        self.assertEqual(coding, {
            "system": "http://loinc.org",
            "code": "8480-6",
            "display": "Systolic blood pressure"
        })
        
        # Coding without display
        coding = create_coding("http://loinc.org", "8480-6")
        self.assertEqual(coding, {
            "system": "http://loinc.org",
            "code": "8480-6"
        })
        
    def test_create_codeable_concept(self):
        """
        Test creating a FHIR CodeableConcept.
        """
        coding = [
            {"system": "http://loinc.org", "code": "8480-6", "display": "Systolic blood pressure"}
        ]
        
        # CodeableConcept with text
        concept = create_codeable_concept(coding, "Systolic blood pressure")
        self.assertEqual(concept, {
            "coding": coding,
            "text": "Systolic blood pressure"
        })
        
        # CodeableConcept without text
        concept = create_codeable_concept(coding)
        self.assertEqual(concept, {
            "coding": coding
        })
        
    def test_create_quantity(self):
        """
        Test creating a FHIR Quantity.
        """
        # Quantity with code
        quantity = create_quantity(120, "mmHg", "http://unitsofmeasure.org", "mm[Hg]")
        self.assertEqual(quantity, {
            "value": 120,
            "unit": "mmHg",
            "system": "http://unitsofmeasure.org",
            "code": "mm[Hg]"
        })
        
        # Quantity without code
        quantity = create_quantity(120, "mmHg")
        self.assertEqual(quantity, {
            "value": 120,
            "unit": "mmHg",
            "system": "http://unitsofmeasure.org"
        })
        
    def test_create_period(self):
        """
        Test creating a FHIR Period.
        """
        # Period with start and end
        period = create_period("2023-01-01", "2023-12-31")
        self.assertEqual(period, {
            "start": "2023-01-01",
            "end": "2023-12-31"
        })
        
        # Period with only start
        period = create_period("2023-01-01")
        self.assertEqual(period, {
            "start": "2023-01-01"
        })
        
        # Period with only end
        period = create_period(end="2023-12-31")
        self.assertEqual(period, {
            "end": "2023-12-31"
        })
        
        # Empty period
        period = create_period()
        self.assertEqual(period, {})
        
    def test_create_human_name(self):
        """
        Test creating a FHIR HumanName.
        """
        # Name with prefix and suffix
        name = create_human_name("Smith", ["John", "Doe"], ["Dr."], ["Jr."], "official")
        self.assertEqual(name, {
            "family": "Smith",
            "given": ["John", "Doe"],
            "prefix": ["Dr."],
            "suffix": ["Jr."],
            "use": "official"
        })
        
        # Name without prefix and suffix
        name = create_human_name("Smith", ["John"])
        self.assertEqual(name, {
            "family": "Smith",
            "given": ["John"],
            "use": "official"
        })
        
    def test_create_address(self):
        """
        Test creating a FHIR Address.
        """
        address = create_address(
            ["123 Main St", "Apt 4B"],
            "Anytown",
            "CA",
            "12345",
            "USA",
            "home"
        )
        self.assertEqual(address, {
            "line": ["123 Main St", "Apt 4B"],
            "city": "Anytown",
            "state": "CA",
            "postalCode": "12345",
            "country": "USA",
            "use": "home"
        })
        
    def test_create_contact_point(self):
        """
        Test creating a FHIR ContactPoint.
        """
        # ContactPoint with rank
        contact = create_contact_point("phone", "555-123-4567", "home", 1)
        self.assertEqual(contact, {
            "system": "phone",
            "value": "555-123-4567",
            "use": "home",
            "rank": 1
        })
        
        # ContactPoint without rank
        contact = create_contact_point("email", "test@example.com", "work")
        self.assertEqual(contact, {
            "system": "email",
            "value": "test@example.com",
            "use": "work"
        })
