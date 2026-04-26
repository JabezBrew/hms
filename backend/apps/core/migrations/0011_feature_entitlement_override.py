import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0010_seed_core_singletons'),
    ]

    operations = [
        migrations.CreateModel(
            name='FeatureEntitlementOverride',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('scope', models.CharField(choices=[('global', 'Global'), ('facility', 'Facility')], max_length=20)),
                ('feature_key', models.CharField(max_length=80)),
                ('is_enabled', models.BooleanField()),
                ('reason', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_feature_entitlement_overrides', to=settings.AUTH_USER_MODEL)),
                ('facility', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='feature_entitlement_overrides', to='core.facility')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_feature_entitlement_overrides', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['scope', 'facility__code', 'feature_key'],
            },
        ),
        migrations.AddIndex(
            model_name='featureentitlementoverride',
            index=models.Index(fields=['scope', 'feature_key'], name='core_featur_scope_93dbe6_idx'),
        ),
        migrations.AddIndex(
            model_name='featureentitlementoverride',
            index=models.Index(fields=['facility', 'feature_key'], name='core_featur_facilit_392349_idx'),
        ),
        migrations.AddIndex(
            model_name='featureentitlementoverride',
            index=models.Index(fields=['updated_at'], name='core_featur_updated_fd5c60_idx'),
        ),
        migrations.AddConstraint(
            model_name='featureentitlementoverride',
            constraint=models.CheckConstraint(check=models.Q(('facility__isnull', True), ('scope', 'global'), _connector='AND') | models.Q(('facility__isnull', False), ('scope', 'facility'), _connector='AND'), name='feature_override_scope_facility_valid'),
        ),
        migrations.AddConstraint(
            model_name='featureentitlementoverride',
            constraint=models.UniqueConstraint(condition=models.Q(('facility__isnull', True), ('scope', 'global'), _connector='AND'), fields=('scope', 'feature_key'), name='feature_override_global_unique'),
        ),
        migrations.AddConstraint(
            model_name='featureentitlementoverride',
            constraint=models.UniqueConstraint(condition=models.Q(('scope', 'facility')), fields=('facility', 'feature_key'), name='feature_override_facility_unique'),
        ),
    ]
