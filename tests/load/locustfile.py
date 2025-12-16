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
        self.login("nurse@hms.com", "Admin123!")
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


class PrescribingDoctorTasks(TaskSet, AuthMixin):
    """
    Simulates doctor prescribing and ordering workflows.
    
    1. Create prescription (triggers safety checks)
    2. Create lab order
    3. View patient timeline (to verify entries)
    4. Discontinue prescription (lifecycle)
    """
    
    def on_start(self):
        """Login as doctor user."""
        self.login("doctor@hms.com", "Admin123!")
        self.patient_ids = []
        self.lab_tests = []
        # Get list of patients first
        headers = self.get_auth_headers()
        response = self.client.get(
            "/api/patients/search/?query=",
            headers=headers,
            name="Doctor: Get Patients"
        )
        if response.status_code == 200:
            results = response.json().get("results", [])
            self.patient_ids = [p.get("id") for p in results[:20]]
            
        # Get available lab tests
        response = self.client.get(
            "/api/laboratory/tests/?is_active=true",
            headers=headers,
            name="Doctor: Get Lab Tests"
        )
        if response.status_code == 200:
            self.lab_tests = response.json().get("results", [])

    @task(5)
    def create_prescription(self):
        """Create a new prescription with prior drug search."""
        if not self.patient_ids:
            return
            
        patient_id = random.choice(self.patient_ids)
        headers = self.get_auth_headers()
        
        # 1. Search for drug (Real user workflow)
        search_terms = ["amox", "lisin", "metfor", "ibupro", "acetam"]
        term = random.choice(search_terms)
        
        with self.client.get(
            f"/api/drug-safety/safety/search_drugs/?q={term}",
            headers=headers,
            name="Doctor: Search Drugs",
            catch_response=True
        ) as search_response:
            if search_response.status_code == 200:
                search_response.success()
            else:
                # If search fails, we probably shouldn't proceed with prescribing in a real scenario,
                # but for load testing we might want to continue or just return.
                # Let's log it and return to simulate "user gave up".
                search_response.failure(f"Drug search failed: {search_response.status_code}")
                return

        # 2. Create Prescription
        medications = [
            ("Amoxicillin", "500mg", "oral", "tid"),
            ("Lisinopril", "10mg", "oral", "daily"),
            ("Metformin", "500mg", "oral", "bid"),
            ("Ibuprofen", "400mg", "oral", "q4h")
        ]
        med, dose, route, freq = random.choice(medications)
        
        payload = {
            "patient": patient_id,
            "medication_name": med,
            "dosage": dose,
            "route": route,
            "frequency": freq,
            "start_date": datetime.now().strftime("%Y-%m-%d"),
            "duration_days": 7,
            "instructions": "Take with food",
            "reason": "Routine care"
        }
        
        with self.client.post(
            "/api/clinical-notes/prescriptions/",
            json=payload,
            headers=headers,
            name="Doctor: Create Prescription",
            catch_response=True
        ) as response:
            if response.status_code == 201:
                response.success()
            elif response.status_code == 400 and "safety" in response.text.lower():
                # Safety check failure is a valid business outcome
                response.success()
            else:
                response.failure(f"Prescription failed: {response.status_code}")

    @task(3)
    def create_lab_order(self):
        """Create a new lab order."""
        if not self.patient_ids or not self.lab_tests:
            return
            
        patient_id = random.choice(self.patient_ids)
        headers = self.get_auth_headers()
        
        # Select 1-3 random tests
        selected_tests = random.sample(self.lab_tests, k=random.randint(1, 3))
        test_ids = [t["id"] for t in selected_tests]
        
        payload = {
            "patient": patient_id,
            "test_ids": test_ids,
            "priority": random.choice(["routine", "urgent"]),
            "clinical_notes": "Routine checkup",
            "fasting_required": False
        }
        
        with self.client.post(
            "/api/laboratory/orders/",
            json=payload,
            headers=headers,
            name="Doctor: Create Lab Order",
            catch_response=True
        ) as response:
            if response.status_code == 201:
                order_id = response.json().get("id")
                # Immediately submit the order
                self.client.post(
                    f"/api/laboratory/orders/{order_id}/submit/",
                    headers=headers,
                    name="Doctor: Submit Lab Order"
                )
                response.success()
            else:
                response.failure(f"Lab Order failed: {response.status_code}")

    @task(2)
    def discontinue_prescription(self):
        """Discontinue an active prescription."""
        if not self.patient_ids:
            return
            
        patient_id = random.choice(self.patient_ids)
        headers = self.get_auth_headers()
        
        # Find active prescriptions
        response = self.client.get(
            f"/api/clinical-notes/prescriptions/?patient={patient_id}&status=active",
            headers=headers,
            name="Doctor: Find Active Rx"
        )
        
        if response.status_code == 200:
            results = response.json().get("results", [])
            if results:
                rx_id = random.choice(results)["id"]
                self.client.post(
                    f"/api/clinical-notes/prescriptions/{rx_id}/discontinue/",
                    json={"reason": "Discontinued by doctor"},
                    headers=headers,
                    name="Doctor: Discontinue Rx"
                )


