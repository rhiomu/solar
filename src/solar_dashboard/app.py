import asyncio
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from src.solar_dashboard.config import Settings, load_and_print_config
from src.solar_dashboard.api_client import SolarAPIClient
from src.solar_dashboard import financial, db
from src.solar_dashboard.sync_service import SolarSyncService

settings = load_and_print_config()
client = SolarAPIClient(settings)
sync_service = SolarSyncService(client)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and tables
    db.init_db(
        default_feed_in=settings.feed_in_tariff,
        default_grid_import=settings.grid_import_tariff,
        default_cleaning=settings.cleaning_cost,
    )
    # Start background synchronization worker
    sync_service.start_background_sync()
    yield
    sync_service.stop_background_sync()


app = FastAPI(
    title="Solar Fleet Operations & Monitoring Dashboard",
    version="1.1.0",
    lifespan=lifespan,
)


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        path = request.url.path
        if path.endswith((".js", ".css", ".html")) or path == "/" or path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


app.add_middleware(NoCacheMiddleware)


def _enrich_telemetry_item(item: Dict[str, Any]) -> Dict[str, Any]:
    pv = float(item.get("pv_power_kw", 0.0))
    load = float(item.get("load_power_kw", 0.0))
    exported = float(item.get("exported_kwh", 0.0))
    imported = float(item.get("imported_kwh", 0.0))
    if pv > load:
        flow = "Exported"
    elif pv < load:
        flow = "Imported"
    else:
        flow = "Balanced"
    enriched = dict(item)
    enriched["flow_status"] = flow
    enriched["net_flow_kw"] = round(pv - load, 2)
    enriched["exported_kwh"] = exported
    enriched["imported_kwh"] = imported
    return enriched


def _compute_fleet_summary(
    tel: List[Dict[str, Any]],
    sites: List[Dict[str, Any]],
    rows: List[Dict[str, Any]],
    feed_in_tariff: float,
    grid_import_tariff: float,
) -> Dict[str, Any]:
    total_capacity_mwp = round(sum(float(s.get("capacity_kwp", 0)) for s in sites) / 1000.0, 2)
    total_yield = sum(float(t.get("actual_yield_kwh", 0.0)) for t in tel)
    total_solar_self_consumed = sum(
        financial.self_consumed_kwh(float(t.get("actual_yield_kwh", 0.0)), float(t.get("exported_kwh", 0.0)))
        for t in tel
    )
    total_exported = sum(float(t.get("exported_kwh", 0.0)) for t in tel)

    # Financial value today: PV used on-site valued at grid import tariff,
    # exported energy valued at feed-in tariff. If actual yield is 0 (night-time), returns 0 THB.
    financial_value = 0.0
    for t in tel:
        actual = max(0.0, float(t.get("actual_yield_kwh", 0.0)))
        exported = max(0.0, float(t.get("exported_kwh", 0.0)))
        if actual <= 0.0:
            continue
        self_consumed = financial.self_consumed_kwh(actual, exported)
        financial_value += financial.site_financial_value(
            self_consumed, exported, grid_import_tariff, feed_in_tariff
        )

    # Revenue lost today from dust across all sites:
    # Based on real-time calculated daily loss when sunny (irradiance >= 150),
    # or fallback baseline from yesterday when dark.
    revenue_lost = sum(float(r.get("daily_loss_thb", 0.0)) for r in rows)

    return {
        "total_capacity_mwp": total_capacity_mwp,
        "total_yield_mwh": round(total_yield / 1000.0, 2),
        "total_consumed_mwh": round(total_solar_self_consumed / 1000.0, 2),
        "total_exported_mwh": round(total_exported / 1000.0, 2),
        "sites_count": len(tel),
        "today_financial_value_thb": round(max(0.0, financial_value), 2),
        "today_revenue_lost_thb": round(max(0.0, revenue_lost), 2),
    }


