"""
Helpers for chunked iteration and bulk data maintenance jobs.
"""
from __future__ import annotations

from itertools import islice


def chunked(iterable, size: int):
    """
    Yield lists of up to ``size`` items from an iterable.
    """
    if size <= 0:
        raise ValueError("size must be positive")

    iterator = iter(iterable)
    while True:
        batch = list(islice(iterator, size))
        if not batch:
            break
        yield batch


def queryset_in_batches(queryset, *, chunk_size: int = 500, ordering: str = 'pk'):
    """
    Iterate over a queryset in stable ordered batches without loading all rows.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")

    ordered = queryset.order_by(ordering)
    lookup = ordering.lstrip('-')
    last_value = None

    while True:
        batch_qs = ordered
        if last_value is not None:
            comparator = f'{lookup}__lt' if ordering.startswith('-') else f'{lookup}__gt'
            batch_qs = batch_qs.filter(**{comparator: last_value})

        batch = list(batch_qs[:chunk_size])
        if not batch:
            break

        yield batch
        last_value = getattr(batch[-1], lookup)