class LabTechnicianTasks(TaskSet, AuthMixin):
    """
    Simulates lab technician workflow.
    
    1. View pending orders
    2. Collect specimens
    3. Receive specimens in lab
    4. Enter results
    5. Verify results (if authorized)
    6. Complete orders
    """
    
    def on_start(self):
        # Use admin user who has permissions for lab ops in test env
        self.login("lab_tech@hms.com", "Admin123!") 
        
    @task(5)
    def process_lab_orders(self):
        """Find and process ordered lab tests."""
        headers = self.get_auth_headers()
        
        # 1. Find orders needing collection or processing
        # Status: ORDERED -> COLLECTED -> RECEIVED -> PROCESSING -> COMPLETED
        response = self.client.get(
            "/api/laboratory/orders/?status=ordered&pending_only=true",
            headers=headers,
            name="Lab: Find Pending Orders"
        )
        
        if response.status_code != 200:
            return
            
        orders = response.json().get("results", [])
        if not orders:
            return
            
        # Pick one order to process
        order = random.choice(orders)
        order_id = order["id"]
        
        # 2. Collect Specimen
        # First create specimen record
        specimen_payload = {
            "order": order_id,
            "specimen_type": "blood",
            "container_type": "lavender_top",
            "volume_collected": "5ml",
            "collection_site": "Left arm",
            "collected_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        }
        
        spec_resp = self.client.post(
            "/api/laboratory/specimens/",
            json=specimen_payload,
            headers=headers,
            name="Lab: Collect Specimen"
        )
        
        if spec_resp.status_code == 201:
            specimen_id = spec_resp.json().get("id")
            
            # Mark order as collected
            self.client.post(
                f"/api/laboratory/orders/{order_id}/collect/",
                headers=headers,
                name="Lab: Mark Collected"
            )
            
            # 3. Receive Specimen
            self.client.post(
                f"/api/laboratory/specimens/{specimen_id}/receive/",
                json={"storage_location": "Rack A1"},
                headers=headers,
                name="Lab: Receive Specimen"
            )
            
            # Mark order as received
            self.client.post(
                f"/api/laboratory/orders/{order_id}/receive/",
                headers=headers,
                name="Lab: Mark Received"
            )
            
            # 4. Start Processing
            self.client.post(
                f"/api/laboratory/orders/{order_id}/start_processing/",
                headers=headers,
                name="Lab: Start Processing"
            )
            
            # 5. Enter Results (for each test in order)
            # Need to fetch full order details to get test IDs
            detail_resp = self.client.get(
                f"/api/laboratory/orders/{order_id}/?expand=tests",
                headers=headers,
                name="Lab: Get Order Details"
            )
            
            if detail_resp.status_code == 200:
                order_detail = detail_resp.json()
                for order_test in order_detail.get("order_tests", []):
                    result_payload = {
                        "order_test": order_test["id"],
                        "specimen": specimen_id,
                        "value": str(random.randint(50, 150)),
                        "unit": "mg/dL",
                        "performed_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                    }
                    
                    res_resp = self.client.post(
                        "/api/laboratory/results/",
                        json=result_payload,
                        headers=headers,
                        name="Lab: Enter Result"
                    )
                    
                    if res_resp.status_code == 201:
                        result_id = res_resp.json().get("id")
                        # 6. Verify Result
                        self.client.post(
                            f"/api/laboratory/results/{result_id}/verify/",
                            json={"verification_notes": "Verified by system"},
                            headers=headers,
                            name="Lab: Verify Result"
                        )
                
                # 7. Complete Order
                self.client.post(
                    f"/api/laboratory/orders/{order_id}/complete/",
                    headers=headers,
                    name="Lab: Complete Order"
                )


class ReceptionistTasks(TaskSet, AuthMixin):
    """
    Simulates receptionist workflow:
    1. Search for available appointment slots
    2. Book appointments
    """
    
    def on_start(self):
        self.login("receptionist@hms.com", "Admin123!")
        self.patient_ids = []
        self.practitioner_ids = []
        self.appointment_type_ids = []
        
        # Cache patients
        resp = self.client.get("/api/patients/search/?query=")
        if resp.status_code == 200:
            self.patient_ids = [p.get("id") for p in resp.json().get("results", [])[:20]]
            
        # Cache practitioners
        resp = self.client.get("/api/users/practitioners/")
        if resp.status_code == 200:
            self.practitioner_ids = [p.get("id") for p in resp.json().get("results", [])]
            
        # Cache appointment types
        resp = self.client.get("/api/appointments/types/")
        if resp.status_code == 200:
            self.appointment_type_ids = [t.get("id") for t in resp.json().get("results", [])]

    @task(10)
    def search_slots(self):
        """Search for available slots."""
        if not self.practitioner_ids or not self.appointment_type_ids:
            return
            
        practitioner_id = random.choice(self.practitioner_ids)
        appt_type_id = random.choice(self.appointment_type_ids)
        start_date = datetime.now().strftime("%Y-%m-%d")
        end_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        
        self.client.get(
            f"/api/appointments/appointments/available_slots/?practitioner_id={practitioner_id}&start_date={start_date}&end_date={end_date}&appointment_type_id={appt_type_id}",
            headers=self.get_auth_headers(),
            name="Reception: Search Slots"
        )

    @task(5)
    def book_appointment(self):
        """Book an appointment."""
        if not self.patient_ids or not self.practitioner_ids or not self.appointment_type_ids:
            return
            
        practitioner_id = random.choice(self.practitioner_ids)
        appt_type_id = random.choice(self.appointment_type_ids)
        patient_id = random.choice(self.patient_ids)
        
        # Get slots first
        start_date = datetime.now().strftime("%Y-%m-%d")
        end_date = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
        
        resp = self.client.get(
            f"/api/appointments/appointments/available_slots/?practitioner_id={practitioner_id}&start_date={start_date}&end_date={end_date}&appointment_type_id={appt_type_id}",
            headers=self.get_auth_headers(),
            name="Reception: Get Slots for Booking"
        )
        
        if resp.status_code == 200:
            slots = resp.json().get("slots", [])
            if slots:
                slot = random.choice(slots)
                payload = {
                    "patient_id": patient_id,
                    "practitioner_id": practitioner_id,
                    "appointment_type_id": appt_type_id,
                    "start_time": slot["start"],
                    "end_time": slot["end"],
                    "description": "Routine checkup",
                    "comment": "Booked via load test"
                }
                
                self.client.post(
                    "/api/appointments/appointments/",
                    json=payload,
                    headers=self.get_auth_headers(),
                    name="Reception: Book Appointment"
                )


class AdmissionsClerkTasks(TaskSet, AuthMixin):
    """
    Simulates ADT (Admission, Discharge, Transfer) workflow.
    """
    
    def on_start(self):
        self.login("admin@hms.com", "Admin123!") # Use admin for now
        self.patient_ids = []
        self.ward_ids = []
        self.practitioner_ids = []
        
        # Cache patients
        resp = self.client.get("/api/patients/search/?query=")
        if resp.status_code == 200:
            self.patient_ids = [p.get("id") for p in resp.json().get("results", [])[:20]]
            
        # Cache wards
        resp = self.client.get("/api/wards/wards/")
        if resp.status_code == 200:
            self.ward_ids = [w.get("id") for w in resp.json().get("results", [])]
            
        # Cache practitioners (admitting doctors)
        resp = self.client.get("/api/users/practitioners/")
        if resp.status_code == 200:
            self.practitioner_ids = [p.get("id") for p in resp.json().get("results", [])]

    @task(8)
    def check_bed_availability(self):
        """Check for available beds in a ward."""
        if not self.ward_ids:
            return
            
        ward_id = random.choice(self.ward_ids)
        self.client.get(
            f"/api/wards/beds/?ward={ward_id}&status=available",
            headers=self.get_auth_headers(),
            name="ADT: Check Beds"
        )

    @task(2)
    def admit_patient(self):
        """Admit a patient to a ward."""
        if not self.patient_ids or not self.ward_ids or not self.practitioner_ids:
            return
            
        ward_id = random.choice(self.ward_ids)
        
        # Find a bed
        bed_resp = self.client.get(
            f"/api/wards/beds/?ward={ward_id}&status=available",
            headers=self.get_auth_headers(),
            name="ADT: Find Bed"
        )
        
        if bed_resp.status_code == 200:
            beds = bed_resp.json().get("results", [])
            if beds:
                bed = random.choice(beds)
                payload = {
                    "patient": random.choice(self.patient_ids),
                    "bed": bed["id"],
                    "admission_date": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                    "admission_type": "emergency",
                    "admitting_doctor": random.choice(self.practitioner_ids),
                    "admission_notes": "Admitted via load test"
                }
                
                with self.client.post(
                    "/api/wards/admissions/",
                    json=payload,
                    headers=self.get_auth_headers(),
                    name="ADT: Admit Patient",
                    catch_response=True
                ) as resp:
                    if resp.status_code == 201:
                        resp.success()
                    elif resp.status_code == 400 and "occupied" in resp.text.lower():
                        # Race condition handled correctly
                        resp.success()
                    else:
                        resp.failure(f"Admission failed: {resp.status_code}")


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
        self.login("doctor@hms.com", "Admin123!")
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
        self.login("admin@hms.com", "Admin123!")
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


class PrescribingDoctorUser(HttpUser):
    """
    Simulates a doctor actively prescribing and ordering labs.
    Separated from viewing dashboard for more specific load targeting.
    """
    tasks = [PrescribingDoctorTasks]
    wait_time = between(10, 30) # Slower paced, more complex actions
    weight = 15 # 15% of users


class LabTechUser(HttpUser):
    """
    Simulates a lab technician processing orders.
    """
    tasks = [LabTechnicianTasks]
    wait_time = between(2, 10) # Fast paced processing
    weight = 15 # 15% of users


class ReceptionistUser(HttpUser):
    """
    Simulates a receptionist booking appointments.
    """
    tasks = [ReceptionistTasks]
    wait_time = between(5, 20)
    weight = 5 # 5% of users


class AdmissionsClerkUser(HttpUser):
    """
    Simulates an ADT clerk managing admissions.
    """
    tasks = [AdmissionsClerkTasks]
    wait_time = between(10, 40)
    weight = 5 # 5% of users


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
