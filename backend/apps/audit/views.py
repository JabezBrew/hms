import csv
from datetime import datetime, time, timedelta
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.db.models import Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from apps.users.rbac import IsAdmin
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import get_user_facility
from apps.users.models import UserSession
from apps.users.session_service import get_session_idle_cutoff
from .models import AuditLog
from .serializers import AuditLogSerializer, AuditLogStatsSerializer
from django.conf import settings


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for viewing audit logs.
    Admin-only access with filtering and export capabilities.
    """
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated, IsAdmin]
    pagination_class = StandardResultsSetPagination

    def _facility_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return AuditLog.objects.none()

        if getattr(settings, 'ALLOW_CROSS_FACILITY_ACCESS', False) and self.request.user.user_type == 'admin':
            return AuditLog.objects.select_related('user')

        return AuditLog.objects.select_related('user').filter(facility=facility)

    def get_queryset(self):
        """
        Return filtered audit logs based on query parameters.
        """
        queryset = self._facility_queryset()

        # Handle ordering
        ordering = self.request.query_params.get('ordering', '-timestamp')
        allowed_orderings = {
            'timestamp', '-timestamp',
            'user_email', '-user_email',
            'action', '-action',
            'category', '-category',
            'ip_address', '-ip_address',
        }
        if ordering in allowed_orderings:
            queryset = queryset.order_by(ordering)
        else:
            queryset = queryset.order_by('-timestamp')

        # Filter by user
        user_id = self.request.query_params.get('user_id')
        if user_id:
            queryset = queryset.filter(user_id=user_id)

        # Filter by category
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)

        # Filter by action
        action = self.request.query_params.get('action')
        if action:
            queryset = queryset.filter(action=action)

        # Filter by resource type
        resource_type = self.request.query_params.get('resource_type')
        if resource_type:
            queryset = queryset.filter(resource_type=resource_type)

        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        if start_date:
            parsed_start = parse_date(start_date)
            if parsed_start:
                start_dt = timezone.make_aware(
                    datetime.combine(parsed_start, time.min),
                    timezone.get_current_timezone()
                )
                queryset = queryset.filter(timestamp__gte=start_dt)

        end_date = self.request.query_params.get('end_date')
        if end_date:
            parsed_end = parse_date(end_date)
            if parsed_end:
                end_dt = timezone.make_aware(
                    datetime.combine(parsed_end, time.min),
                    timezone.get_current_timezone()
                ) + timedelta(days=1)
                queryset = queryset.filter(timestamp__lt=end_dt)

        # Search in description, resource_name, user_email, and user name
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(description__icontains=search) |
                Q(resource_name__icontains=search) |
                Q(user_email__icontains=search) |
                Q(user__first_name__icontains=search) |
                Q(user__last_name__icontains=search)
            )

        return queryset

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get audit log statistics.
        """
        now = timezone.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=7)

        queryset = self._facility_queryset()

        # Basic counts
        total_logs = queryset.count()
        logs_today = queryset.filter(timestamp__gte=today_start).count()
        logs_this_week = queryset.filter(timestamp__gte=week_start).count()

        # Category breakdown
        category_breakdown = dict(
            queryset.values('category')
            .annotate(count=Count('id'))
            .values_list('category', 'count')
        )

        # Action breakdown (top 10)
        action_breakdown = dict(
            queryset.values('action')
            .annotate(count=Count('id'))
            .order_by('-count')[:10]
            .values_list('action', 'count')
        )

        # Most active users (top 5)
        most_active_users = list(
            queryset.filter(timestamp__gte=week_start)
            .exclude(user__isnull=True)
            .values('user_email', 'user_type')
            .annotate(count=Count('id'))
            .order_by('-count')[:5]
        )

        session_queryset = UserSession.objects.filter(
            revoked_at__isnull=True,
            expires_at__gt=now,
            last_seen_at__gt=get_session_idle_cutoff(now),
        )
        if getattr(settings, 'ALLOW_CROSS_FACILITY_ACCESS', False) and request.user.user_type == 'admin':
            active_sessions = session_queryset.exclude(facility_code='').values('user_id').distinct().count()
        else:
            facility = get_user_facility(request)
            if not facility:
                active_sessions = 0
            else:
                active_sessions = session_queryset.filter(
                    facility_code=facility.code,
                ).values('user_id').distinct().count()

        data = {
            'total_logs': total_logs,
            'logs_today': logs_today,
            'logs_this_week': logs_this_week,
            'category_breakdown': category_breakdown,
            'action_breakdown': action_breakdown,
            'most_active_users': most_active_users,
            'active_sessions': active_sessions,
        }

        serializer = AuditLogStatsSerializer(data)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def export(self, request):
        """
        Export audit logs to CSV.
        Uses the same filters as the list endpoint.
        """
        queryset = self.get_queryset()[:10000]  # Limit export to 10k records

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="audit_logs.csv"'

        writer = csv.writer(response)
        writer.writerow([
            'Timestamp',
            'User Email',
            'User Type',
            'Category',
            'Action',
            'Resource Type',
            'Resource ID',
            'Resource Name',
            'Description',
            'IP Address',
        ])

        for log in queryset:
            writer.writerow([
                log.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
                log.user_email,
                log.user_type,
                log.category,
                log.action,
                log.resource_type,
                log.resource_id or '',
                log.resource_name or '',
                log.description,
                log.ip_address or '',
            ])

        return response

    @action(detail=False, methods=['get'])
    def filters(self, request):
        """
        Get available filter options for the frontend.
        """
        from .models import AuditCategory, AuditAction

        # Get unique resource types from database
        resource_types = list(
            self._facility_queryset()
            .values_list('resource_type', flat=True)
            .distinct()
            .order_by('resource_type')
        )

        return Response({
            'categories': [
                {'value': choice[0], 'label': choice[1]}
                for choice in AuditCategory.CHOICES
            ],
            'actions': [
                {'value': choice[0], 'label': choice[1]}
                for choice in AuditAction.CHOICES
            ],
            'resource_types': resource_types,
        })
