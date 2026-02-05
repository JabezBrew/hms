from django.contrib import admin

from .models import InboxItem


@admin.register(InboxItem)
class InboxItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'source_type', 'recipient_user', 'recipient_role', 'status', 'occurred_at')
    list_filter = ('source_type', 'status', 'priority', 'recipient_role')
    search_fields = ('title', 'summary', 'dedupe_key')
