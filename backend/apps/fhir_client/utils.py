"""
Utility functions for working with FHIR resources.
"""
import uuid
from typing import Dict, List, Optional, Any


def generate_fhir_id() -> str:
    """
    Generate a unique ID for a FHIR resource.
    
    Returns:
        A UUID string without hyphens
    """
    return uuid.uuid4().hex


def create_reference(resource_type: str, resource_id: str) -> Dict[str, str]:
    """
    Create a FHIR reference object.
    
    Args:
        resource_type: The FHIR resource type (e.g., 'Patient', 'Observation')
        resource_id: The resource ID
        
    Returns:
        A FHIR reference object
    """
    return {
        "reference": f"{resource_type}/{resource_id}"
    }


def extract_id_from_reference(reference: str) -> Optional[str]:
    """
    Extract the ID from a FHIR reference.
    
    Args:
        reference: The FHIR reference string (e.g., 'Patient/123')
        
    Returns:
        The resource ID or None if the reference is invalid
    """
    if not reference or '/' not in reference:
        return None
    
    return reference.split('/')[-1]


def extract_resource_type_from_reference(reference: str) -> Optional[str]:
    """
    Extract the resource type from a FHIR reference.
    
    Args:
        reference: The FHIR reference string (e.g., 'Patient/123')
        
    Returns:
        The resource type or None if the reference is invalid
    """
    if not reference or '/' not in reference:
        return None
    
    return reference.split('/')[0]


def create_identifier(system: str, value: str) -> Dict[str, str]:
    """
    Create a FHIR identifier object.
    
    Args:
        system: The identifier system (e.g., 'http://example.org/fhir/identifier/mrn')
        value: The identifier value
        
    Returns:
        A FHIR identifier object
    """
    return {
        "system": system,
        "value": value
    }


def find_identifier(identifiers: List[Dict[str, str]], system: str) -> Optional[str]:
    """
    Find an identifier value by system in a list of FHIR identifiers.
    
    Args:
        identifiers: List of FHIR identifier objects
        system: The identifier system to find
        
    Returns:
        The identifier value or None if not found
    """
    if not identifiers:
        return None
    
    for identifier in identifiers:
        if identifier.get("system") == system:
            return identifier.get("value")
    
    return None


def create_coding(system: str, code: str, display: Optional[str] = None) -> Dict[str, str]:
    """
    Create a FHIR coding object.
    
    Args:
        system: The coding system (e.g., 'http://loinc.org')
        code: The code value
        display: Optional display text
        
    Returns:
        A FHIR coding object
    """
    coding = {
        "system": system,
        "code": code
    }
    
    if display:
        coding["display"] = display
    
    return coding


def create_codeable_concept(coding: List[Dict[str, str]], text: Optional[str] = None) -> Dict[str, Any]:
    """
    Create a FHIR CodeableConcept object.
    
    Args:
        coding: List of FHIR coding objects
        text: Optional text representation
        
    Returns:
        A FHIR CodeableConcept object
    """
    concept = {
        "coding": coding
    }
    
    if text:
        concept["text"] = text
    
    return concept


def create_quantity(value: float, unit: str, system: str = "http://unitsofmeasure.org", 
                   code: Optional[str] = None) -> Dict[str, Any]:
    """
    Create a FHIR Quantity object.
    
    Args:
        value: The numeric value
        unit: The unit representation
        system: The unit system
        code: Optional unit code
        
    Returns:
        A FHIR Quantity object
    """
    quantity = {
        "value": value,
        "unit": unit,
        "system": system
    }
    
    if code:
        quantity["code"] = code
    
    return quantity


def create_period(start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, str]:
    """
    Create a FHIR Period object.
    
    Args:
        start: ISO8601 start datetime
        end: ISO8601 end datetime
        
    Returns:
        A FHIR Period object
    """
    period = {}
    
    if start:
        period["start"] = start
    
    if end:
        period["end"] = end
    
    return period


def create_human_name(family: str, given: List[str], prefix: Optional[List[str]] = None, 
                     suffix: Optional[List[str]] = None, use: str = "official") -> Dict[str, Any]:
    """
    Create a FHIR HumanName object.
    
    Args:
        family: Family name
        given: List of given names
        prefix: Optional list of prefixes
        suffix: Optional list of suffixes
        use: Name use (official, usual, temp, nickname, anonymous, old, maiden)
        
    Returns:
        A FHIR HumanName object
    """
    name = {
        "family": family,
        "given": given,
        "use": use
    }
    
    if prefix:
        name["prefix"] = prefix
    
    if suffix:
        name["suffix"] = suffix
    
    return name


def create_address(line: List[str], city: str, state: str, postalCode: str, 
                  country: str, use: str = "home") -> Dict[str, Any]:
    """
    Create a FHIR Address object.
    
    Args:
        line: List of address lines
        city: City
        state: State
        postalCode: Postal code
        country: Country
        use: Address use (home, work, temp, old, billing)
        
    Returns:
        A FHIR Address object
    """
    return {
        "line": line,
        "city": city,
        "state": state,
        "postalCode": postalCode,
        "country": country,
        "use": use
    }


def create_contact_point(system: str, value: str, use: str = "home", 
                        rank: Optional[int] = None) -> Dict[str, Any]:
    """
    Create a FHIR ContactPoint object.
    
    Args:
        system: Contact system (phone, fax, email, pager, url, sms, other)
        value: Contact value
        use: Contact use (home, work, temp, old, mobile)
        rank: Optional preference rank
        
    Returns:
        A FHIR ContactPoint object
    """
    contact = {
        "system": system,
        "value": value,
        "use": use
    }
    
    if rank is not None:
        contact["rank"] = rank
    
    return contact