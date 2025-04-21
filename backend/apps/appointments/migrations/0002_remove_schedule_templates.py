from django.db import migrations

class Migration(migrations.Migration):
    dependencies = [
        ('appointments', '0001_initial'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='schedulefhirmapping',
            name='template',
        ),
        migrations.DeleteModel(
            name='ScheduleTimeSlot',
        ),
        migrations.DeleteModel(
            name='ScheduleTemplate',
        ),
    ]