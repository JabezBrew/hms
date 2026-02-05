"""
IP Geolocation service for session tracking.
Uses ip-api.com (free for non-commercial use, 45 requests/minute).
"""
import logging
from dataclasses import dataclass
from typing import Optional

import requests
from django.core.cache import cache

logger = logging.getLogger(__name__)

GEOIP_CACHE_TTL = 86400  # Cache for 24 hours
GEOIP_API_URL = "http://ip-api.com/json/{ip}?fields=status,country,city"
GEOIP_TIMEOUT = 3  # seconds
PRIVATE_IP_PREFIXES = (
    '127.', '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.',
    '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
    '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
    'localhost', '::1'
)


@dataclass
class GeoLocation:
    city: str
    country: str


def _is_private_ip(ip_address: str) -> bool:
    return ip_address.startswith(PRIVATE_IP_PREFIXES)


def _get_cache_key(ip_address: str) -> str:
    return f"geoip:{ip_address}"


def get_cached_location_from_ip(ip_address: Optional[str]) -> Optional[GeoLocation]:
    """
    Return cached geolocation without external I/O.
    """
    if not ip_address:
        return None

    if _is_private_ip(ip_address):
        return GeoLocation(city='Local', country='Local Network')

    cache_key = _get_cache_key(ip_address)
    cached = cache.get(cache_key)
    if cached is None:
        return None
    if cached == 'FAILED':
        return None
    return GeoLocation(city=cached.get('city', ''), country=cached.get('country', ''))


def get_location_from_ip(ip_address: Optional[str]) -> Optional[GeoLocation]:
    """
    Get geographic location from an IP address.
    Returns None if lookup fails or IP is private/localhost.
    """
    if not ip_address:
        return None

    # Skip private/localhost IPs
    if _is_private_ip(ip_address):
        return GeoLocation(city='Local', country='Local Network')

    # Check cache first
    cache_key = _get_cache_key(ip_address)
    cached = cache.get(cache_key)
    if cached is not None:
        if cached == 'FAILED':
            return None
        return GeoLocation(city=cached.get('city', ''), country=cached.get('country', ''))

    try:
        response = requests.get(
            GEOIP_API_URL.format(ip=ip_address),
            timeout=GEOIP_TIMEOUT
        )
        response.raise_for_status()
        data = response.json()

        if data.get('status') == 'success':
            location_data = {
                'city': data.get('city', ''),
                'country': data.get('country', ''),
            }
            cache.set(cache_key, location_data, GEOIP_CACHE_TTL)
            return GeoLocation(city=location_data['city'], country=location_data['country'])
        else:
            # Cache failed lookups to avoid repeated API calls
            cache.set(cache_key, 'FAILED', GEOIP_CACHE_TTL)
            return None

    except requests.RequestException as e:
        logger.warning(f"GeoIP lookup failed for {ip_address}: {e}")
        # Don't cache network errors - they might be temporary
        return None
    except (KeyError, ValueError) as e:
        logger.warning(f"GeoIP response parsing failed for {ip_address}: {e}")
        cache.set(cache_key, 'FAILED', GEOIP_CACHE_TTL)
        return None
