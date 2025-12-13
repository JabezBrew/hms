"""
FHIR Client for Google Cloud Healthcare API.
"""
import os
import json
import logging
import time
from typing import Dict, List, Optional, Union, Any

import google.auth
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from django.conf import settings

logger = logging.getLogger(__name__)


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
        if settings.GOOGLE_APPLICATION_CREDENTIALS and os.path.exists(settings.GOOGLE_APPLICATION_CREDENTIALS):
            try:
                self.credentials = service_account.Credentials.from_service_account_file(
                    settings.GOOGLE_APPLICATION_CREDENTIALS,
                    scopes=['https://www.googleapis.com/auth/cloud-platform']
                )
            except Exception as e:
                logger.warning(f"Failed to load credentials from file: {str(e)}")
        else:
            # Use default credentials
            logger.warning("Google cloud authentication failed")

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
                          retry_delay: int = 1) -> Dict:
        """
        Execute a request to the FHIR API with retry logic.
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
                # For POST/PUT requests, return the input data with a mock ID
                if json_data:
                    result = json_data.copy()
                    result["id"] = "mock-id"
                    result["meta"] = {"versionId": "1"}
                    return result
                return {"id": "mock-id", "meta": {"versionId": "1"}}
            elif method == 'DELETE':
                # For DELETE requests, return an empty dict
                return {}
            return {}

        # Normal operation with valid session
        retries = 0
        while retries < max_retries:
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    json=json_data,
                    params=params,
                    timeout=10  # Add 10s timeout
                )

                response.raise_for_status()

                if response.content:
                    return response.json()
                return {}

            except Exception as e:
                retries += 1
                if retries >= max_retries:
                    logger.error(f"Failed after {max_retries} retries: {str(e)}")
                    raise

                logger.warning(f"Retry {retries}/{max_retries} after error: {str(e)}")
                time.sleep(retry_delay)

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

    def search_resources(self, resource_type: str, params: Dict) -> Dict:
        """
        Search for FHIR resources.

        Args:
            resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
            params: Search parameters

        Returns:
            Bundle of matching resources
        """
        url = self._build_url(resource_type)
        return self.query_with_retries('GET', url, params=params)

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