def _build_site_row(
    t: Dict[str, Any],
    history_record: Optional[Dict[str, Any]] = None,
    feed_in_tariff: float = 2.20,
    capacity_kwp: float = 0.0,
) -> Dict[str, Any]:
    row = _enrich_telemetry_item(t)
    live_act = max(0.0, float(t.get("actual_yield_kwh", 0.0)))
    live_exported = max(0.0, float(t.get("exported_kwh", 0.0)))
    self_consumed = financial.self_consumed_kwh(live_act, live_exported)

    irradiance_w_m2 = float(t.get("irradiance_w_m2", 0.0))
    pv_power_kw = float(t.get("pv_power_kw", 0.0))
    if capacity_kwp <= 0.0:
        capacity_kwp = float(t.get("capacity_kwp") or 0.0)
    if capacity_kwp <= 0.0:
        capacity_kwp = db.get_site_capacity_kwp(t.get("site_id", ""))

    # ดึงค่า Soiling Loss พื้นฐานจากสถิติรายวัน (Ground truth baseline)
    hist_soiling_loss = 0.0
    hist_daily_lost_thb = 0.0
    if history_record:
        exp_hist = float(history_record.get("expected_yield_kwh", 0.0))
        act_hist = float(history_record.get("actual_yield_kwh", 0.0))
        hist_soiling_loss = SolarAPIClient.calculate_soiling_loss(exp_hist, act_hist) if exp_hist > 0 else 0.0
        hist_daily_lost_thb = financial.revenue_lost_thb(exp_hist, act_hist, feed_in_tariff)

    # 7. Night Fallback Rule (ตามโจทย์: If Irradiance < 150 W/m²: ใช้ Loss% และ Lost THB ของเมื่อวาน)
    if irradiance_w_m2 >= 150.0 and capacity_kwp > 0.0:
        expected_pv_kw = capacity_kwp * (irradiance_w_m2 / 1000.0) * 0.95
        if expected_pv_kw > 0.0:
            instant_loss = max(0.0, ((expected_pv_kw - pv_power_kw) / expected_pv_kw) * 100.0)
        else:
            instant_loss = 0.0

        # ป้องกันค่าแกว่งจากเซนเซอร์ Noise ในช่วงแดดร่ม/ปลายวัน (< 350 W/m²):
        # ผสมผสานอย่างนุ่มนวลร่วมกับค่าประวัติรายวัน (Ground Truth) เพื่อไม่ให้ตัวเลขกระโดด
        if hist_soiling_loss > 0.0 and irradiance_w_m2 < 350.0:
            soiling_loss_pct = 0.80 * hist_soiling_loss + 0.20 * instant_loss
        elif hist_soiling_loss > 0.0:
            soiling_loss_pct = 0.50 * hist_soiling_loss + 0.50 * instant_loss
        else:
            soiling_loss_pct = instant_loss

        daily_lost_kwh = capacity_kwp * 4.5 * 0.95 * (soiling_loss_pct / 100.0)
        daily_lost_thb = daily_lost_kwh * feed_in_tariff
    else:
        soiling_loss_pct = hist_soiling_loss
        daily_lost_thb = hist_daily_lost_thb
        daily_lost_kwh = capacity_kwp * 4.5 * 0.95 * (soiling_loss_pct / 100.0)

    soiling_loss_pct = round(soiling_loss_pct, 2)
    status = SolarAPIClient.get_soiling_status(soiling_loss_pct)

    # Criteria:
    # Loss < 5%: 🟢 Normal (< 5%) (0 THB/day)
    # 5% <= Loss < 15%: 🟡 Warning (X%) (-Y THB/day)
    # Loss >= 15%: 🔴 Critical (X%) (-Y THB/day)
    if soiling_loss_pct < 5.0:
        display_daily_lost_thb = 0.0
    else:
        display_daily_lost_thb = round(daily_lost_thb, 2)

    row["expected_yield_kwh"] = round(float(history_record.get("expected_yield_kwh", 0.0)), 2) if history_record else 0.0
    row["yesterday_actual_yield_kwh"] = round(float(history_record.get("actual_yield_kwh", 0.0)), 2) if history_record else 0.0
    row["soiling_loss_pct"] = soiling_loss_pct
    row["self_consumed_kwh"] = round(self_consumed, 2)
    row["daily_loss_thb"] = display_daily_lost_thb
    row["raw_daily_loss_thb"] = round(daily_lost_thb, 2)
    row.update(status)
    return row


