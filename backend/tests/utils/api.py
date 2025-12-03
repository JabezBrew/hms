"""
API testing utility functions.

Provides standalone helper functions for API testing that can be used
with both pytest and Django TestCase style tests.
"""
from rest_framework_simplejwt.tokens import AccessToken


def get_auth_header(user):
    """
    Generate JWT authentication header for a user.

    Args:
        user: Django user instance

    Returns:
        dict: Authorization header suitable for APIClient.credentials()
    """
    token = AccessToken.for_user(user)
    return {'HTTP_AUTHORIZATION': f'Bearer {token}'}


def assert_api_response(response, expected_status, data_contains=None):
    """
    Assert API response status and optionally check response data.

    Args:
        response: DRF Response object
        expected_status: Expected HTTP status code
        data_contains: Optional dict of key-value pairs to check in response data

    Raises:
        AssertionError: If assertions fail
    """
    assert response.status_code == expected_status, (
        f"Expected status {expected_status}, got {response.status_code}. "
        f"Response: {response.data if hasattr(response, 'data') else response.content}"
    )

    if data_contains:
        for key, value in data_contains.items():
            assert key in response.data, f"Key '{key}' not in response data"
            assert response.data[key] == value, (
                f"Expected {key}={value}, got {key}={response.data[key]}"
            )


def assert_api_error(response, expected_status, error_contains=None):
    """
    Assert API error response.

    Args:
        response: DRF Response object
        expected_status: Expected HTTP status code (4xx or 5xx)
        error_contains: Optional string that should be in error message

    Raises:
        AssertionError: If assertions fail
    """
    assert response.status_code == expected_status, (
        f"Expected status {expected_status}, got {response.status_code}. "
        f"Response: {response.data if hasattr(response, 'data') else response.content}"
    )

    if error_contains:
        response_text = str(response.data).lower()
        assert error_contains.lower() in response_text, (
            f"Expected '{error_contains}' in error response: {response.data}"
        )


def assert_requires_auth(client, url, method='GET', data=None):
    """
    Assert that an endpoint requires authentication.

    Args:
        client: APIClient instance (should be unauthenticated)
        url: URL to test
        method: HTTP method (GET, POST, PUT, PATCH, DELETE)
        data: Optional request data for POST/PUT/PATCH

    Raises:
        AssertionError: If endpoint doesn't require auth (returns non-401)
    """
    methods = {
        'GET': client.get,
        'POST': client.post,
        'PUT': client.put,
        'PATCH': client.patch,
        'DELETE': client.delete
    }

    response = methods[method.upper()](url, data=data, format='json')
    assert response.status_code == 401, (
        f"Expected 401 for unauthenticated request to {method} {url}, "
        f"got {response.status_code}"
    )


def assert_requires_role(client, url, allowed_roles, forbidden_roles, method='GET', data=None, users=None):
    """
    Assert that an endpoint enforces role-based access control.

    Args:
        client: APIClient instance
        url: URL to test
        allowed_roles: List of user types that should have access
        forbidden_roles: List of user types that should be denied
        method: HTTP method
        data: Optional request data
        users: Dict mapping role names to user instances

    Raises:
        AssertionError: If RBAC is not enforced correctly
    """
    methods = {
        'GET': client.get,
        'POST': client.post,
        'PUT': client.put,
        'PATCH': client.patch,
        'DELETE': client.delete
    }

    for role in allowed_roles:
        if users and role in users:
            token = AccessToken.for_user(users[role])
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            response = methods[method.upper()](url, data=data, format='json')
            assert response.status_code != 403, (
                f"Expected {role} to have access to {method} {url}, "
                f"but got 403 Forbidden"
            )
            client.credentials()

    for role in forbidden_roles:
        if users and role in users:
            token = AccessToken.for_user(users[role])
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            response = methods[method.upper()](url, data=data, format='json')
            assert response.status_code == 403, (
                f"Expected {role} to be forbidden from {method} {url}, "
                f"but got {response.status_code}"
            )
            client.credentials()


def assert_list_response(response, expected_count=None, has_pagination=True):
    """
    Assert a list endpoint response is properly formatted.

    Args:
        response: DRF Response object
        expected_count: Expected number of items
        has_pagination: Whether response should be paginated

    Raises:
        AssertionError: If assertions fail
    """
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}"
    )

    if has_pagination:
        assert 'results' in response.data, "Paginated response missing 'results'"
        assert 'count' in response.data, "Paginated response missing 'count'"
        items = response.data['results']
        total_count = response.data['count']
    else:
        items = response.data
        total_count = len(items)

    if expected_count is not None:
        assert total_count == expected_count, (
            f"Expected {expected_count} items, got {total_count}"
        )

    return items


def assert_detail_response(response, expected_fields=None, unexpected_fields=None):
    """
    Assert a detail endpoint response has expected fields.

    Args:
        response: DRF Response object
        expected_fields: List of field names that should be present
        unexpected_fields: List of field names that should NOT be present

    Raises:
        AssertionError: If assertions fail
    """
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}"
    )

    if expected_fields:
        for field in expected_fields:
            assert field in response.data, (
                f"Expected field '{field}' not in response"
            )

    if unexpected_fields:
        for field in unexpected_fields:
            assert field not in response.data, (
                f"Unexpected field '{field}' found in response"
            )


def assert_created_response(response, expected_fields=None):
    """
    Assert a create endpoint response is properly formatted.

    Args:
        response: DRF Response object
        expected_fields: List of field names that should be in created object

    Raises:
        AssertionError: If assertions fail
    """
    assert response.status_code == 201, (
        f"Expected 201, got {response.status_code}. Response: {response.data}"
    )

    if expected_fields:
        for field in expected_fields:
            assert field in response.data, (
                f"Expected field '{field}' not in created object"
            )

    # Typically, created objects should have an ID
    assert 'id' in response.data, "Created object missing 'id'"


def assert_updated_response(response, updated_fields=None):
    """
    Assert an update endpoint response is properly formatted.

    Args:
        response: DRF Response object
        updated_fields: Dict of field names to their expected new values

    Raises:
        AssertionError: If assertions fail
    """
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}. Response: {response.data}"
    )

    if updated_fields:
        for field, expected_value in updated_fields.items():
            assert field in response.data, (
                f"Expected field '{field}' not in updated object"
            )
            assert response.data[field] == expected_value, (
                f"Expected {field}={expected_value}, got {field}={response.data[field]}"
            )


def assert_deleted_response(response):
    """
    Assert a delete endpoint response is properly formatted.

    Args:
        response: DRF Response object

    Raises:
        AssertionError: If assertions fail
    """
    assert response.status_code == 204, (
        f"Expected 204, got {response.status_code}"
    )
