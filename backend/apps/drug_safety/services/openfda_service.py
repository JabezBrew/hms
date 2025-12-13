"""
OpenFDA API service for drug adverse events and safety information.
OpenFDA provides access to FDA drug databases including adverse events, labeling, and recalls.
API Documentation: https://open.fda.gov/apis/
"""

import requests
import logging
from typing import List, Dict, Optional
from django.core.cache import cache

logger = logging.getLogger(__name__)

# OpenFDA API base URL
OPENFDA_BASE_URL = "https://api.fda.gov"


class OpenFDAService:
    """Service for interacting with OpenFDA API."""

    @staticmethod
    def search_drug_events(drug_name: str, limit: int = 10) -> List[Dict]:
        """
        Search for adverse events related to a drug.

        Args:
            drug_name: Drug name to search for
            limit: Maximum number of results

        Returns:
            List of adverse event dictionaries
        """
        cache_key = f"openfda_events_{drug_name.lower()}_{limit}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            url = f"{OPENFDA_BASE_URL}/drug/event.json"
            params = {
                'search': f'patient.drug.medicinalproduct:"{drug_name}"',
                'limit': limit
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            events = []
            if 'results' in data:
                for result in data['results']:
                    # Extract relevant adverse event info
                    reactions = []
                    if 'patient' in result and 'reaction' in result['patient']:
                        reactions = [r.get('reactionmeddrapt', '') for r in result['patient']['reaction']]

                    events.append({
                        'reactions': reactions,
                        'serious': result.get('serious', 0),
                        'receivedate': result.get('receivedate', ''),
                        'primarysource': result.get('primarysource', {})
                    })

            # Cache for 7 days
            cache.set(cache_key, events, 604800)
            return events

        except requests.exceptions.RequestException as e:
            logger.error(f"OpenFDA API adverse events error: {e}")
            return []

    @staticmethod
    def get_drug_label(drug_name: str) -> Optional[Dict]:
        """
        Get drug labeling information including warnings and precautions.

        Args:
            drug_name: Drug name to search for

        Returns:
            Dictionary with labeling information or None
        """
        cache_key = f"openfda_label_{drug_name.lower()}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            url = f"{OPENFDA_BASE_URL}/drug/label.json"
            params = {
                'search': f'openfda.brand_name:"{drug_name}" OR openfda.generic_name:"{drug_name}"',
                'limit': 1
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            if 'results' in data and len(data['results']) > 0:
                result = data['results'][0]

                label_info = {
                    'brand_name': result.get('openfda', {}).get('brand_name', []),
                    'generic_name': result.get('openfda', {}).get('generic_name', []),
                    'warnings': result.get('warnings', []),
                    'warnings_and_cautions': result.get('warnings_and_cautions', []),
                    'contraindications': result.get('contraindications', []),
                    'adverse_reactions': result.get('adverse_reactions', []),
                    'drug_interactions': result.get('drug_interactions', []),
                    'boxed_warning': result.get('boxed_warning', []),
                    'pregnancy': result.get('pregnancy', []),
                    'pediatric_use': result.get('pediatric_use', [])
                }

                # Cache for 30 days
                cache.set(cache_key, label_info, 2592000)
                return label_info

            return None

        except requests.exceptions.RequestException as e:
            logger.error(f"OpenFDA API drug label error: {e}")
            return None

    @staticmethod
    def check_drug_recalls(drug_name: str) -> List[Dict]:
        """
        Check if a drug has been recalled.

        Args:
            drug_name: Drug name to check

        Returns:
            List of recall dictionaries
        """
        cache_key = f"openfda_recalls_{drug_name.lower()}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            url = f"{OPENFDA_BASE_URL}/drug/enforcement.json"
            params = {
                'search': f'product_description:"{drug_name}"',
                'limit': 10
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            recalls = []
            if 'results' in data:
                for result in data['results']:
                    recalls.append({
                        'recall_number': result.get('recall_number', ''),
                        'reason_for_recall': result.get('reason_for_recall', ''),
                        'status': result.get('status', ''),
                        'classification': result.get('classification', ''),
                        'product_description': result.get('product_description', ''),
                        'report_date': result.get('report_date', ''),
                        'voluntary_mandated': result.get('voluntary_mandated', '')
                    })

            # Cache for 1 day (recalls should be checked frequently)
            cache.set(cache_key, recalls, 86400)
            return recalls

        except requests.exceptions.RequestException as e:
            logger.error(f"OpenFDA API recalls check error: {e}")
            return []

    @staticmethod
    def get_drug_interactions_from_label(drug_name: str) -> List[str]:
        """
        Extract drug interaction information from drug labeling.

        Args:
            drug_name: Drug name to check

        Returns:
            List of interaction descriptions
        """
        label_info = OpenFDAService.get_drug_label(drug_name)
        if label_info and 'drug_interactions' in label_info:
            return label_info['drug_interactions']
        return []

    @staticmethod
    def get_contraindications(drug_name: str) -> List[str]:
        """
        Get contraindication information for a drug.

        Args:
            drug_name: Drug name to check

        Returns:
            List of contraindication descriptions
        """
        label_info = OpenFDAService.get_drug_label(drug_name)
        if label_info and 'contraindications' in label_info:
            return label_info['contraindications']
        return []

    @staticmethod
    def has_boxed_warning(drug_name: str) -> bool:
        """
        Check if a drug has a black box warning (most serious FDA warning).

        Args:
            drug_name: Drug name to check

        Returns:
            True if drug has boxed warning, False otherwise
        """
        label_info = OpenFDAService.get_drug_label(drug_name)
        if label_info and 'boxed_warning' in label_info:
            return len(label_info['boxed_warning']) > 0
        return False
