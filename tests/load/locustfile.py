"""
Locust Load Testing for HMS

Test scenarios for validating system performance under load.
Simulates realistic user behavior patterns for healthcare workflows.

Installation:
    pip install locust

Usage:
    # Web UI mode
    locust -f tests/load/locustfile.py --host=http://localhost:8000

    # Headless mode (CI/CD)
    locust -f tests/load/locustfile.py --host=http://localhost:8000 \
        --headless -u 1000 -r 50 -t 5m \
        --csv=results/load_test

    # Distributed mode (for high load)
    # Master:
    locust -f tests/load/locustfile.py --master --host=http://localhost:8000
    # Workers:
    locust -f tests/load/locustfile.py --worker --master-host=<master-ip>

Target metrics:
    - 10,000+ concurrent users
    - P95 latency < 500ms for dashboard
    - P95 latency < 200ms for vitals recording
    - Alert delivery < 1 second (via WebSocket)
"""

import json
import random
import uuid
from datetime import datetime, timedelta

from locust import HttpUser, TaskSet, task, between, events
from locust.runners import MasterRunner


# Test data generators
def random_mrn():
    """Generate random Medical Record Number."""
    return f"MRN{random.randint(100000, 999999)}"


def random_vitals():
    """Generate realistic vital signs data."""
    return {
        "temperature": round(random.uniform(36.0, 38.5), 1),
        "heart_rate": random.randint(60, 100),
        "blood_pressure_systolic": random.randint(100, 140),
        "blood_pressure_diastolic": random.randint(60, 90),
        "respiratory_rate": random.randint(12, 20),
        "oxygen_saturation": random.randint(95, 100),
        "pain_level": random.randint(0, 5),
    }


def random_critical_vitals():
    """Generate critical vital signs (triggers alerts)."""
    return {
        "temperature": round(random.uniform(39.5, 40.5), 1),
        "heart_rate": random.randint(130, 150),
        "blood_pressure_systolic": random.randint(180, 200),
        "blood_pressure_diastolic": random.randint(100, 120),
        "respiratory_rate": random.randint(25, 35),
        "oxygen_saturation": random.randint(85, 90),
        "pain_level": random.randint(8, 10),
    }


class AuthMixin:
    """Mixin for handling JWT authentication."""

    access_token = None
    refresh_token = None

    def login(self, email, password):
        """Authenticate and store tokens."""
        response = self.client.post(
            "/api/auth/login/",
            json={"email": email, "password": password},
            name="Auth: Login"
        )
        if response.status_code == 200:
            data = response.json()
            self.access_token = data.get("access")
            self.refresh_token = data.get("refresh")
            return True
        return False

    def get_auth_headers(self):
        """Get authorization headers."""
        if self.access_token:
            return {"Authorization": f"Bearer {self.access_token}"}
        return {}


class NurseDashboardTasks(TaskSet, AuthMixin):
    """
    Simulates nurse dashboard usage patterns.

    Typical workflow:
    1. View dashboard with patient list
    2. Check patient vitals
    3. Record new vitals
    4. View/acknowledge alerts
    5. Check medication schedule
    """

    def on_start(self):
        """Login as nurse user."""
        self.login("nurse@hms.local", "testpass123")
        self.patient_ids = []
        self.ward_id = None

    @task(10)
    def view_dashboard(self):
        """View nursing dashboard (most common action)."""
        headers = self.get_auth_headers()
        with self.client.get(
            "/api/nursing/monitoring/dashboard/",
            headers=headers,
            name="Nurse: View Dashboard",
            catch_response=True
        ) as response:
            if response.status_code == 200:
                data = response.json()
                # Extract patient IDs for subsequent requests
                patients = data.get("results", data.get("patients", []))
                self.patient_ids = [p.get("patient_id") or p.get("id") for p in patients[:20]]
                response.success()
            else:
                response.failure(f"Dashboard failed: {response.status_code}")

    @task(5)
    def view_patient_vitals(self):
        """View vital signs for a patient."""
        if not self.patient_ids:
            return

        patient_id = random.choice(self.patient_ids)
        headers = self.get_auth_headers()
        self.client.get(
            f"/api/nursing/vital-signs/?patient={patient_id}",
            headers=headers,
            name="Nurse: View Patient Vitals"
        )

    @task(3)
    def record_vitals(self):
        """Record new vital signs (write operation)."""
        if not self.patient_ids:
            return

        patient_id = random.choice(self.patient_ids)
        headers = self.get_auth_headers()

        # 10% chance of critical vitals
        vitals = random_critical_vitals() if random.random() < 0.1 else random_vitals()
        vitals["patient"] = patient_id

        self.client.post(
            "/api/nursing/vital-signs/",
            json=vitals,
            headers=headers,
            name="Nurse: Record Vitals"
        )

    @task(4)
    def view_alerts(self):
        """View nursing alerts."""
        headers = self.get_auth_headers()
        self.client.get(
            "/api/nursing/alerts/?is_acknowledged=false",
            headers=headers,
            name="Nurse: View Alerts"
        )

    @task(2)
    def acknowledge_alert(self):
        """Acknowledge an alert."""
        headers = self.get_auth_headers()
        # First get an unacknowledged alert
        response = self.client.get(
            "/api/nursing/alerts/?is_acknowledged=false&page_size=1",
            headers=headers,
            name="Nurse: Get Alert to Ack"
        )
        if response.status_code == 200:
            alerts = response.json().get("results", [])
            if alerts:
                alert_id = alerts[0]["id"]
                self.client.post(
                    f"/api/nursing/alerts/{alert_id}/acknowledge/",
                    headers=headers,
                    name="Nurse: Acknowledge Alert"
                )

    @task(3)
    def view_medication_schedule(self):
        """View medication administration schedule."""
        headers = self.get_auth_headers()
        self.client.get(
            "/api/nursing/medications/?status=scheduled",
            headers=headers,
            name="Nurse: View Med Schedule"
        )


