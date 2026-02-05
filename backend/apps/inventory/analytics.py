"""
Inventory Analytics Service for HMS.

Provides analytics and reporting functions for:
- Consumption patterns and trends
- ABC analysis (value-based classification)
- Supplier performance metrics
- Expiry forecasting
- Stock valuation
"""
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Any, Optional
from django.db import models
from django.db.models import Sum, Avg, Count, F, Q, Case, When, Value
from django.db.models.functions import TruncDay, TruncWeek, TruncMonth, Coalesce
from django.utils import timezone

from .models import (
    InventoryItem, StockMovement, ExpiryTracker, LocationStock,
    PurchaseOrder, PurchaseOrderItem, GoodsReceivedNote,
    StorageLocation, ControlledSubstanceEntry,
    PurchaseRequisition, ControlledSubstanceDiscrepancy,
)


class InventoryAnalyticsService:
    """
    Service for inventory analytics and reporting.
    """

    @staticmethod
    def get_consumption_analytics(
        facility,
        start_date: datetime = None,
        end_date: datetime = None,
        item: 'InventoryItem' = None,
        location: 'StorageLocation' = None,
        category_id: str = None,
        group_by: str = 'day',  # day, week, month
    ) -> Dict[str, Any]:
        """
        Get consumption analytics for inventory items.

        Args:
            facility: Facility context
            start_date: Start of analysis period
            end_date: End of analysis period
            item: Optional specific item to analyze
            location: Optional location filter
            category_id: Optional category filter
            group_by: Grouping period (day, week, month)

        Returns:
            Dict with consumption data, trends, and statistics
        """
        # Default to last 30 days
        if not end_date:
            end_date = timezone.now()
        if not start_date:
            start_date = end_date - timedelta(days=30)

        # Base queryset - consumption movements
        consumption_types = ['dispense', 'consumption', 'wastage', 'disposal']
        queryset = StockMovement.objects.filter(
            facility=facility,
            movement_type__in=consumption_types,
            timestamp__gte=start_date,
            timestamp__lte=end_date,
        )

        if item:
            queryset = queryset.filter(item=item)
        if location:
            queryset = queryset.filter(
                Q(source_location=location) | Q(destination_location=location)
            )
        if category_id:
            queryset = queryset.filter(item__category_id=category_id)

        # Choose grouping function
        if group_by == 'week':
            trunc_func = TruncWeek('timestamp')
        elif group_by == 'month':
            trunc_func = TruncMonth('timestamp')
        else:
            trunc_func = TruncDay('timestamp')

        # Consumption by period
        by_period = list(queryset.annotate(
            period=trunc_func
        ).values('period').annotate(
            total_quantity=Sum('quantity'),
            total_value=Sum(F('quantity') * F('unit_cost')),
            movement_count=Count('id'),
        ).order_by('period'))

        # Top consumed items
        top_items = list(queryset.values(
            'item__id', 'item__name', 'item__sku'
        ).annotate(
            total_quantity=Sum('quantity'),
            total_value=Sum(F('quantity') * F('unit_cost')),
        ).order_by('-total_quantity')[:10])

        # Consumption by type
        by_type = list(queryset.values('movement_type').annotate(
            total_quantity=Sum('quantity'),
            total_value=Sum(F('quantity') * F('unit_cost')),
        ))

        # Summary statistics
        totals = queryset.aggregate(
            total_quantity=Coalesce(Sum('quantity'), 0),
            total_value=Coalesce(Sum(F('quantity') * F('unit_cost')), Decimal('0')),
            movement_count=Count('id'),
            unique_items=Count('item', distinct=True),
        )

        # Calculate average daily consumption
        days = (end_date - start_date).days or 1
        avg_daily = totals['total_quantity'] / days if totals['total_quantity'] else 0

        return {
            'period': {
                'start': start_date.isoformat(),
                'end': end_date.isoformat(),
                'days': days,
            },
            'summary': {
                'total_quantity': totals['total_quantity'],
                'total_value': str(totals['total_value']),
                'movement_count': totals['movement_count'],
                'unique_items': totals['unique_items'],
                'average_daily_consumption': round(avg_daily, 2),
            },
            'by_period': by_period,
            'top_items': top_items,
            'by_type': by_type,
        }

    @staticmethod
    def get_abc_analysis(
        facility,
        analysis_period_days: int = 365,
    ) -> Dict[str, Any]:
        """
        Perform ABC analysis on inventory items based on consumption value.

        A items: Top 80% of value (typically ~20% of items)
        B items: Next 15% of value (typically ~30% of items)
        C items: Bottom 5% of value (typically ~50% of items)

        Args:
            facility: Facility context
            analysis_period_days: Period to analyze consumption

        Returns:
            Dict with ABC classification for items
        """
        start_date = timezone.now() - timedelta(days=analysis_period_days)

        # Get consumption value per item
        consumption = StockMovement.objects.filter(
            facility=facility,
            movement_type__in=['dispense', 'consumption', 'wastage'],
            timestamp__gte=start_date,
        ).values(
            'item__id', 'item__name', 'item__sku', 'item__category__name'
        ).annotate(
            total_quantity=Sum('quantity'),
            total_value=Sum(F('quantity') * F('unit_cost')),
            avg_unit_cost=Avg('unit_cost'),
        ).order_by('-total_value')

        consumption_list = list(consumption)
        total_value = sum(
            (item['total_value'] or Decimal('0')) for item in consumption_list
        )

        # Classify items
        a_items = []
        b_items = []
        c_items = []
        cumulative_value = Decimal('0')

        for item in consumption_list:
            item_value = item['total_value'] or Decimal('0')
            cumulative_value += item_value
            cumulative_pct = (cumulative_value / total_value * 100) if total_value else 0

            item_data = {
                'item_id': str(item['item__id']),
                'name': item['item__name'],
                'sku': item['item__sku'],
                'category': item['item__category__name'],
                'total_quantity': item['total_quantity'],
                'total_value': str(item_value),
                'cumulative_pct': round(cumulative_pct, 2),
            }

            if cumulative_pct <= 80:
                item_data['class'] = 'A'
                a_items.append(item_data)
            elif cumulative_pct <= 95:
                item_data['class'] = 'B'
                b_items.append(item_data)
            else:
                item_data['class'] = 'C'
                c_items.append(item_data)

        return {
            'analysis_period_days': analysis_period_days,
            'total_value': str(total_value),
            'total_items': len(consumption_list),
            'summary': {
                'A': {
                    'count': len(a_items),
                    'pct_items': round(len(a_items) / len(consumption_list) * 100, 1) if consumption_list else 0,
                    'value_pct': 80,
                },
                'B': {
                    'count': len(b_items),
                    'pct_items': round(len(b_items) / len(consumption_list) * 100, 1) if consumption_list else 0,
                    'value_pct': 15,
                },
                'C': {
                    'count': len(c_items),
                    'pct_items': round(len(c_items) / len(consumption_list) * 100, 1) if consumption_list else 0,
                    'value_pct': 5,
                },
            },
            'items': {
                'A': a_items,
                'B': b_items,
                'C': c_items,
            },
        }

    @staticmethod
    def get_supplier_performance(
        facility,
        start_date: datetime = None,
        end_date: datetime = None,
        supplier_id: str = None,
    ) -> Dict[str, Any]:
        """
        Analyze supplier performance metrics.

        Metrics:
        - On-time delivery rate
        - Quality acceptance rate
        - Average lead time
        - Order fulfillment rate

        Args:
            facility: Facility context
            start_date: Start of analysis period
            end_date: End of analysis period
            supplier_id: Optional specific supplier

        Returns:
            Dict with supplier performance metrics
        """
        if not end_date:
            end_date = timezone.now()
        if not start_date:
            start_date = end_date - timedelta(days=365)

        # Base PO queryset
        po_queryset = PurchaseOrder.objects.filter(
            facility=facility,
            created_at__gte=start_date,
            created_at__lte=end_date,
            status__in=['fully_received', 'partially_received', 'closed'],
        )

        if supplier_id:
            po_queryset = po_queryset.filter(supplier_id=supplier_id)

        # Get supplier performance
        suppliers = po_queryset.values(
            'supplier__id', 'supplier__name'
        ).annotate(
            total_orders=Count('id'),
            total_value=Sum('total_amount'),
            # Orders delivered on or before expected date
            on_time_orders=Count(
                'id',
                filter=Q(
                    goods_received_notes__received_at__lte=F('expected_delivery_date')
                )
            ),
        )

        supplier_data = []
        for supplier in suppliers:
            supplier_id = supplier['supplier__id']

            # Get GRN quality data
            grns = GoodsReceivedNote.objects.filter(
                purchase_order__supplier_id=supplier_id,
                purchase_order__facility=facility,
                received_at__gte=start_date,
                received_at__lte=end_date,
            )

            quality_stats = grns.aggregate(
                total_grns=Count('id'),
                accepted=Count('id', filter=Q(status='accepted')),
                partially_accepted=Count('id', filter=Q(status='partially_accepted')),
                rejected=Count('id', filter=Q(status='rejected')),
                with_issues=Count('id', filter=Q(has_quality_issues=True)),
            )

            # Calculate lead times
            lead_times = []
            for po in PurchaseOrder.objects.filter(
                supplier_id=supplier_id,
                facility=facility,
                sent_at__isnull=False,
            ).prefetch_related('goods_received_notes'):
                for grn in po.goods_received_notes.all():
                    if po.sent_at and grn.received_at:
                        lead_time = (grn.received_at.date() - po.sent_at.date()).days
                        lead_times.append(lead_time)

            avg_lead_time = sum(lead_times) / len(lead_times) if lead_times else None

            total_orders = supplier['total_orders']
            on_time = supplier['on_time_orders']
            total_grns = quality_stats['total_grns'] or 0
            accepted = quality_stats['accepted'] or 0
            partial = quality_stats['partially_accepted'] or 0

            supplier_data.append({
                'supplier_id': str(supplier_id),
                'supplier_name': supplier['supplier__name'],
                'total_orders': total_orders,
                'total_value': str(supplier['total_value'] or 0),
                'on_time_delivery_rate': round(on_time / total_orders * 100, 1) if total_orders else 0,
                'quality_acceptance_rate': round(
                    (accepted + partial) / total_grns * 100, 1
                ) if total_grns else 0,
                'full_acceptance_rate': round(accepted / total_grns * 100, 1) if total_grns else 0,
                'rejection_rate': round(
                    (quality_stats['rejected'] or 0) / total_grns * 100, 1
                ) if total_grns else 0,
                'quality_issues_rate': round(
                    (quality_stats['with_issues'] or 0) / total_grns * 100, 1
                ) if total_grns else 0,
                'average_lead_time_days': round(avg_lead_time, 1) if avg_lead_time else None,
                'total_deliveries': total_grns,
            })

        # Sort by total value descending
        supplier_data.sort(key=lambda x: Decimal(x['total_value']), reverse=True)

        return {
            'period': {
                'start': start_date.isoformat(),
                'end': end_date.isoformat(),
            },
            'suppliers': supplier_data,
            'summary': {
                'total_suppliers': len(supplier_data),
                'total_orders': sum(s['total_orders'] for s in supplier_data),
                'total_value': str(sum(Decimal(s['total_value']) for s in supplier_data)),
            },
        }

    @staticmethod
    def get_expiry_forecast(
        facility,
        days_ahead: int = 90,
        location: 'StorageLocation' = None,
        category_id: str = None,
    ) -> Dict[str, Any]:
        """
        Forecast items expiring within specified period.

        Args:
            facility: Facility context
            days_ahead: Number of days to look ahead
            location: Optional location filter
            category_id: Optional category filter

        Returns:
            Dict with expiry forecast data
        """
        today = timezone.now().date()
        expiry_date = today + timedelta(days=days_ahead)

        queryset = ExpiryTracker.objects.filter(
            item__facility=facility,
            status='active',
            remaining_quantity__gt=0,
            expiry_date__lte=expiry_date,
        ).select_related('item', 'location')

        if location:
            queryset = queryset.filter(location=location)
        if category_id:
            queryset = queryset.filter(item__category_id=category_id)

        # Group by expiry windows
        expired = queryset.filter(expiry_date__lt=today)
        expiring_7d = queryset.filter(
            expiry_date__gte=today,
            expiry_date__lte=today + timedelta(days=7)
        )
        expiring_30d = queryset.filter(
            expiry_date__gt=today + timedelta(days=7),
            expiry_date__lte=today + timedelta(days=30)
        )
        expiring_90d = queryset.filter(
            expiry_date__gt=today + timedelta(days=30),
            expiry_date__lte=expiry_date
        )

        def summarize(qs):
            agg = qs.aggregate(
                count=Count('id'),
                total_qty=Coalesce(Sum('remaining_quantity'), 0),
                total_value=Coalesce(
                    Sum(F('remaining_quantity') * F('item__unit_cost')),
                    Decimal('0')
                ),
            )
            items = list(qs.values(
                'item__id', 'item__name', 'item__sku',
                'batch_number', 'expiry_date', 'remaining_quantity',
                'location__name'
            ).annotate(
                value_at_risk=F('remaining_quantity') * F('item__unit_cost')
            ).order_by('expiry_date')[:20])
            return {
                'count': agg['count'],
                'total_quantity': agg['total_qty'],
                'total_value': str(agg['total_value']),
                'items': items,
            }

        return {
            'as_of': today.isoformat(),
            'forecast_days': days_ahead,
            'expired': summarize(expired),
            'expiring_7_days': summarize(expiring_7d),
            'expiring_30_days': summarize(expiring_30d),
            'expiring_90_days': summarize(expiring_90d),
            'summary': {
                'total_batches': queryset.count(),
                'total_quantity': queryset.aggregate(
                    t=Coalesce(Sum('remaining_quantity'), 0)
                )['t'],
                'total_value_at_risk': str(queryset.aggregate(
                    t=Coalesce(
                        Sum(F('remaining_quantity') * F('item__unit_cost')),
                        Decimal('0')
                    )
                )['t']),
            },
        }

    @staticmethod
    def get_stock_valuation(
        facility,
        location: 'StorageLocation' = None,
        category_id: str = None,
    ) -> Dict[str, Any]:
        """
        Calculate stock valuation.

        Args:
            facility: Facility context
            location: Optional location filter
            category_id: Optional category filter

        Returns:
            Dict with stock valuation data
        """
        queryset = LocationStock.objects.filter(
            location__facility=facility,
            quantity__gt=0,
        ).select_related('item', 'location')

        if location:
            queryset = queryset.filter(location=location)
        if category_id:
            queryset = queryset.filter(item__category_id=category_id)

        # Overall valuation
        total = queryset.aggregate(
            total_quantity=Coalesce(Sum('quantity'), 0),
            total_value=Coalesce(
                Sum(F('quantity') * F('item__unit_cost')),
                Decimal('0')
            ),
            unique_items=Count('item', distinct=True),
            locations=Count('location', distinct=True),
        )

        # By location
        by_location = list(queryset.values(
            'location__id', 'location__name', 'location__code'
        ).annotate(
            total_quantity=Sum('quantity'),
            total_value=Sum(F('quantity') * F('item__unit_cost')),
            item_count=Count('item'),
        ).order_by('-total_value'))

        # By category
        by_category = list(queryset.values(
            'item__category__id', 'item__category__name'
        ).annotate(
            total_quantity=Sum('quantity'),
            total_value=Sum(F('quantity') * F('item__unit_cost')),
            item_count=Count('item', distinct=True),
        ).order_by('-total_value'))

        # Top valued items
        top_items = list(queryset.values(
            'item__id', 'item__name', 'item__sku', 'item__category__name'
        ).annotate(
            total_quantity=Sum('quantity'),
            total_value=Sum(F('quantity') * F('item__unit_cost')),
        ).order_by('-total_value')[:20])

        return {
            'as_of': timezone.now().isoformat(),
            'summary': {
                'total_quantity': total['total_quantity'],
                'total_value': str(total['total_value']),
                'unique_items': total['unique_items'],
                'locations': total['locations'],
            },
            'by_location': by_location,
            'by_category': by_category,
            'top_items': top_items,
        }

    @staticmethod
    def get_controlled_substance_report(
        facility,
        start_date: datetime = None,
        end_date: datetime = None,
        location: 'StorageLocation' = None,
        item: 'InventoryItem' = None,
    ) -> Dict[str, Any]:
        """
        Generate controlled substance activity report.

        Args:
            facility: Facility context
            start_date: Start of report period
            end_date: End of report period
            location: Optional location filter
            item: Optional item filter

        Returns:
            Dict with controlled substance activity report
        """
        if not end_date:
            end_date = timezone.now()
        if not start_date:
            start_date = end_date - timedelta(days=30)

        queryset = ControlledSubstanceEntry.objects.filter(
            register__facility=facility,
            timestamp__gte=start_date,
            timestamp__lte=end_date,
        ).select_related(
            'register__item', 'register__location',
            'performed_by', 'witness', 'patient'
        )

        if location:
            queryset = queryset.filter(register__location=location)
        if item:
            queryset = queryset.filter(register__item=item)

        # By entry type
        by_type = list(queryset.values('entry_type').annotate(
            count=Count('id'),
            total_quantity=Sum('quantity'),
        ).order_by('-count'))

        # By item
        by_item = list(queryset.values(
            'register__item__id', 'register__item__name',
            'register__item__controlled_schedule'
        ).annotate(
            entry_count=Count('id'),
            total_dispensed=Sum(
                'quantity',
                filter=Q(entry_type='dispense')
            ),
            total_received=Sum(
                'quantity',
                filter=Q(entry_type='receipt')
            ),
            total_wasted=Sum(
                'quantity',
                filter=Q(entry_type='wastage')
            ),
        ).order_by('-entry_count'))

        # By performer
        by_performer = list(queryset.values(
            'performed_by__id',
            'performed_by__first_name',
            'performed_by__last_name'
        ).annotate(
            entry_count=Count('id'),
            dispense_count=Count('id', filter=Q(entry_type='dispense')),
            wastage_count=Count('id', filter=Q(entry_type='wastage')),
        ).order_by('-entry_count')[:20])

        # Summary
        summary = queryset.aggregate(
            total_entries=Count('id'),
            total_dispensed=Coalesce(
                Sum('quantity', filter=Q(entry_type='dispense')), 0
            ),
            total_received=Coalesce(
                Sum('quantity', filter=Q(entry_type='receipt')), 0
            ),
            total_wasted=Coalesce(
                Sum('quantity', filter=Q(entry_type='wastage')), 0
            ),
            unique_items=Count('register__item', distinct=True),
            unique_patients=Count('patient', distinct=True),
        )

        # Recent entries
        recent = list(queryset.order_by('-timestamp')[:50].values(
            'id', 'entry_type', 'entry_number', 'quantity',
            'balance_before', 'balance_after',
            'register__item__name', 'register__location__name',
            'performed_by__first_name', 'performed_by__last_name',
            'witness__first_name', 'witness__last_name',
            'timestamp'
        ))

        return {
            'period': {
                'start': start_date.isoformat(),
                'end': end_date.isoformat(),
            },
            'summary': summary,
            'by_type': by_type,
            'by_item': by_item,
            'by_performer': by_performer,
            'recent_entries': recent,
        }

    @staticmethod
    def get_inventory_dashboard_kpis(facility) -> Dict[str, Any]:
        """
        Get key performance indicators for inventory dashboard.

        Args:
            facility: Facility context

        Returns:
            Dict with KPIs for dashboard display
        """
        today = timezone.now().date()

        # Stock values
        stock = LocationStock.objects.filter(
            location__facility=facility
        ).aggregate(
            total_value=Coalesce(
                Sum(F('quantity') * F('item__unit_cost')),
                Decimal('0')
            ),
            total_quantity=Coalesce(Sum('quantity'), 0),
            unique_items=Count('item', distinct=True),
        )

        # Low stock items
        low_stock = LocationStock.objects.filter(
            location__facility=facility
        ).annotate(
            effective_reorder=Case(
                When(reorder_level__isnull=False, then=F('reorder_level')),
                default=F('item__reorder_level'),
            )
        ).filter(
            quantity__lte=F('effective_reorder')
        ).count()

        # Expiring items (30 days)
        expiring = ExpiryTracker.objects.filter(
            item__facility=facility,
            status='active',
            remaining_quantity__gt=0,
            expiry_date__lte=today + timedelta(days=30),
            expiry_date__gte=today,
        ).count()

        # Expired items
        expired = ExpiryTracker.objects.filter(
            item__facility=facility,
            status='active',
            remaining_quantity__gt=0,
            expiry_date__lt=today,
        ).count()

        # Pending orders
        pending_pos = PurchaseOrder.objects.filter(
            facility=facility,
            status__in=['sent', 'acknowledged', 'partially_received'],
        ).count()

        # Pending requisitions (waiting for approval)
        pending_requisitions = PurchaseRequisition.objects.filter(
            facility=facility,
            status='pending_approval',
        ).count()

        # Pending GRNs (waiting for inspection)
        pending_grns = GoodsReceivedNote.objects.filter(
            facility=facility,
            status='pending_inspection',
        ).count()

        # Unresolved discrepancies (controlled substances)
        discrepancies = ControlledSubstanceDiscrepancy.objects.filter(
            register__facility=facility,
            status__in=['reported', 'investigating'],
        ).count()

        # Recent consumption (7 days)
        week_ago = timezone.now() - timedelta(days=7)
        weekly_consumption = StockMovement.objects.filter(
            facility=facility,
            movement_type__in=['dispense', 'consumption'],
            timestamp__gte=week_ago,
        ).aggregate(
            total=Coalesce(Sum('quantity'), 0),
            value=Coalesce(
                Sum(F('quantity') * F('unit_cost')),
                Decimal('0')
            ),
        )

        return {
            'stock': {
                'total_value': str(stock['total_value']),
                'total_quantity': stock['total_quantity'],
                'unique_items': stock['unique_items'],
            },
            'alerts': {
                'low_stock_items': low_stock,
                'expiring_soon': expiring,
                'expired': expired,
            },
            'orders': {
                'pending_pos': pending_pos,
            },
            'pending_requisitions': pending_requisitions,
            'pending_grns': pending_grns,
            'discrepancies': discrepancies,
            'consumption_7_days': {
                'quantity': weekly_consumption['total'],
                'value': str(weekly_consumption['value']),
            },
        }