def _soiling_from_history(history: List[Dict[str, Any]]) -> float:
    total_exp = sum(float(r.get("expected_yield_kwh", 0.0)) for r in history)
    total_act = sum(float(r.get("actual_yield_kwh", 0.0)) for r in history)
    return SolarAPIClient.calculate_soiling_loss(total_exp, total_act)


# --- Public API Endpoints ---

@app.get("/api/snapshot")
async def get_snapshot() -> Dict[str, Any]:
    """Instant snapshot served directly from local SQLite database (zero 504 errors)."""
    sites = db.get_sites_cache()
    tel = db.get_all_telemetry_cache()
    latest_hist_map = db.get_latest_daily_records_fleet()

    # If local DB is completely empty (first boot before background sync finishes), sync now
    if not sites or not tel:
        await sync_service.sync_all()
        sites = db.get_sites_cache() or []
        tel = db.get_all_telemetry_cache()
        latest_hist_map = db.get_latest_daily_records_fleet()

    fleet_tariffs = db.get_fleet_settings(settings.feed_in_tariff, settings.grid_import_tariff)
    feed_in = fleet_tariffs["feed_in_tariff"]
    grid_import = fleet_tariffs["grid_import_tariff"]

    tel_map = {t["site_id"]: t for t in tel}
    history_last_1d = list(latest_hist_map.values())

    rows = []
    for s in sites:
        t = tel_map.get(s["site_id"])
        if not t:
            continue
        hist_rec = latest_hist_map.get(s["site_id"])
        cap = float(s.get("capacity_kwp") or 0.0)
        if cap <= 0:
            cap = db.get_site_capacity_kwp(s["site_id"])
        row = _build_site_row(t, hist_rec, feed_in_tariff=feed_in, capacity_kwp=cap)
        row["capacity_kwp"] = cap
        row["region"] = s.get("region")
        row["customer_type"] = s.get("customer_type")
        # Include customizable cleaning cost for each site
        row["cleaning_cost_thb"] = db.get_site_cleaning_cost(s["site_id"], settings.cleaning_cost)
        rows.append(row)

    summary = _compute_fleet_summary(tel, sites, rows, feed_in, grid_import)
    sync_status = db.get_sync_status()

    return {
        "group_id": settings.group_id,
        "summary": summary,
        "sites": rows,
        "history_last_1d": history_last_1d,
        "tariffs": {
            "grid_import": grid_import,
            "feed_in": feed_in,
            "cleaning_cost": settings.cleaning_cost,
        },
        "sync": sync_status,
    }


@app.get("/api/sites")
async def list_sites() -> List[Dict[str, Any]]:
    sites = db.get_sites_cache()
    if not sites:
        await sync_service.sync_all()
        sites = db.get_sites_cache() or []
    return sites


