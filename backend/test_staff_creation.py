import requests
import json
from datetime import date

# Base URL for the API
base_url = 'http://localhost:8000/api'

# Admin credentials
admin_credentials = {
    'email': 'admin@example.com',
    'password': 'adminpassword'
}

# Login to get token
def login():
    response = requests.post(f'{base_url}/auth/login/', data=admin_credentials)
    if response.status_code == 200:
        return response.json().get('token')
    else:
        print(f"Login failed: {response.text}")
        return None

# Create a staff member with FHIR resource
def create_staff(token):
    headers = {
        'Authorization': f'Token {token}',
        'Content-Type': 'application/json'
    }
    
    # Staff data for a doctor
    staff_data = {
        # User fields
        'email': 'doctor@example.com',
        'password': 'doctorpassword',
        'confirm_password': 'doctorpassword',
        'first_name': 'John',
        'last_name': 'Doe',
        'phone_number': '1234567890',
        'date_of_birth': '1980-01-01',
        'user_type': 'doctor',
        
        # Staff fields
        'department': 'Cardiology',
        'position': 'Senior Doctor',
        'hire_date': date.today().isoformat(),
        
        # PractitionerProfile fields
        'license_number': 'MD12345',
        'specialization': 'Cardiology',
        'qualification': 'MD, PhD',
        
        # Address fields
        'address_line1': '123 Main St',
        'city': 'Anytown',
        'state': 'CA',
        'postal_code': '12345',
        'country': 'USA'
    }
    
    response = requests.post(f'{base_url}/users/staff/register/', json=staff_data, headers=headers)
    return response

# Main function
def main():
    token = login()
    if not token:
        return
    
    print("Creating staff member...")
    response = create_staff(token)
    
    if response.status_code == 201:
        print("Staff created successfully!")
        print(json.dumps(response.json(), indent=2))
    else:
        print(f"Failed to create staff: {response.status_code}")
        print(response.text)

if __name__ == '__main__':
    main()