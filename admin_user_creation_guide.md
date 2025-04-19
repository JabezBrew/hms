# Creating an Admin User in the Hospital Management System

This guide provides instructions on how to create an administrator user in the Hospital Management System. Admin users have full access to all data and configuration in the system.

## Method 1: Using Django's Management Commands (Recommended)

The most straightforward way to create an admin user is through Django's built-in management commands.

### Prerequisites
- Access to the server where the backend is running
- Python and Django installed

### Steps

1. Navigate to the backend directory of the project:
   ```bash
   cd /path/to/hms/backend
   ```

2. Create a superuser using Django's createsuperuser command:
   ```bash
   python manage.py createsuperuser
   ```

3. Follow the prompts to enter:
   - Email address
   - Username (optional)
   - Password (will not be visible when typing)

4. After creating the superuser, update the user type to 'admin':
   ```bash
   python manage.py shell
   ```

5. In the Python shell, run:
   ```python
   from django.contrib.auth import get_user_model
   User = get_user_model()
   user = User.objects.get(email='admin@example.com')  # Replace with the email you used
   user.user_type = 'admin'
   user.save()
   exit()
   ```

## Method 2: Using the Django Admin Interface

If you already have an admin user, you can create additional admin users through the Django admin interface.

### Prerequisites
- An existing admin user account
- Access to the Django admin interface

### Steps

1. Log in to the Django admin interface at `http://your-server/admin/`

2. Navigate to "Users" under the "Authentication and Authorization" section

3. Click "Add User" in the top right corner

4. Fill in the required fields:
   - Email address
   - Password
   - Confirm password

5. Click "Save" to create the user

6. On the user detail page, set the "User type" field to "Administrator"

7. Assign the user to the "Admin" group

8. Click "Save" to update the user

## Method 3: Using the API (For Developers)

You can also create an admin user programmatically through the API.

### Prerequisites
- An existing admin user account for authentication
- API access token

### Steps

1. Obtain an authentication token by logging in with an existing admin account:
   ```bash
   curl -X POST http://your-server/api/auth/login/ \
     -H "Content-Type: application/json" \
     -d '{"email": "existing_admin@example.com", "password": "your_password"}'
   ```

2. Create a new user with the admin role:
   ```bash
   curl -X POST http://your-server/api/users/ \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -d '{
       "email": "new_admin@example.com",
       "password": "secure_password",
       "user_type": "admin",
       "first_name": "Admin",
       "last_name": "User"
     }'
   ```

## Verifying Admin Access

After creating an admin user, you should:

1. Log in to the application using the admin credentials
2. Verify that you can access all sections of the application
3. Confirm that the user role displayed in the user dropdown menu is "Administrator"
4. Test creating other users and assigning them different roles

## Security Considerations

- Use strong, unique passwords for admin accounts
- Limit the number of admin users to only those who need full system access
- Regularly audit the list of admin users
- Consider implementing two-factor authentication for admin accounts
- Revoke access immediately when an admin user no longer needs it