@app.get("/api/deepdive/{site_id}")
async def deep_dive(site_id: str) -> Dict[str, Any]:
    """Deep-dive for a single site, served instantly from local SQLite DB."""
    tel = db.get_site_telemetry_cache(site_id)
    hist_daily = db.get_history_daily_cache(days=7, site_id=site_id)
    hist_monthly = db.get_history_monthly_cache(months=12, site_id=site_id)

    # Fallback to direct client fetch only if DB lacks this site's records
    if not tel or not hist_daily or not hist_monthly:
        try:
            tel_f, daily_f, monthly_f = await asyncio.gather(
                client.get_site_telemetry(site_id),
                client.get_history_last_days(7, site_id),
                client.get_history_monthly(12, site_id),
            )
            if tel_f:
                db.save_telemetry_cache([tel_f])
                tel = tel_f
            if daily_f:
                db.save_history_daily_cache(daily_f)
                hist_daily = daily_f
            if monthly_f:
                db.save_history_monthly_cache(monthly_f)
                hist_monthly = monthly_f
        except Exception as exc:
            # If fetch fails, use whatever is in DB or raise graceful error
            if not tel:
                raise HTTPException(status_code=504, detail=f"Site {site_id} data not yet available in local store: {exc}")

    loss_7d = _soiling_from_history(hist_daily)
    status = SolarAPIClient.get_soiling_status(loss_7d)
    exp_sun = sum(float(r.get("sun_hours_h", 0.0)) for r in hist_daily) / 7.0 if hist_daily else 0.0
    act_sun = sum(float(r.get("sun_hours_h", 0.0)) for r in hist_daily) / 7.0 if hist_daily else 0.0
    exp_yield = sum(float(r.get("expected_yield_kwh", 0.0)) for r in hist_daily)
    act_yield = sum(float(r.get("actual_yield_kwh", 0.0)) for r in hist_daily)
    pr = round((act_yield / exp_yield) * 100.0, 1) if exp_yield > 0 else 0.0

    # Load active fleet tariffs and site-specific cleaning cost
    fleet_tariffs = db.get_fleet_settings(settings.feed_in_tariff, settings.grid_import_tariff)
    feed_in = fleet_tariffs["feed_in_tariff"]
    grid_import = fleet_tariffs["grid_import_tariff"]
    site_cleaning_cost = db.get_site_cleaning_cost(site_id, settings.cleaning_cost)

    # Compute effective tariff based on self-consumption vs export proportion
    # (ใช้ Tariff ซื้อ 4.50 หรือขาย 2.20 ตามสัดส่วน หรือใช้ฐาน 4.50 THB/kWh สำหรับไฟที่ใช้เอง)
    tel_act = float(tel.get("actual_yield_kwh", 0.0)) if tel else 0.0
    tel_exp = float(tel.get("exported_kwh", 0.0)) if tel else 0.0
    if tel_act > 0.0:
        self_c = max(0.0, tel_act - max(0.0, tel_exp))
        effective_tariff = (self_c / tel_act) * grid_import + (tel_exp / tel_act) * feed_in
    elif hist_daily:
        tot_act = sum(float(r.get("actual_yield_kwh", 0.0)) for r in hist_daily)
        tot_exp = sum(float(r.get("exported_kwh", 0.0)) for r in hist_daily)
        if tot_act > 0.0:
            self_c = max(0.0, tot_act - max(0.0, tot_exp))
            effective_tariff = (self_c / tot_act) * grid_import + (tot_exp / tot_act) * feed_in
        else:
            effective_tariff = grid_import
    else:
        effective_tariff = grid_import

    # Financial projection & AI cleaning ROI recommendation:
    # Uses real-time sensor calculation when sunny (irradiance >= 150),
    # or fallback to yesterday's completed day baseline when dark.
    irradiance_w_m2 = float(tel.get("irradiance_w_m2", 0.0)) if tel else 0.0
    pv_power_kw = float(tel.get("pv_power_kw", 0.0)) if tel else 0.0
    site_cap = db.get_site_capacity_kwp(site_id)

    latest_daily = max(hist_daily, key=lambda r: r.get("date", "")) if hist_daily else None
    if latest_daily:
        exp_h = float(latest_daily.get("expected_yield_kwh", 0.0))
        act_h = float(latest_daily.get("actual_yield_kwh", 0.0))
        yesterday_loss_pct = SolarAPIClient.calculate_soiling_loss(exp_h, act_h) if exp_h > 0 else 0.0
        yesterday_daily_thb = financial.revenue_lost_thb(exp_h, act_h, feed_in)
    else:
        yesterday_loss_pct = 0.0
        yesterday_daily_thb = 0.0

    loss_summary = financial.real_time_soiling_loss_summary(
        capacity_kwp=site_cap,
        irradiance_w_m2=irradiance_w_m2,
        pv_power_kw=pv_power_kw,
        yesterday_soiling_loss_pct=yesterday_loss_pct,
        yesterday_daily_lost_thb=yesterday_daily_thb,
        feed_in_tariff=feed_in,
        effective_tariff=effective_tariff,
    )
    recommendation = financial.dispatch_recommendation(
        loss_summary["projected_30d_thb"], site_cleaning_cost
    )

    current_soiling_loss_pct = loss_summary["soiling_loss_pct"]
    current_status = SolarAPIClient.get_soiling_status(current_soiling_loss_pct)

    financial_block = {
        "daily_loss_kwh": loss_summary["daily_loss_kwh"],
        "daily_loss_thb": loss_summary["daily_loss_thb"],
        "projected_7d_thb": loss_summary["projected_7d_thb"],
        "projected_30d_thb": loss_summary["projected_30d_thb"],
        "cleaning_cost_thb": site_cleaning_cost,
        "effective_tariff": round(effective_tariff, 2),
        "tariffs": {
            "grid_import": grid_import,
            "feed_in": feed_in,
            "effective_tariff": round(effective_tariff, 2),
        },
        "recommendation": recommendation,
    }

    return {
        "site_id": site_id,
        "telemetry": tel or {},
        "daily": hist_daily,
        "monthly": hist_monthly,
        "soiling_loss_7d_pct": loss_7d,
        "current_soiling_loss_pct": current_soiling_loss_pct,
        "soiling_status": current_status,
        "avg_expected_sun_hours": round(exp_sun, 2),
        "avg_actual_sun_hours": round(act_sun, 2),
        "pr_pct": pr,
        "financial": financial_block,
    }


