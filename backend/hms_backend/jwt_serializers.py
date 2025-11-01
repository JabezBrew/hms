from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT serializer that includes user type in token claims
    """
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Add custom claims
        token['user_type'] = user.user_type
        token['email'] = user.email

        return token


def get_tokens_for_user(user):
    """
    Generate JWT tokens with custom claims for a user
    """
    refresh = RefreshToken.for_user(user)

    # Add custom claims
    refresh['user_type'] = user.user_type
    refresh['email'] = user.email

    # Access token inherits claims from refresh token
    access = refresh.access_token
    access['user_type'] = user.user_type
    access['email'] = user.email

    return {
        'refresh': str(refresh),
        'access': str(access),
    }
