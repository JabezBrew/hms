from rest_framework import serializers
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    """Serializer for audit log entries."""

    user_display = serializers.SerializerMethodField()
    action_display = serializers.SerializerMethodField()
    category_display = serializers.SerializerMethodField()
    time_ago = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id',
            'user',
            'user_email',
            'user_type',
            'user_display',
            'action',
            'action_display',
            'category',
            'category_display',
            'resource_type',
            'resource_id',
            'resource_name',
            'description',
            'changes',
            'ip_address',
            'timestamp',
            'time_ago',
        ]
        read_only_fields = fields

    def get_user_display(self, obj):
        """Get formatted user display name."""
        if obj.user:
            full_name = obj.user.get_full_name()
            if full_name:
                return full_name
        return obj.user_email

    def get_action_display(self, obj):
        """Get human-readable action name."""
        return obj.get_action_display()

    def get_category_display(self, obj):
        """Get human-readable category name."""
        return obj.get_category_display()

    def get_time_ago(self, obj):
        """Get relative time string."""
        from django.utils import timezone
        from datetime import timedelta

        now = timezone.now()
        diff = now - obj.timestamp

        if diff < timedelta(minutes=1):
            return 'Just now'
        elif diff < timedelta(hours=1):
            minutes = int(diff.total_seconds() / 60)
            return f'{minutes} min ago'
        elif diff < timedelta(days=1):
            hours = int(diff.total_seconds() / 3600)
            return f'{hours} hour{"s" if hours != 1 else ""} ago'
        elif diff < timedelta(days=7):
            days = diff.days
            return f'{days} day{"s" if days != 1 else ""} ago'
        else:
            return obj.timestamp.strftime('%b %d, %Y')


class AuditLogStatsSerializer(serializers.Serializer):
    """Serializer for audit log statistics."""

    total_logs = serializers.IntegerField()
    logs_today = serializers.IntegerField()
    logs_this_week = serializers.IntegerField()
    category_breakdown = serializers.DictField()
    action_breakdown = serializers.DictField()
    most_active_users = serializers.ListField()