@app.get("/api/history-daily")
async def get_history_daily(days: int = 7, site_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve historical daily records from local DB enriched with active feed-in tariff."""
    history = db.get_history_daily_cache(days=days, site_id=site_id)
    if not history:
        try:
            history = await client.get_history_last_days(days, site_id)
            if history:
                db.save_history_daily_cache(history)
        except Exception:
            history = []

    fleet_tariffs = db.get_fleet_settings(settings.feed_in_tariff, settings.grid_import_tariff)
    feed_in = fleet_tariffs["feed_in_tariff"]

    enriched = []
    for r in history:
        exp = float(r.get("expected_yield_kwh", 0.0))
        act = float(r.get("actual_yield_kwh", 0.0))
        loss = SolarAPIClient.calculate_soiling_loss(exp, act) if exp > 0 else 0.0
        status = SolarAPIClient.get_soiling_status(loss)
        daily_loss_thb = 0.0 if loss < 5.0 else financial.revenue_lost_thb(exp, act, feed_in)
        item = dict(r)
        item["soiling_loss_pct"] = loss
        item["daily_loss_thb"] = round(daily_loss_thb, 2)
        item.update(status)
        enriched.append(item)
    enriched.sort(key=lambda x: (x.get("date", ""), x.get("site_id", "")), reverse=True)
    return enriched


@app.get("/api/analytics-monthly")
@app.get("/api/history-monthly")
async def get_history_monthly(months: int = 12, site_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve historical monthly records from local DB enriched with active feed-in tariff."""
    history = db.get_history_monthly_cache(months=months, site_id=site_id)
    if not history:
        try:
            history = await client.get_history_monthly(months, site_id)
            if history:
                db.save_history_monthly_cache(history)
        except Exception:
            history = []

    fleet_tariffs = db.get_fleet_settings(settings.feed_in_tariff, settings.grid_import_tariff)
    feed_in = fleet_tariffs["feed_in_tariff"]

    enriched = []
    for r in history:
        exp = float(r.get("expected_yield_kwh", 0.0))
        act = float(r.get("actual_yield_kwh", 0.0))
        loss = SolarAPIClient.calculate_soiling_loss(exp, act) if exp > 0 else 0.0
        status = SolarAPIClient.get_soiling_status(loss)
        loss_thb = 0.0 if loss < 5.0 else financial.revenue_lost_thb(exp, act, feed_in)
        item = dict(r)
        item["soiling_loss_pct"] = loss
        item["daily_loss_thb"] = round(loss_thb, 2)
        item.update(status)
        enriched.append(item)
    enriched.sort(key=lambda x: (x.get("month", ""), x.get("site_id", "")), reverse=True)
    return enriched


# --- Settings & Configuration Endpoints ---

class TariffUpdateRequest(BaseModel):
    feed_in_tariff: float = Field(..., ge=0.0, le=100.0, description="Feed-in tariff in THB/kWh")
    grid_import_tariff: Optional[float] = Field(None, ge=0.0, le=100.0, description="Grid import tariff in THB/kWh")


class SiteCleaningCostRequest(BaseModel):
    cleaning_cost_thb: float = Field(..., ge=0.0, description="Cleaning cost in THB")
    notes: Optional[str] = ""


class BatchCleaningCostRequest(BaseModel):
    costs: Dict[str, float] = Field(..., description="Mapping of site_id to cleaning_cost_thb")


@app.get("/api/settings")
async def get_settings() -> Dict[str, Any]:
    """Retrieve current tariffs, all per-site cleaning costs, and sync status."""
    tariffs = db.get_fleet_settings(settings.feed_in_tariff, settings.grid_import_tariff)
    site_settings = db.get_all_site_settings()
    sync_meta = db.get_sync_status()
    return {
        "tariffs": tariffs,
        "site_settings": site_settings,
        "sync": sync_meta,
    }


@app.post("/api/settings/tariffs")
async def update_tariffs(req: TariffUpdateRequest) -> Dict[str, Any]:
    """Update feed-in tariff and optionally grid import tariff."""
    db.set_fleet_setting("feed_in_tariff", req.feed_in_tariff)
    if req.grid_import_tariff is not None:
        db.set_fleet_setting("grid_import_tariff", req.grid_import_tariff)
    updated = db.get_fleet_settings(settings.feed_in_tariff, settings.grid_import_tariff)
    return {"status": "ok", "message": "Tariffs updated successfully", "tariffs": updated}


@app.post("/api/settings/cleaning-cost/{site_id}")
async def update_site_cleaning_cost(site_id: str, req: SiteCleaningCostRequest) -> Dict[str, Any]:
    """Update cleaning dispatch cost for a specific site."""
    db.set_site_cleaning_cost(site_id, req.cleaning_cost_thb, notes=req.notes or "")
    new_cost = db.get_site_cleaning_cost(site_id)
    return {
        "status": "ok",
        "site_id": site_id,
        "cleaning_cost_thb": new_cost,
        "message": f"Cleaning cost for {site_id} set to {new_cost:,.0f} THB",
    }


@app.post("/api/settings/cleaning-costs")
async def update_batch_cleaning_costs(req: BatchCleaningCostRequest) -> Dict[str, Any]:
    """Batch update cleaning dispatch costs for multiple sites."""
    db.set_multiple_cleaning_costs(req.costs)
    return {
        "status": "ok",
        "message": f"Updated cleaning costs for {len(req.costs)} sites",
        "site_settings": db.get_all_site_settings(),
    }


@app.post("/api/sync")
async def trigger_sync() -> Dict[str, Any]:
    """Manually trigger background sync with remote Solar Mock API."""
    result = await sync_service.sync_all(force=True)
    return result


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "group_id": settings.group_id,
        "sync": db.get_sync_status(),
        "tariffs": db.get_fleet_settings(settings.feed_in_tariff, settings.grid_import_tariff),
    }


@app.get("/")
async def index():
    return FileResponse("static/index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")


app.mount("/", StaticFiles(directory="static"), name="static")
