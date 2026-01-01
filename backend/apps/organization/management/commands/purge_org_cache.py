"""
Management command to purge organization-related cache keys safely.

Uses SCAN for Redis backends and avoids full keyspace flushes.
"""
import fnmatch

from django.core.cache import cache
from django.core.management.base import BaseCommand


DEFAULT_PATTERNS = [
    'org_unit_staff_list:*',
    'org_unit_members_list:*',
    'org_unit_staff_counts:*',
    'org_unit_members_counts:*',
    'org_unit_staff_version:*',
    'org_unit_members_version:*',
]

TREE_PATTERNS = [
    'org_tree:*',
    'org_tree_version',
    'org_tree_last_modified',
]


def _pattern_with_prefix(raw_pattern):
    base_key = raw_pattern.split('*', 1)[0].rstrip(':')
    if not base_key:
        return cache.make_key(raw_pattern)
    sample_key = cache.make_key(base_key)
    prefix = sample_key[:-len(base_key)]
    return f'{prefix}{raw_pattern}'


def _iter_cache_keys(pattern):
    client = getattr(cache, '_cache', None)
    if hasattr(client, 'scan_iter'):
        for key in client.scan_iter(match=pattern, count=1000):
            yield key
        return
    if hasattr(client, 'get_client'):
        redis_client = client.get_client(None, write=False)
        for key in redis_client.scan_iter(match=pattern, count=1000):
            yield key
        return
    if hasattr(client, '_cache') and isinstance(client._cache, dict):
        for key in list(client._cache.keys()):
            if fnmatch.fnmatch(str(key), pattern):
                yield key
        return
    if isinstance(client, dict):
        for key in list(client.keys()):
            if fnmatch.fnmatch(str(key), pattern):
                yield key
        return
    raise RuntimeError('Cache backend does not expose a scan-capable client.')


def _delete_keys(keys):
    if not keys:
        return 0
    client = getattr(cache, '_cache', None)
    if hasattr(client, 'delete_many'):
        deleted = client.delete_many(keys)
        return deleted or 0
    if hasattr(client, 'get_client'):
        redis_client = client.get_client(None, write=True)
        return redis_client.delete(*keys)
    if hasattr(client, '_cache') and isinstance(client._cache, dict):
        deleted = 0
        for key in keys:
            if client._cache.pop(key, None) is not None:
                deleted += 1
        return deleted
    if isinstance(client, dict):
        deleted = 0
        for key in keys:
            if client.pop(key, None) is not None:
                deleted += 1
        return deleted
    raise RuntimeError('Cache backend does not support direct deletion.')


class Command(BaseCommand):
    help = 'Purge organization cache keys (staff/member lists/counts; optional tree cache).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--include-tree',
            action='store_true',
            help='Also purge organization tree cache keys.',
        )
        parser.add_argument(
            '--pattern',
            action='append',
            default=[],
            help='Additional raw cache key pattern(s) without prefix. Can be repeated.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show matching keys without deleting.',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Print matching keys.',
        )

    def handle(self, *args, **options):
        patterns = list(DEFAULT_PATTERNS)
        if options['include_tree']:
            patterns.extend(TREE_PATTERNS)
        patterns.extend(options['pattern'])

        if not patterns:
            self.stdout.write(self.style.WARNING('No cache patterns provided.'))
            return

        total_matches = 0
        total_deleted = 0

        for raw_pattern in patterns:
            pattern = _pattern_with_prefix(raw_pattern)
            keys = list(_iter_cache_keys(pattern))
            total_matches += len(keys)

            if options['verbose'] and keys:
                for key in keys:
                    self.stdout.write(str(key))

            if options['dry_run']:
                self.stdout.write(f'{raw_pattern}: {len(keys)} key(s) matched (dry run)')
                continue

            deleted = _delete_keys(keys)
            total_deleted += deleted
            self.stdout.write(f'{raw_pattern}: deleted {deleted} key(s)')

        if options['dry_run']:
            self.stdout.write(self.style.WARNING(f'Dry run complete. {total_matches} key(s) matched.'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Deleted {total_deleted} key(s).'))
