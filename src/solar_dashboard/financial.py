"""Financial model calculations for the Solar Fleet Operations & Monitoring Dashboard.

All monetary values are in THB. Formulas follow the project financial model:

- Site financial value  = self_consumed_kwh * grid_import_tariff + exported_kwh * feed_in_tariff
- Revenue lost (dust)   = (expected_yield_kwh - actual_yield_kwh) * feed_in_tariff
- Daily loss            = window soiling loss / number of days
- 7/30-day projection   = daily loss * 7 / 30
- Dispatch decision     = 30-day projected loss > cleaning cost -> RECOMMEND_DISPATCH
"""
from typing import Any, Dict, List, Optional

_EN_RECOMMEND = (
    "Recommend dispatching the cleaning team urgently: projected revenue loss of "
    "{projected:,.0f} THB in the next 30 days exceeds the {cleaning:,.0f} THB cleaning cost "
    "(Net Saving: +{saving:,.0f} THB)."
)
_EN_NO_ACTION = (
    "Not cost-effective to dispatch a cleaning team yet: 30-day cumulative loss is "
    "{projected:,.0f} THB, below the {cleaning:,.0f} THB cleaning service cost. "
    "Recommend continued monitoring or waiting for natural rain."
)


def site_financial_value(
    self_consumed_kwh: float,
    exported_kwh: float,
    grid_import_tariff: float,
    feed_in_tariff: float,
) -> float:
    """(consumed_from_pv_kwh * grid_import) + (exported_kwh * feed_in), in THB."""
    value = max(0.0, self_consumed_kwh) * grid_import_tariff + max(0.0, exported_kwh) * feed_in_tariff
    return round(max(0.0, value), 2)


def revenue_lost_thb(expected_kwh: float, actual_kwh: float, feed_in_tariff: float) -> float:
    """(expected_yield - actual_yield) * feed_in_tariff, in THB."""
    delta = max(0.0, expected_kwh - actual_kwh)
    return round(delta * feed_in_tariff, 2)


def self_consumed_kwh(actual_kwh: float, exported_kwh: float) -> float:
    """PV energy used on-site = actual yield not exported to the grid."""
    if actual_kwh <= 0.0:
        return 0.0
    return max(0.0, actual_kwh - max(0.0, exported_kwh))


def daily_loss_summary(history: List[Dict[str, Any]], feed_in_tariff: float) -> Dict[str, float]:
    """Average daily soiling loss (kWh & THB) plus 7/30-day projections."""
    total_expected = sum(float(r.get("expected_yield_kwh", 0.0)) for r in history)
    total_actual = sum(float(r.get("actual_yield_kwh", 0.0)) for r in history)
    days = max(1, len(history))
    loss_kwh_window = max(0.0, total_expected - total_actual)
    daily_loss_kwh = loss_kwh_window / days
    daily_loss_thb = daily_loss_kwh * feed_in_tariff
    return {
        "loss_kwh_window": round(loss_kwh_window, 2),
        "daily_loss_kwh": round(daily_loss_kwh, 2),
        "daily_loss_thb": round(daily_loss_thb, 2),
        "projected_7d_thb": round(daily_loss_thb * 7, 2),
        "projected_30d_thb": round(daily_loss_thb * 30, 2),
    }


def latest_daily_loss_summary(
    latest_record: Any,
    feed_in_tariff: float,
) -> Dict[str, float]:
    """Daily loss and 7/30-day projections based strictly on the latest completed day baseline."""
    if not latest_record:
        return {
            "daily_loss_kwh": 0.0,
            "daily_loss_thb": 0.0,
            "projected_7d_thb": 0.0,
            "projected_30d_thb": 0.0,
        }
    exp = float(latest_record.get("expected_yield_kwh", 0.0))
    act = float(latest_record.get("actual_yield_kwh", 0.0))
    daily_loss_kwh = max(0.0, exp - act)
    daily_loss_thb = daily_loss_kwh * feed_in_tariff
    return {
        "daily_loss_kwh": round(daily_loss_kwh, 2),
        "daily_loss_thb": round(daily_loss_thb, 2),
        "projected_7d_thb": round(daily_loss_thb * 7, 2),
        "projected_30d_thb": round(daily_loss_thb * 30, 2),
    }


