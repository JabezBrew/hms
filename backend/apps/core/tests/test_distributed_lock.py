import pytest

from django.core.cache import cache

from apps.core import distributed_lock as lock_module


class _FakeRedisLockClient:
    def __init__(self, lock_name):
        self.lock_key = lock_module._get_lock_key(lock_name)
        self.extend_calls = 0

    def eval(self, script, _numkeys, _redis_key, *args):
        if script == lock_module._RELEASE_IF_OWNER_SCRIPT:
            token = args[0]
            if cache.get(self.lock_key) == token:
                cache.delete(self.lock_key)
                return 1
            return 0

        if script == lock_module._EXTEND_IF_OWNER_SCRIPT:
            token = args[0]
            if cache.get(self.lock_key) != token:
                return 0
            self.extend_calls += 1
            return 1

        raise AssertionError("Unexpected script invocation")


@pytest.mark.django_db
def test_release_lock_uses_owner_token_when_redis_client_available(monkeypatch):
    lock_name = 'patient-search-reindex'
    token = lock_module.acquire_lock(lock_name, timeout=30)
    fake_client = _FakeRedisLockClient(lock_name)

    monkeypatch.setattr(lock_module, '_get_redis_lock_client', lambda: fake_client)

    assert lock_module.release_lock(lock_name, token='wrong-token') is False
    assert cache.get(lock_module._get_lock_key(lock_name)) == token

    assert lock_module.release_lock(lock_name, token=token) is True
    assert cache.get(lock_module._get_lock_key(lock_name)) is None


@pytest.mark.django_db
def test_extend_lock_uses_owner_token_when_redis_client_available(monkeypatch):
    lock_name = 'patient-search-sync'
    token = lock_module.acquire_lock(lock_name, timeout=30)
    fake_client = _FakeRedisLockClient(lock_name)

    monkeypatch.setattr(lock_module, '_get_redis_lock_client', lambda: fake_client)

    assert lock_module.extend_lock(lock_name, token='wrong-token', additional_time=45) is False
    assert lock_module.extend_lock(lock_name, token=token, additional_time=45) is True
    assert fake_client.extend_calls == 1
