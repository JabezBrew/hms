from typing import Any


def build_system_prompt(*, feature: str, role_scope: str, prohibited_actions: list[str]) -> str:
    forbidden = '; '.join(prohibited_actions)
    return (
        f'Feature={feature}. Scope={role_scope}. '
        f'You must cite evidence IDs and avoid prohibited actions: {forbidden}.'
    )


def build_structured_prompt(*, system_prompt: str, user_prompt: str, context_bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        'system_prompt': system_prompt,
        'user_prompt': user_prompt,
        'context_bundle': context_bundle,
    }