def real_time_soiling_loss_summary(
    capacity_kwp: float,
    irradiance_w_m2: float,
    pv_power_kw: float,
    yesterday_soiling_loss_pct: float,
    yesterday_daily_lost_thb: float,
    feed_in_tariff: float = 2.20,
    effective_tariff: Optional[float] = None,
) -> Dict[str, Any]:
    """Calculate real-time soiling loss and daily revenue lost:

    1. Check if sufficient sunlight exists:
       - If irradiance >= 150.0 W/m2:
           expected_pv_kw = capacity_kwp * (irradiance_w_m2 / 1000.0) * 0.95
           soiling_loss_pct = max(0.0, ((expected_pv_kw - pv_power_kw) / expected_pv_kw) * 100.0)
           daily_lost_kwh = capacity_kwp * 4.5 * 0.95 * (soiling_loss_pct / 100.0)
           daily_lost_thb = daily_lost_kwh * tariff (effective_tariff or feed_in_tariff)
       - If irradiance < 150.0 W/m2 (night-time or low sun):
           Fallback to yesterday's completed day baseline.
    """
    tariff = effective_tariff if (effective_tariff is not None and effective_tariff > 0) else feed_in_tariff

    if irradiance_w_m2 >= 150.0 and capacity_kwp > 0.0:
        expected_pv_kw = capacity_kwp * (irradiance_w_m2 / 1000.0) * 0.95
        if expected_pv_kw > 0.0:
            soiling_loss_pct = max(0.0, ((expected_pv_kw - pv_power_kw) / expected_pv_kw) * 100.0)
        else:
            soiling_loss_pct = 0.0
        daily_lost_kwh = capacity_kwp * 4.5 * 0.95 * (soiling_loss_pct / 100.0)
        daily_lost_thb = daily_lost_kwh * tariff
        is_realtime = True
    else:
        soiling_loss_pct = yesterday_soiling_loss_pct
        if effective_tariff is not None and effective_tariff > 0 and capacity_kwp > 0.0:
            daily_lost_kwh = capacity_kwp * 4.5 * 0.95 * (soiling_loss_pct / 100.0)
            daily_lost_thb = daily_lost_kwh * effective_tariff
        else:
            daily_lost_thb = yesterday_daily_lost_thb
            daily_lost_kwh = (daily_lost_thb / tariff) if tariff > 0 else 0.0
        is_realtime = False

    daily_lost_thb = round(max(0.0, daily_lost_thb), 2)
    daily_lost_kwh = round(max(0.0, daily_lost_kwh), 2)
    return {
        "soiling_loss_pct": round(soiling_loss_pct, 2),
        "daily_loss_kwh": daily_lost_kwh,
        "daily_loss_thb": daily_lost_thb,
        "projected_7d_thb": round(daily_lost_thb * 7, 2),
        "projected_30d_thb": round(daily_lost_thb * 30, 2),
        "is_realtime": is_realtime,
        "tariff_used": round(tariff, 2),
    }


def dispatch_recommendation(projected_30d_thb: float, cleaning_cost: float) -> Dict[str, Any]:
    """AI action recommendation based on the 30-day projected revenue loss (Cost of Inaction)."""
    if projected_30d_thb > cleaning_cost:
        net_saving = projected_30d_thb - cleaning_cost
        title = "⚠️ ACTION REQUIRED: สั่งล้างทันทีคุ้มค่ากว่า"
        body = (
            f"หากไม่ล้างวันนี้ ระบบจะสูญเสียรายได้รวม {projected_30d_thb:,.0f} THB ในอีก 30 วันข้างหน้า "
            f"ซึ่งสูงกว่าค่าล้าง {cleaning_cost:,.0f} THB การตัดสินใจล้างวันนี้จะช่วยรักษาผลประโยชน์สุทธิได้ +{net_saving:,.0f} THB"
        )
        return {
            "action": "RECOMMEND_DISPATCH",
            "color": "red",
            "title": title,
            "badge_text": "⚠️ ACTION REQUIRED",
            "net_saving_thb": round(net_saving, 2),
            "message": f"{title}\n{body}",
            "html_message": f"<strong>{title}</strong><br>{body}",
        }

    title = "ℹ️ MONITORING: ยังไม่จำเป็นต้องล้างวันนี้"
    body = (
        f"หากปล่อยทิ้งไว้ 30 วัน ความเสียหายสะสมอยู่ที่ {projected_30d_thb:,.0f} THB "
        f"ซึ่งยังน้อยกว่าค่าบริการล้าง {cleaning_cost:,.0f} THB แนะนำให้เฝ้าระวังต่อเพื่อไม่ให้เสียค่าใช้จ่ายโดยไม่จำเป็น"
    )
    net_benefit = projected_30d_thb - cleaning_cost
    return {
        "action": "NO_ACTION_MONITOR",
        "color": "green",
        "title": title,
        "badge_text": "ℹ️ MONITORING",
        "net_saving_thb": round(net_benefit, 2),
        "message": f"{title}\n{body}",
        "html_message": f"<strong>{title}</strong><br>{body}",
    }

