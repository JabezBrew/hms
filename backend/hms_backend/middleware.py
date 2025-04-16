import logging
import time
import json
from django.utils.deprecation import MiddlewareMixin

logger = logging.getLogger('django.request')

class RequestLoggingMiddleware(MiddlewareMixin):
    """
    Middleware to log all requests and responses.
    """
    def process_request(self, request):
        """
        Process the request and log it.
        """
        request.start_time = time.time()
        
        # Don't log media or static file requests
        if request.path.startswith('/media/') or request.path.startswith('/static/'):
            return None
            
        # Log the request
        log_data = {
            'remote_address': request.META.get('REMOTE_ADDR'),
            'server_hostname': request.META.get('SERVER_NAME'),
            'request_method': request.method,
            'request_path': request.get_full_path(),
            'request_body': self._get_request_body(request),
            'user': str(request.user) if request.user.is_authenticated else 'Anonymous',
        }
        
        logger.info(f"Request: {json.dumps(log_data)}")
        return None

    def process_response(self, request, response):
        """
        Process the response and log it.
        """
        # Don't log media or static file responses
        if request.path.startswith('/media/') or request.path.startswith('/static/'):
            return response
            
        # Calculate request processing time
        if hasattr(request, 'start_time'):
            processing_time = time.time() - request.start_time
        else:
            processing_time = 0
            
        # Log the response
        log_data = {
            'remote_address': request.META.get('REMOTE_ADDR'),
            'request_method': request.method,
            'request_path': request.get_full_path(),
            'response_status': response.status_code,
            'processing_time': processing_time,
            'user': str(request.user) if request.user.is_authenticated else 'Anonymous',
        }
        
        logger.info(f"Response: {json.dumps(log_data)}")
        return response
        
    def _get_request_body(self, request):
        """
        Get the request body, but don't log sensitive information.
        """
        if not request.body:
            return ''
            
        try:
            # Try to parse as JSON
            body = json.loads(request.body)
            
            # Remove sensitive information
            if 'password' in body:
                body['password'] = '********'
            if 'confirm_password' in body:
                body['confirm_password'] = '********'
                
            return json.dumps(body)
        except:
            # If not JSON, return truncated body
            return str(request.body)[:100] + '...' if len(str(request.body)) > 100 else str(request.body)