class DoctorDashboardTasks(TaskSet, AuthMixin):
    """
    Simulates doctor dashboard usage patterns.

    Typical workflow:
    1. View patient list/appointments
    2. Search for patients
    3. View patient details
    4. View clinical notes
    5. Create clinical notes
    """

    def on_start(self):
        """Login as doctor user."""
        self.login("doctor@hms.local", "testpass123")
        self.patient_ids = []

    @task(8)
    def view_appointments(self):
        """View today's appointments."""
        headers = self.get_auth_headers()
        today = datetime.now().strftime("%Y-%m-%d")
        self.client.get(
            f"/api/appointments/?date={today}",
            headers=headers,
            name="Doctor: View Appointments"
        )

    @task(6)
    def search_patients(self):
        """Search for patients."""
        headers = self.get_auth_headers()
        # Random search terms
        search_terms = ["john", "smith", "mary", "williams", "MRN"]
        term = random.choice(search_terms)

        with self.client.get(
            f"/api/patients/search/?query={term}",
            headers=headers,
            name="Doctor: Search Patients",
            catch_response=True
        ) as response:
            if response.status_code == 200:
                results = response.json().get("results", [])
                self.patient_ids = [p.get("id") for p in results[:10]]
                response.success()

    @task(5)
    def view_patient_detail(self):
        """View detailed patient information."""
        if not self.patient_ids:
            return

        patient_id = random.choice(self.patient_ids)
        headers = self.get_auth_headers()
        self.client.get(
            f"/api/patients/{patient_id}/",
            headers=headers,
            name="Doctor: View Patient Detail"
        )

    @task(3)
    def view_clinical_notes(self):
        """View clinical notes for a patient."""
        if not self.patient_ids:
            return

        patient_id = random.choice(self.patient_ids)
        headers = self.get_auth_headers()
        self.client.get(
            f"/api/clinical-notes/?patient={patient_id}",
            headers=headers,
            name="Doctor: View Clinical Notes"
        )


class WardManagementTasks(TaskSet, AuthMixin):
    """
    Simulates ward management operations.

    Tests the ward analytics endpoint which was optimized.
    """

    def on_start(self):
        """Login as admin user."""
        self.login("admin@example.com", "AdminPassword123")
        self.ward_ids = []

    @task(5)
    def view_ward_list(self):
        """View list of wards."""
        headers = self.get_auth_headers()
        with self.client.get(
            "/api/wards/wards/",
            headers=headers,
            name="Ward: View List",
            catch_response=True
        ) as response:
            if response.status_code == 200:
                wards = response.json().get("results", [])
                self.ward_ids = [w.get("id") for w in wards]
                response.success()

    @task(3)
    def view_ward_analytics(self):
        """View ward analytics (expensive query - optimized)."""
        headers = self.get_auth_headers()
        self.client.get(
            "/api/wards/wards/analytics/",
            headers=headers,
            name="Ward: View Analytics"
        )

    @task(4)
    def view_ward_occupancy(self):
        """View ward occupancy."""
        if not self.ward_ids:
            return

        ward_id = random.choice(self.ward_ids)
        headers = self.get_auth_headers()
        self.client.get(
            f"/api/wards/wards/{ward_id}/",
            headers=headers,
            name="Ward: View Detail"
        )


class HealthCheckTasks(TaskSet):
    """Basic health check tasks for warm-up and baseline."""

    @task
    def health_check(self):
        """Hit the health check endpoint."""
        self.client.get("/api/health/", name="Health Check")


class NurseUser(HttpUser):
    """
    Simulates a nurse user.

    - High frequency of dashboard views
    - Regular vitals recording
    - Alert monitoring
    """

    tasks = [NurseDashboardTasks]
    wait_time = between(1, 5)  # 1-5 seconds between tasks
    weight = 50  # 50% of users are nurses


class DoctorUser(HttpUser):
    """
    Simulates a doctor user.

    - Patient searches
    - Appointment viewing
    - Clinical documentation
    """

    tasks = [DoctorDashboardTasks]
    wait_time = between(2, 8)  # 2-8 seconds between tasks
    weight = 30  # 30% of users are doctors


class AdminUser(HttpUser):
    """
    Simulates an admin user.

    - Ward management
    - Analytics viewing
    - System monitoring
    """

    tasks = [WardManagementTasks]
    wait_time = between(5, 15)  # 5-15 seconds between tasks
    weight = 10  # 10% of users are admins


class HealthCheckUser(HttpUser):
    """
    Simulates monitoring/health check requests.

    - Continuous health checks
    - Used for baseline metrics
    """

    tasks = [HealthCheckTasks]
    wait_time = between(0.5, 1)
    weight = 10  # 10% health check traffic


# Event handlers for custom metrics
@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Log test start."""
    print(f"Load test started at {datetime.now()}")
    print(f"Target host: {environment.host}")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Log test completion with summary."""
    print(f"\nLoad test completed at {datetime.now()}")
    if environment.stats.total.num_requests > 0:
        print(f"Total requests: {environment.stats.total.num_requests}")
        print(f"Total failures: {environment.stats.total.num_failures}")
        print(f"Average response time: {environment.stats.total.avg_response_time:.2f}ms")
        print(f"P95 response time: {environment.stats.total.get_response_time_percentile(0.95):.2f}ms")


@events.request.add_listener
def on_request(request_type, name, response_time, response_length, exception, **kwargs):
    """Track slow requests."""
    if response_time > 1000:  # > 1 second
        print(f"SLOW REQUEST: {name} took {response_time}ms")
