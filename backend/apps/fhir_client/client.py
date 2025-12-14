"""
FHIR Client for Google Cloud Healthcare API.

Uses circuit breaker pattern to prevent cascading failures when the
FHIR service is unavailable.
"""
import os
import json
import logging
import time
import uuid
from typing import Dict, List, Optional, Union, Any

import google.auth
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from django.conf import settings

from apps.core.circuit_breaker import CircuitBreaker, CircuitOpenError

logger = logging.getLogger(__name__)

# Circuit breaker for FHIR API calls
# Opens after 5 failures, resets after 60 seconds
fhir_circuit_breaker = CircuitBreaker(
    name='fhir_api',
    failure_threshold=5,
    reset_timeout=60,
    half_open_max_calls=3
)


class FHIRClient:
    """
    Client for interacting with Google Cloud Healthcare API's FHIR service.
    """
    def __init__(self):
        """
        Initialize the FHIR client with Google Cloud credentials.
        """
        self.project_id = settings.GOOGLE_CLOUD_PROJECT
        self.location = 'europe-west3'  # Default location
        self.dataset_id = settings.GOOGLE_HEALTHCARE_DATASET
        self.fhir_store_id = settings.GOOGLE_FHIR_STORE

        # Set up authentication
        self.credentials = None
        creds_value = settings.GOOGLE_APPLICATION_CREDENTIALS

        if creds_value:
            # Option 1: It's a file path that exists
            if os.path.exists(creds_value):
                try:
                    self.credentials = service_account.Credentials.from_service_account_file(
                        creds_value,
                        scopes=['https://www.googleapis.com/auth/cloud-platform']
                    )
                    logger.info("Loaded Google Cloud credentials from file")
                except Exception as e:
                    logger.warning(f"Failed to load credentials from file: {str(e)}")

            # Option 2: It's JSON content (common in Railway/Heroku)
            elif creds_value.strip().startswith('{'):
                try:
                    creds_info = json.loads(creds_value)
                    self.credentials = service_account.Credentials.from_service_account_info(
                        creds_info,
                        scopes=['https://www.googleapis.com/auth/cloud-platform']
                    )
                    logger.info("Loaded Google Cloud credentials from JSON env var")
                except Exception as e:
                    logger.warning(f"Failed to load credentials from JSON: {str(e)}")
            else:
                logger.warning(f"GOOGLE_APPLICATION_CREDENTIALS is set but not a valid file path or JSON")
        else:
            logger.warning("GOOGLE_APPLICATION_CREDENTIALS not configured - FHIR client will operate in mock mode")

        # Create session if credentials are available
        if self.credentials:
            self.session = AuthorizedSession(self.credentials)
        else:
            # In development mode, we'll mock the session later when needed
            self.session = None
            logger.warning("No valid credentials available. FHIR client will operate in mock mode.")

        self.base_url = f"https://healthcare.googleapis.com/v1/projects/{self.project_id}/locations/{self.location}/datasets/{self.dataset_id}/fhirStores/{self.fhir_store_id}/fhir"

    def _build_url(self, resource_type: str, resource_id: Optional[str] = None, operation: Optional[str] = None) -> str:
        """
        Build the URL for a FHIR API request.

        Args:
            resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
            resource_id: Optional resource ID for specific resource operations
            operation: Optional operation to perform (e.g., '_search', '_history')

        Returns:
            The complete URL for the FHIR API request
        """
        url = f"{self.base_url}/{resource_type}"

        if resource_id:
            url = f"{url}/{resource_id}"

        if operation:
            url = f"{url}/{operation}"

        return url

    def query_with_retries(self, method: str, url: str, json_data: Optional[Dict] = None,
                          params: Optional[Dict] = None, max_retries: int = 3,
                          retry_delay: int = 1, timeout: int = 10) -> Dict:
        """
        Execute a request to the FHIR API with retry logic and circuit breaker protection.

        The circuit breaker prevents cascading failures:
        - Opens after 5 consecutive failures
        - Stays open for 60 seconds before allowing test requests
        - Returns to closed state after 3 successful test requests
        """
        # If we're in mock mode (no valid credentials/session), return mock data
        if self.session is None:
            logger.info(f"Mock mode: Simulating {method} request to {url}")
            if method == 'GET':
                # For GET requests, check if we're requesting a specific resource
                parts = url.split('/')
                if len(parts) > 1 and parts[-2] in ['Patient', 'Practitioner', 'Organization']:
                    # Return a specific resource
                    return {
                        "resourceType": parts[-2],
                        "id": parts[-1] if parts[-1] != parts[-2] else "mock-id",
                        "meta": {"versionId": "1"}
                    }
                else:
                    # Return a bundle for search requests
                    return {
                        "resourceType": "Bundle",
                        "type": "searchset",
                        "total": 0,
                        "entry": []
                    }
            elif method in ['POST', 'PUT']:
                # For POST/PUT requests, return the input data with a unique mock ID
                mock_id = f"mock-{uuid.uuid4().hex[:12]}"
                if json_data:
                    result = json_data.copy()
                    result["id"] = mock_id
                    result["meta"] = {"versionId": "1"}
                    return result
                return {"id": mock_id, "meta": {"versionId": "1"}}
            elif method == 'DELETE':
                # For DELETE requests, return an empty dict
                return {}
            return {}

        # Check circuit breaker state before attempting request
        try:
            # Use circuit breaker to protect against cascading failures
            def make_request():
                return self._execute_request(method, url, json_data, params, max_retries, retry_delay, timeout)

            return fhir_circuit_breaker.call(make_request)

        except CircuitOpenError as e:
            logger.warning(f"FHIR circuit breaker is open: {e.message}")
            # Return empty result or raise depending on use case
            # For now, raise to let callers handle gracefully
            raise

    def _execute_request(self, method: str, url: str, json_data: Optional[Dict] = None,
                        params: Optional[Dict] = None, max_retries: int = 3,
                        retry_delay: int = 1, timeout: int = 10) -> Dict:
        """
        Internal method to execute the actual HTTP request with retry logic.
        Called by query_with_retries through the circuit breaker.
        """
        retries = 0
        last_error = None

        while retries < max_retries:
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    json=json_data,
                    params=params,
                    timeout=timeout
                )

                response.raise_for_status()

                if response.content:
                    return response.json()
                return {}

            except Exception as e:
                last_error = e
                retries += 1
                if retries >= max_retries:
                    logger.error(f"Failed after {max_retries} retries: {str(e)}")
                    raise

                logger.warning(f"Retry {retries}/{max_retries} after error: {str(e)}")
                # Exponential backoff: 1s, 2s, 4s
                time.sleep(retry_delay * (2 ** (retries - 1)))

    def create_resource(self, resource_type: str, data: Dict) -> Dict:
        """
        Create a new FHIR resource.

        Args:
            resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
            data: The resource data

        Returns:
            The created resource
        """
        url = self._build_url(resource_type)
        return self.query_with_retries('POST', url, json_data=data)

    def get_resource(self, resource_type: str, resource_id: str) -> Dict:
        """
        Get a specific FHIR resource by ID.

        Args:
            resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
            resource_id: The resource ID

        Returns:
            The requested resource
        """
        url = self._build_url(resource_type, resource_id)
        return self.query_with_retries('GET', url)

    def update_resource(self, resource_type: str, resource_id: str, data: Dict) -> Dict:
        """
        Update an existing FHIR resource.

        Args:
            resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
            resource_id: The resource ID
            data: The updated resource data

        Returns:
            The updated resource
        """
        url = self._build_url(resource_type, resource_id)
        return self.query_with_retries('PUT', url, json_data=data)

    def delete_resource(self, resource_type: str, resource_id: str) -> Dict:
        """
        Delete a FHIR resource.

        Args:
            resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
            resource_id: The resource ID

        Returns:
            Empty dict or operation outcome
        """
        url = self._build_url(resource_type, resource_id)
        return self.query_with_retries('DELETE', url)

    def search_resources(self, resource_type: str, params: Dict, timeout: int = 10) -> Dict:
        """
        Search for FHIR resources.

        Args:
            resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
            params: Search parameters
            timeout: Request timeout in seconds

        Returns:
            Bundle of matching resources
        """
        url = self._build_url(resource_type)
        return self.query_with_retries('GET', url, params=params, timeout=timeout)

    def execute_bundle(self, bundle: Dict) -> Dict:
        """
        Execute a FHIR transaction or batch bundle.

        Args:
            bundle: The FHIR Bundle resource

        Returns:
            The response Bundle
        """
        url = self.base_url
        return self.query_with_retries('POST', url, json_data=bundle)


# Create a singleton instance
fhir_client = FHIRClient()
