"""
RxNorm API service for drug information and interaction checking.
RxNorm is a standardized nomenclature for clinical drugs maintained by the National Library of Medicine.
API Documentation: https://lhncbc.nlm.nih.gov/RxNav/APIs/
"""

import requests
import logging
from typing import List, Dict, Optional
from django.core.cache import cache

logger = logging.getLogger(__name__)

# RxNorm API base URLs
RXNORM_BASE_URL = "https://rxnav.nlm.nih.gov/REST"
RXNORM_INTERACTION_URL = f"{RXNORM_BASE_URL}/interaction"


class RxNormService:
    """Service for interacting with RxNorm API."""

    @staticmethod
    def search_drugs(query: str, max_results: int = 10) -> List[Dict]:
        """
        Search for drugs by name using RxNorm API.

        Args:
            query: Drug name to search for
            max_results: Maximum number of results to return

        Returns:
            List of drug dictionaries with rxcui, name, and synonym info
        """
        if not query or len(query) < 2:
            return []

        # Check cache first (v2 key includes improved dedup logic)
        cache_key = f"rxnorm_search_v2_{query.lower()}_{max_results}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            # Use approximate search for better matching
            # Request more entries than needed since we'll filter duplicates
            # RxNorm often returns multiple entries with the same rxcui
            api_max_entries = max(max_results * 5, 50)

            url = f"{RXNORM_BASE_URL}/approximateTerm.json"
            params = {
                'term': query,
                'maxEntries': api_max_entries
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            results = []
            seen_rxcuis = set()  # Track seen rxcuis to avoid duplicates

            if 'approximateGroup' in data and 'candidate' in data['approximateGroup']:
                for candidate in data['approximateGroup']['candidate']:
                    rxcui = candidate.get('rxcui')
                    name = candidate.get('name')

                    # Skip entries with null/empty names or duplicate rxcuis
                    if not name or not rxcui:
                        continue
                    if rxcui in seen_rxcuis:
                        continue

                    seen_rxcuis.add(rxcui)
                    results.append({
                        'rxcui': rxcui,
                        'name': name,
                        'score': candidate.get('score'),  # Relevance score
                        'rank': candidate.get('rank')
                    })

                    # Stop once we have enough unique results
                    if len(results) >= max_results:
                        break

            # Cache for 1 hour
            cache.set(cache_key, results, 3600)
            return results

        except requests.exceptions.RequestException as e:
            logger.error(f"RxNorm API search error: {e}")
            return []

    @staticmethod
    def get_drug_info(rxcui: str) -> Optional[Dict]:
        """
        Get detailed drug information by RxCUI.

        Args:
            rxcui: RxNorm Concept Unique Identifier

        Returns:
            Dictionary with drug information or None if not found
        """
        cache_key = f"rxnorm_drug_info_{rxcui}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            url = f"{RXNORM_BASE_URL}/rxcui/{rxcui}/properties.json"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()

            if 'properties' in data:
                props = data['properties']
                result = {
                    'rxcui': props.get('rxcui'),
                    'name': props.get('name'),
                    'synonym': props.get('synonym'),
                    'tty': props.get('tty'),  # Term type (e.g., SCD, SBD, GPCK)
                    'language': props.get('language'),
                    'suppress': props.get('suppress'),
                    'umlscui': props.get('umlscui')
                }

                # Cache for 24 hours
                cache.set(cache_key, result, 86400)
                return result

            return None

        except requests.exceptions.RequestException as e:
            logger.error(f"RxNorm API drug info error: {e}")
            return None

    @staticmethod
    def get_drug_interactions(rxcui_list: List[str]) -> List[Dict]:
        """
        Check for drug-drug interactions using RxNorm Interaction API.

        Args:
            rxcui_list: List of RxCUI codes to check for interactions

        Returns:
            List of interaction dictionaries with severity and description
        """
        if not rxcui_list or len(rxcui_list) < 2:
            return []

        # Check cache for each pair
        rxcui_list_sorted = sorted(rxcui_list)
        cache_key = f"rxnorm_interactions_{','.join(rxcui_list_sorted)}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            # Use the interaction list API
            url = f"{RXNORM_INTERACTION_URL}/list.json"
            params = {
                'rxcuis': ' '.join(rxcui_list)
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            interactions = []
            if 'fullInteractionTypeGroup' in data:
                for type_group in data['fullInteractionTypeGroup']:
                    if 'fullInteractionType' in type_group:
                        for interaction_type in type_group['fullInteractionType']:
                            if 'interactionPair' in interaction_type:
                                for pair in interaction_type['interactionPair']:
                                    interaction = {
                                        'description': pair.get('description', ''),
                                        'severity': pair.get('severity', 'unknown'),
                                        'drug1_name': pair['interactionConcept'][0].get('minConceptItem', {}).get('name', '') if len(pair.get('interactionConcept', [])) > 0 else '',
                                        'drug1_rxcui': pair['interactionConcept'][0].get('minConceptItem', {}).get('rxcui', '') if len(pair.get('interactionConcept', [])) > 0 else '',
                                        'drug2_name': pair['interactionConcept'][1].get('minConceptItem', {}).get('name', '') if len(pair.get('interactionConcept', [])) > 1 else '',
                                        'drug2_rxcui': pair['interactionConcept'][1].get('minConceptItem', {}).get('rxcui', '') if len(pair.get('interactionConcept', [])) > 1 else '',
                                        'source': 'RxNorm'
                                    }
                                    interactions.append(interaction)

            # Cache for 30 days (interactions don't change frequently)
            cache.set(cache_key, interactions, 2592000)
            return interactions

        except requests.exceptions.RequestException as e:
            logger.error(f"RxNorm API interaction check error: {e}")
            return []

    @staticmethod
    def get_rxcui_by_name(drug_name: str) -> Optional[str]:
        """
        Get RxCUI for a drug name using exact match.

        Args:
            drug_name: Exact or approximate drug name

        Returns:
            RxCUI string or None if not found
        """
        # Try exact match first
        results = RxNormService.search_drugs(drug_name, max_results=1)
        if results and len(results) > 0:
            return results[0].get('rxcui')
        return None

    @staticmethod
    def get_drug_forms(rxcui: str) -> List[Dict]:
        """
        Get available drug forms (strengths and dose forms) for a drug.
        Uses RxNorm related concepts to find SCDs (Semantic Clinical Drugs).

        Args:
            rxcui: RxNorm Concept Unique Identifier (can be ingredient, SCD, or SBD)

        Returns:
            List of drug form dictionaries with strength, form, and route
        """
        cache_key = f"rxnorm_drug_forms_v2_{rxcui}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            forms = []
            seen_forms = set()

            # First, get properties of the current rxcui to check its type
            props_url = f"{RXNORM_BASE_URL}/rxcui/{rxcui}/properties.json"
            props_response = requests.get(props_url, timeout=10)
            props_response.raise_for_status()
            props_data = props_response.json()

            current_tty = None
            current_name = None
            if 'properties' in props_data:
                current_tty = props_data['properties'].get('tty')
                current_name = props_data['properties'].get('name')

            # If the current rxcui is already an SCD or SBD, parse it directly
            if current_tty in ('SCD', 'SBD') and current_name:
                parsed = RxNormService._parse_drug_name(current_name)
                if parsed:
                    seen_forms.add(parsed['form_key'])
                    forms.append({
                        'rxcui': rxcui,
                        'name': current_name,
                        'strength': parsed['strength'],
                        'dose_form': parsed['dose_form'],
                        'route': parsed['route'],
                        'tty': current_tty
                    })

                # Also get the ingredient to find other formulations
                # Get related ingredients (IN) to find other forms
                ing_url = f"{RXNORM_BASE_URL}/rxcui/{rxcui}/related.json"
                ing_params = {'tty': 'IN'}  # Ingredient
                ing_response = requests.get(ing_url, params=ing_params, timeout=10)
                if ing_response.ok:
                    ing_data = ing_response.json()
                    if 'relatedGroup' in ing_data and 'conceptGroup' in ing_data['relatedGroup']:
                        for group in ing_data['relatedGroup']['conceptGroup']:
                            if 'conceptProperties' in group:
                                for concept in group['conceptProperties']:
                                    ingredient_rxcui = concept.get('rxcui')
                                    if ingredient_rxcui:
                                        # Get SCDs for this ingredient
                                        RxNormService._add_related_forms(
                                            ingredient_rxcui, forms, seen_forms
                                        )
            else:
                # It's an ingredient or other type - get related SCDs directly
                RxNormService._add_related_forms(rxcui, forms, seen_forms)

            # Sort by strength (try to parse numeric value)
            def sort_key(f):
                try:
                    import re
                    match = re.search(r'(\d+(?:\.\d+)?)', f['strength'])
                    return float(match.group(1)) if match else 999
                except:
                    return 999

            forms.sort(key=sort_key)

            # Cache for 24 hours
            cache.set(cache_key, forms, 86400)
            return forms

        except requests.exceptions.RequestException as e:
            logger.error(f"RxNorm API drug forms error: {e}")
            return []

    @staticmethod
    def _add_related_forms(rxcui: str, forms: List[Dict], seen_forms: set) -> None:
        """
        Helper to add related SCD/SBD forms for a given rxcui.
        Modifies forms and seen_forms in place.
        """
        try:
            # Build URL manually to avoid + being URL-encoded as %2B
            url = f"{RXNORM_BASE_URL}/rxcui/{rxcui}/related.json?tty=SCD+SBD"

            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()

            if 'relatedGroup' in data and 'conceptGroup' in data['relatedGroup']:
                for group in data['relatedGroup']['conceptGroup']:
                    if 'conceptProperties' in group:
                        for concept in group['conceptProperties']:
                            name = concept.get('name', '')
                            concept_rxcui = concept.get('rxcui', '')

                            parsed = RxNormService._parse_drug_name(name)

                            if parsed and parsed['form_key'] not in seen_forms:
                                seen_forms.add(parsed['form_key'])
                                forms.append({
                                    'rxcui': concept_rxcui,
                                    'name': name,
                                    'strength': parsed['strength'],
                                    'dose_form': parsed['dose_form'],
                                    'route': parsed['route'],
                                    'tty': group.get('tty', '')
                                })
        except requests.exceptions.RequestException as e:
            logger.error(f"RxNorm API related forms error: {e}")

    @staticmethod
    def _parse_drug_name(name: str) -> Optional[Dict]:
        """
        Parse an SCD/SBD drug name to extract strength, dose form, and route.

        Examples:
            "Acetaminophen 325 MG Oral Tablet" -> {strength: "325 MG", dose_form: "Oral Tablet", route: "oral"}
            "amoxicillin 500 MG Oral Capsule" -> {strength: "500 MG", dose_form: "Oral Capsule", route: "oral"}
        """
        import re

        # Common dose forms and their routes
        dose_form_routes = {
            'oral tablet': 'oral',
            'oral capsule': 'oral',
            'oral solution': 'oral',
            'oral suspension': 'oral',
            'oral powder': 'oral',
            'chewable tablet': 'oral',
            'disintegrating tablet': 'oral',
            'extended release': 'oral',
            'delayed release': 'oral',
            'injectable solution': 'iv',
            'injection': 'iv',
            'prefilled syringe': 'iv',
            'intravenous solution': 'iv',
            'topical cream': 'topical',
            'topical ointment': 'topical',
            'topical gel': 'topical',
            'topical lotion': 'topical',
            'topical solution': 'topical',
            'transdermal patch': 'transdermal',
            'transdermal system': 'transdermal',
            'ophthalmic solution': 'ophthalmic',
            'ophthalmic drops': 'ophthalmic',
            'ophthalmic ointment': 'ophthalmic',
            'otic solution': 'otic',
            'otic drops': 'otic',
            'nasal spray': 'nasal',
            'nasal solution': 'nasal',
            'inhalation aerosol': 'inhaled',
            'inhalation powder': 'inhaled',
            'inhalation solution': 'inhaled',
            'metered dose inhaler': 'inhaled',
            'rectal suppository': 'rectal',
            'rectal enema': 'rectal',
            'vaginal cream': 'vaginal',
            'vaginal tablet': 'vaginal',
            'sublingual tablet': 'sublingual',
            'buccal tablet': 'sublingual',
            'intramuscular solution': 'im',
            'subcutaneous solution': 'sc',
        }

        # Try to match strength pattern (number + unit)
        strength_pattern = r'(\d+(?:\.\d+)?(?:\s*/\s*\d+(?:\.\d+)?)?\s*(?:MG|MCG|G|ML|MG/ML|MCG/ML|UNIT|%|MEQ)(?:/\d+\s*(?:ML|HR))?)'
        strength_match = re.search(strength_pattern, name, re.IGNORECASE)

        if strength_match:
            strength = strength_match.group(1).upper()
            strength_end = strength_match.end()
            # Everything after strength is the dose form
            dose_form_part = name[strength_end:].strip()
        else:
            # No explicit strength found - try to extract dose form from the name
            # For names like "rivaroxaban Oral Tablet", extract "Oral Tablet"
            strength = ''
            dose_form_part = name

        # Find matching route and extract clean dose form
        route = 'oral'  # Default
        dose_form = dose_form_part
        matched_form = None

        dose_form_lower = dose_form_part.lower()
        for form_pattern, form_route in dose_form_routes.items():
            if form_pattern in dose_form_lower:
                route = form_route
                matched_form = form_pattern
                break

        # If we matched a form pattern, use it as the clean dose form
        # This handles "rivaroxaban Oral Tablet" -> dose_form = "Oral Tablet"
        if matched_form and not strength_match:
            # Find where the dose form starts in the original name
            form_start = dose_form_lower.find(matched_form)
            if form_start >= 0:
                dose_form = dose_form_part[form_start:].strip()

        # Create a unique key to avoid duplicates
        form_key = f"{strength}|{dose_form.lower()}"

        return {
            'strength': strength,
            'dose_form': dose_form,
            'route': route,
            'form_key': form_key
        }

    @staticmethod
    def get_drug_class(rxcui: str) -> List[Dict]:
        """
        Get drug class information (e.g., Antibiotic, Antihypertensive).
        Useful for allergy cross-referencing.

        Args:
            rxcui: RxNorm Concept Unique Identifier

        Returns:
            List of drug class dictionaries
        """
        cache_key = f"rxnorm_drug_class_{rxcui}"
        cached_result = cache.get(cache_key)
        if cached_result:
            return cached_result

        try:
            # Get related drug classes using the RxClass API
            url = f"{RXNORM_BASE_URL}/rxclass/class/byRxcui.json"
            params = {
                'rxcui': rxcui,
                'relaSource': 'ATC'  # Anatomical Therapeutic Chemical classification
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            classes = []
            if 'rxclassDrugInfoList' in data and 'rxclassDrugInfo' in data['rxclassDrugInfoList']:
                for class_info in data['rxclassDrugInfoList']['rxclassDrugInfo']:
                    classes.append({
                        'class_name': class_info.get('rxclassMinConceptItem', {}).get('className'),
                        'class_id': class_info.get('rxclassMinConceptItem', {}).get('classId'),
                        'class_type': class_info.get('rela')
                    })

            # Cache for 24 hours
            cache.set(cache_key, classes, 86400)
            return classes

        except requests.exceptions.RequestException as e:
            logger.error(f"RxNorm API drug class error: {e}")
            return []
