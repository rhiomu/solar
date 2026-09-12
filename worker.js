/**
 * Cloudflare Worker Edge API & Static Asset Server
 * Solar Fleet Operations & Monitoring Dashboard
 */

const SITES_DATA = [
  { site_id: "SOLAR-BKK-01", site_name: "Bangkok Urban Factory Rooftop", region: "Bangkok", capacity_kwp: 620.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-RYG-02", site_name: "Rayong Industrial Park Plant", region: "Rayong", capacity_kwp: 650.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-CBI-03", site_name: "Chonburi Logistics Center", region: "Chonburi", capacity_kwp: 580.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-SPK-04", site_name: "Samut Prakan Cold Storage Hub", region: "Samut Prakan", capacity_kwp: 700.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-AYA-05", site_name: "Ayutthaya Stamping Plant", region: "Ayutthaya", capacity_kwp: 690.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-CNX-06", site_name: "Chiang Mai Data Center", region: "Chiang Mai", capacity_kwp: 560.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-KKC-07", site_name: "Khon Kaen Distribution Center", region: "Khon Kaen", capacity_kwp: 740.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-NMA-08", site_name: "Nakhon Ratchasima Factory", region: "Nakhon Ratchasima", capacity_kwp: 670.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-SGK-09", site_name: "Songkhla Port Facility", region: "Songkhla", capacity_kwp: 700.0, cleaning_cost_thb: 15000.0 },
  { site_id: "SOLAR-PTM-10", site_name: "Pathum Thani Tech Campus", region: "Pathum Thani", capacity_kwp: 550.0, cleaning_cost_thb: 15000.0 },
];

const state = {
  feedInTariff: 2.20,
  gridImportTariff: 4.50,
  cleaningCosts: {},
  telemetryCache: null,
  telemetryCacheTime: 0,
  historyCache: {},
  monthlyCache: {},
};

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function getSiteCapacity(siteId) {
  const s = SITES_DATA.find((x) => x.site_id === siteId);
  return s ? s.capacity_kwp : 600.0;
}

function getSiteCleaningCost(siteId) {
  if (state.cleaningCosts[siteId] !== undefined) return state.cleaningCosts[siteId];
  const s = SITES_DATA.find((x) => x.site_id === siteId);
  return s ? s.cleaning_cost_thb : 15000.0;
}

function getSoilingStatus(lossPct) {
  if (lossPct < 5.0) {
    return {
      level: "clean",
      label: "🟢 Normal (< 5%)",
      badge_class: "badge-clean",
      status_text: "NORMAL",
      advice: "Panel clean. No cleaning required.",
      roi: "Optimal",
    };
  }
  if (lossPct < 15.0) {
    return {
      level: "warning",
      label: `🟡 Warning (${lossPct.toFixed(1)}%)`,
      badge_class: "badge-warning",
      status_text: "WARNING",
      advice: "Moderate dust buildup. Schedule cleaning soon or wait for rain.",
      roi: "Medium",
    };
  }
  return {
    level: "critical",
    label: `🔴 Critical (${lossPct.toFixed(1)}%)`,
    badge_class: "badge-critical",
    status_text: "CRITICAL",
    advice: "Heavy soiling detected! Immediate team dispatch recommended.",
    roi: "High (Immediate Action)",
  };
}

function generateFallbackTelemetry() {
  return SITES_DATA.map((s, idx) => {
    const irr = 720 + (idx % 5) * 50;
    const expKw = s.capacity_kwp * (irr / 1000) * 0.95;
    const lossPct = (idx === 6) ? 18.2 : (idx === 5) ? 14.5 : (idx === 0) ? 8.4 : 1.5;
    const pv = expKw * (1 - lossPct / 100);
    const yld = Math.round(pv * 2.8 * 100) / 100;
    return {
      site_id: s.site_id,
      site_name: s.site_name,
      timestamp: new Date().toISOString(),
      irradiance_w_m2: irr,
      sun_hours_h: 2.3,
      panel_temp_c: 47.5,
      pv_power_kw: Math.round(pv * 100) / 100,
      load_power_kw: Math.round(pv * 0.75 * 100) / 100,
      actual_yield_kwh: yld,
      consumed_kwh: yld,
      exported_kwh: 0.0,
      imported_kwh: Math.round(yld * 0.4 * 100) / 100,
    };
  });
}

function generateFallbackDaily(days, siteId) {
  const list = [];
  const targetSites = siteId ? SITES_DATA.filter(s => s.site_id === siteId) : SITES_DATA;
  for (const s of targetSites) {
    for (let i = days; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const exp = Math.round(s.capacity_kwp * 4.5 * 0.95 * 100) / 100;
      const act = Math.round(exp * 0.92 * 100) / 100;
      list.push({
        date: dateStr,
        site_id: s.site_id,
        site_name: s.site_name,
        region: s.region,
        weather_condition: "clear",
        avg_irradiance_w_m2: 680.0,
        avg_panel_temp_c: 46.0,
        sun_hours_h: 4.5,
        expected_yield_kwh: exp,
        actual_yield_kwh: act,
        consumed_kwh: act,
        exported_kwh: 0.0,
        imported_kwh: Math.round(act * 0.5 * 100) / 100,
      });
    }
  }
  return list;
}

function generateFallbackMonthly(months, siteId) {
  const list = [];
  const targetSites = siteId ? SITES_DATA.filter(s => s.site_id === siteId) : SITES_DATA;
  for (const s of targetSites) {
    for (let i = months; i >= 1; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mStr = d.toISOString().substring(0, 7);
      const exp = Math.round(s.capacity_kwp * 4.5 * 0.95 * 30 * 100) / 100;
      const act = Math.round(exp * 0.93 * 100) / 100;
      list.push({
        month: mStr,
        site_id: s.site_id,
        site_name: s.site_name,
        region: s.region,
        days_in_month: 30,
        avg_irradiance_w_m2: 670.0,
        sun_hours_h: 4.4,
        expected_yield_kwh: exp,
        actual_yield_kwh: act,
        consumed_kwh: act,
        exported_kwh: 0.0,
      });
    }
  }
  return list;
}

async function fetchUpstream(path, env) {
  const baseUrl = (env.SOLAR_API_BASE_URL || "https://solar-test-api.onrender.com").replace(/\/+$/, "");
  const apiKey = env.SOLAR_API_KEY || "group201-key-2026";
  const url = `${baseUrl}${path}`;
  const resp = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) {
    throw new Error(`Upstream API returned ${resp.status} for ${path}`);
  }
  return resp.json();
}

async function getTelemetry(env) {
  const now = Date.now();
  if (state.telemetryCache && now - state.telemetryCacheTime < 25000) {
    return state.telemetryCache;
  }
  const groupId = env.GROUP_ID || "g1";
  try {
    const data = await fetchUpstream(`/api/v1/${groupId}/telemetry`, env);
    if (Array.isArray(data) && data.length > 0) {
      state.telemetryCache = data;
      state.telemetryCacheTime = now;
      return data;
    }
  } catch (err) {
    console.warn("Upstream telemetry fetch failed, using fallback:", err.message);
  }
  if (!state.telemetryCache) {
    state.telemetryCache = generateFallbackTelemetry();
    state.telemetryCacheTime = now;
  }
  return state.telemetryCache;
}

async function getHistoryDaily(days, siteId, env) {
  const key = `${days}_${siteId || "all"}`;
  const now = Date.now();
  if (state.historyCache[key] && now - (state.historyCache[key].time || 0) < 60000) {
    return state.historyCache[key].data;
  }
  const groupId = env.GROUP_ID || "g1";
  const p = siteId
    ? `/api/v1/${groupId}/history/last/${days}/${siteId}`
    : `/api/v1/${groupId}/history/last/${days}`;
  try {
    const data = await fetchUpstream(p, env);
    if (Array.isArray(data) && data.length > 0) {
      state.historyCache[key] = { data, time: now };
      return data;
    }
  } catch (err) {
    console.warn("Upstream history-daily fetch failed, using fallback:", err.message);
  }
  const fallback = generateFallbackDaily(days, siteId);
  state.historyCache[key] = { data: fallback, time: now };
  return fallback;
}

async function getHistoryMonthly(months, siteId, env) {
  const key = `${months}_${siteId || "all"}`;
  const now = Date.now();
  if (state.monthlyCache[key] && now - (state.monthlyCache[key].time || 0) < 300000) {
    return state.monthlyCache[key].data;
  }
  const groupId = env.GROUP_ID || "g1";
  const p = siteId
    ? `/api/v1/${groupId}/history/monthly/${months}/${siteId}`
    : `/api/v1/${groupId}/history/monthly/${months}`;
  try {
    const data = await fetchUpstream(p, env);
    if (Array.isArray(data) && data.length > 0) {
      state.monthlyCache[key] = { data, time: now };
      return data;
    }
  } catch (err) {
    console.warn("Upstream history-monthly fetch failed, using fallback:", err.message);
  }
  const fallback = generateFallbackMonthly(months, siteId);
  state.monthlyCache[key] = { data: fallback, time: now };
  return fallback;
}

function buildSiteRow(t, yesterdayRecord, feedInTariff) {
  const siteId = t.site_id;
  const capacityKwp = getSiteCapacity(siteId);
  const irr = Number(t.irradiance_w_m2 || 0);
  const pv = Number(t.pv_power_kw || 0);
  const actYield = Number(t.actual_yield_kwh || 0);
  const exported = Number(t.exported_kwh || 0);
  const selfConsumed = Math.max(0, actYield - exported);

  let soilingLossPct = 0;
  let dailyLostKwh = 0;
  let dailyLostThb = 0;

  if (irr >= 150.0 && capacityKwp > 0) {
    const expectedPvKw = capacityKwp * (irr / 1000.0) * 0.95;
    soilingLossPct = expectedPvKw > 0 ? Math.max(0.0, ((expectedPvKw - pv) / expectedPvKw) * 100.0) : 0;
    dailyLostKwh = capacityKwp * 4.5 * 0.95 * (soilingLossPct / 100.0);
    dailyLostThb = dailyLostKwh * feedInTariff;
  } else {
    if (yesterdayRecord) {
      const expHist = Number(yesterdayRecord.expected_yield_kwh || 0);
      const actHist = Number(yesterdayRecord.actual_yield_kwh || 0);
      soilingLossPct = expHist > 0 ? Math.max(0.0, ((expHist - actHist) / expHist) * 100.0) : 0;
      dailyLostKwh = Math.max(0, expHist - actHist);
      dailyLostThb = dailyLostKwh * feedInTariff;
    }
  }

  soilingLossPct = Math.round(soilingLossPct * 10) / 10;
  dailyLostThb = Math.round(dailyLostThb * 100) / 100;
  dailyLostKwh = Math.round(dailyLostKwh * 100) / 100;
  const status = getSoilingStatus(soilingLossPct);

  let statusLabel = status.label;
  if (soilingLossPct < 5.0) {
    statusLabel = "🟢 Normal (< 5%)";
  } else if (soilingLossPct < 15.0) {
    statusLabel = `🟡 Warning (${soilingLossPct.toFixed(1)}%) (-${fmt(dailyLostThb)} THB/day)`;
  } else {
    statusLabel = `🔴 Critical (${soilingLossPct.toFixed(1)}%) (-${fmt(dailyLostThb)} THB/day)`;
  }

  const load = Number(t.load_power_kw || 0);
  let flowStatus = "Balanced";
  if (pv > load) flowStatus = "Exported";
  else if (pv < load) flowStatus = "Imported";

  return {
    ...t,
    flow_status: flowStatus,
    net_flow_kw: Math.round((pv - load) * 100) / 100,
    capacity_kwp: capacityKwp,
    self_consumed_kwh: Math.round(selfConsumed * 100) / 100,
    estimated_soiling_loss_pct: soilingLossPct,
    soiling_loss_pct: soilingLossPct,
    daily_loss_kwh: dailyLostKwh,
    daily_loss_thb: dailyLostThb,
    soiling_status_label: statusLabel,
    soiling_status: status,
  };
}

function computeAdvisor(projected30d, cleaningCost) {
  if (projected30d > cleaningCost) {
    const netSaving = projected30d - cleaningCost;
    const title = "⚠️ ACTION REQUIRED: สั่งล้างทันทีคุ้มค่ากว่า";
    const body = `หากไม่ล้างวันนี้ ระบบจะสูญเสียรายได้รวม ${fmt(projected30d)} THB ในอีก 30 วันข้างหน้า ซึ่งสูงกว่าค่าล้าง ${fmt(cleaningCost)} THB การตัดสินใจล้างวันนี้จะช่วยรักษาผลประโยชน์สุทธิได้ +${fmt(netSaving)} THB`;
    return {
      action: "RECOMMEND_DISPATCH",
      color: "red",
      title,
      badge_text: "⚠️ ACTION REQUIRED",
      net_saving_thb: Math.round(netSaving * 100) / 100,
      message: `${title}\n${body}`,
      html_message: `<strong>${title}</strong><br>${body}`,
    };
  }
  const title = "ℹ️ MONITORING: ยังไม่จำเป็นต้องล้างวันนี้";
  const body = `หากปล่อยทิ้งไว้ 30 วัน ความเสียหายสะสมอยู่ที่ ${fmt(projected30d)} THB ซึ่งยังน้อยกว่าค่าบริการล้าง ${fmt(cleaningCost)} THB แนะนำให้เฝ้าระวังต่อเพื่อไม่ให้เสียค่าใช้จ่ายโดยไม่จำเป็น`;
  const netBenefit = projected30d - cleaningCost;
  return {
    action: "NO_ACTION_MONITOR",
    color: "green",
    title,
    badge_text: "ℹ️ MONITORING",
    net_saving_thb: Math.round(netBenefit * 100) / 100,
    message: `${title}\n${body}`,
    html_message: `<strong>${title}</strong><br>${body}`,
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Forward to BACKEND_URL if set by user
    if (url.pathname.startsWith("/api/") && env.BACKEND_URL) {
      const backendBase = env.BACKEND_URL.replace(/\/+$/, "");
      const targetUrl = new URL(url.pathname + url.search, backendBase);
      const modifiedRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "follow",
      });
      return fetch(modifiedRequest);
    }

    // 2. Built-in Edge API Implementation
    if (url.pathname.startsWith("/api/")) {
      const path = url.pathname.replace(/^\/api\/?/, "");

      // GET /api/settings
      if (path === "settings" && request.method === "GET") {
        const siteSettings = SITES_DATA.map((s) => ({
          site_id: s.site_id,
          site_name: s.site_name,
          region: s.region,
          cleaning_cost_thb: getSiteCleaningCost(s.site_id),
          capacity_kwp: s.capacity_kwp,
        }));
        return jsonResponse({
          tariffs: {
            grid_import: state.gridImportTariff,
            grid_import_tariff: state.gridImportTariff,
            feed_in: state.feedInTariff,
            feed_in_tariff: state.feedInTariff,
            cleaning_cost: 15000.0,
          },
          site_settings: siteSettings,
          sync: {
            status: "success",
            last_sync: new Date().toISOString(),
          },
        });
      }

      // POST /api/settings/tariffs
      if (path === "settings/tariffs" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (body.feed_in_tariff !== undefined) {
          state.feedInTariff = Number(body.feed_in_tariff);
        }
        return jsonResponse({
          feed_in: state.feedInTariff,
          feed_in_tariff: state.feedInTariff,
          grid_import: state.gridImportTariff,
          grid_import_tariff: state.gridImportTariff,
          updated_at: new Date().toISOString(),
        });
      }

      // POST /api/settings/cleaning-cost/:site_id
      if (path.startsWith("settings/cleaning-cost/") && request.method === "POST") {
        const siteId = decodeURIComponent(path.replace("settings/cleaning-cost/", ""));
        const body = await request.json().catch(() => ({}));
        if (body.cleaning_cost_thb !== undefined) {
          state.cleaningCosts[siteId] = Number(body.cleaning_cost_thb);
        }
        return jsonResponse({
          site_id: siteId,
          cleaning_cost_thb: getSiteCleaningCost(siteId),
          updated_at: new Date().toISOString(),
        });
      }

      // POST /api/settings/cleaning-costs
      if (path === "settings/cleaning-costs" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const costs = body.costs || {};
        let count = 0;
        for (const [k, v] of Object.entries(costs)) {
          state.cleaningCosts[k] = Number(v);
          count++;
        }
        return jsonResponse({ status: "success", updated_count: count });
      }

      // POST /api/sync
      if (path === "sync" && request.method === "POST") {
        state.telemetryCache = null;
        state.historyCache = {};
        const tel = await getTelemetry(env);
        return jsonResponse({ status: "success", count: tel.length, timestamp: new Date().toISOString() });
      }

      // GET /api/snapshot
      if (path === "snapshot" && request.method === "GET") {
        const [tel, histDaily] = await Promise.all([
          getTelemetry(env),
          getHistoryDaily(1, null, env),
        ]);

        const histMap = {};
        for (const h of histDaily) {
          histMap[h.site_id] = h;
        }

        let totalYield = 0;
        let totalConsumed = 0;
        let totalExported = 0;
        let totalCapKwp = 0;
        let financialVal = 0;
        let totalLostThb = 0;

        const siteRows = tel.map((t) => {
          const row = buildSiteRow(t, histMap[t.site_id], state.feedInTariff);
          totalCapKwp += row.capacity_kwp;
          totalYield += Number(t.actual_yield_kwh || 0);
          totalConsumed += row.self_consumed_kwh;
          totalExported += Number(t.exported_kwh || 0);
          financialVal += row.self_consumed_kwh * state.gridImportTariff + Number(t.exported_kwh || 0) * state.feedInTariff;
          totalLostThb += row.daily_loss_thb;
          return row;
        });

        const summaryObj = {
          total_capacity_mwp: Math.round((totalCapKwp / 1000.0) * 100) / 100,
          total_yield_mwh: Math.round((totalYield / 1000.0) * 100) / 100,
          total_consumed_mwh: Math.round((totalConsumed / 1000.0) * 100) / 100,
          total_exported_mwh: Math.round((totalExported / 1000.0) * 100) / 100,
          sites_count: siteRows.length,
          today_financial_value_thb: Math.round(financialVal * 100) / 100,
          today_revenue_lost_thb: Math.round(totalLostThb * 100) / 100,
        };

        return jsonResponse({
          summary: summaryObj,
          fleet_summary: summaryObj,
          sites: siteRows,
          tariffs: {
            grid_import: state.gridImportTariff,
            grid_import_tariff: state.gridImportTariff,
            feed_in: state.feedInTariff,
            feed_in_tariff: state.feedInTariff,
            cleaning_cost: 15000.0,
          },
          sync: {
            status: "success",
            last_sync: new Date().toISOString(),
          },
        });
      }

      // GET /api/deepdive/:site_id
      if (path.startsWith("deepdive/") && request.method === "GET") {
        const siteId = decodeURIComponent(path.replace("deepdive/", ""));
        const [telAll, histDaily, histMonthly] = await Promise.all([
          getTelemetry(env),
          getHistoryDaily(7, siteId, env),
          getHistoryMonthly(12, siteId, env),
        ]);

        const tel = telAll.find((x) => x.site_id === siteId) || {};
        const siteCap = getSiteCapacity(siteId);
        const siteCleaningCost = getSiteCleaningCost(siteId);

        const expYield = histDaily.reduce((acc, r) => acc + Number(r.expected_yield_kwh || 0), 0);
        const actYield = histDaily.reduce((acc, r) => acc + Number(r.actual_yield_kwh || 0), 0);
        const loss7d = expYield > 0 ? Math.max(0.0, ((expYield - actYield) / expYield) * 100.0) : 0;
        const expSun = histDaily.length > 0 ? histDaily.reduce((acc, r) => acc + Number(r.sun_hours_h || 0), 0) / histDaily.length : 0;
        const actSun = histDaily.length > 0 ? histDaily.reduce((acc, r) => acc + Number(r.sun_hours_h || 0), 0) / histDaily.length : 0;
        const pr = expYield > 0 ? Math.round((actYield / expYield) * 1000) / 10 : 0;

        // Effective tariff
        const telAct = Number(tel.actual_yield_kwh || 0);
        const telExp = Number(tel.exported_kwh || 0);
        let effectiveTariff = state.gridImportTariff;
        if (telAct > 0) {
          const selfC = Math.max(0, telAct - telExp);
          effectiveTariff = (selfC / telAct) * state.gridImportTariff + (telExp / telAct) * state.feedInTariff;
        }

        const irr = Number(tel.irradiance_w_m2 || 0);
        const pv = Number(tel.pv_power_kw || 0);
        let currentLossPct = 0;
        let dailyLostKwh = 0;
        let dailyLostThb = 0;

        if (irr >= 150.0 && siteCap > 0) {
          const expectedPvKw = siteCap * (irr / 1000.0) * 0.95;
          currentLossPct = expectedPvKw > 0 ? Math.max(0.0, ((expectedPvKw - pv) / expectedPvKw) * 100.0) : 0;
          dailyLostKwh = siteCap * 4.5 * 0.95 * (currentLossPct / 100.0);
          dailyLostThb = dailyLostKwh * effectiveTariff;
        } else {
          const latestDaily = histDaily.length > 0 ? histDaily[histDaily.length - 1] : null;
          if (latestDaily) {
            const expHist = Number(latestDaily.expected_yield_kwh || 0);
            const actHist = Number(latestDaily.actual_yield_kwh || 0);
            currentLossPct = expHist > 0 ? Math.max(0.0, ((expHist - actHist) / expHist) * 100.0) : 0;
          }
          dailyLostKwh = siteCap * 4.5 * 0.95 * (currentLossPct / 100.0);
          dailyLostThb = dailyLostKwh * effectiveTariff;
        }

        currentLossPct = Math.round(currentLossPct * 10) / 10;
        dailyLostThb = Math.round(dailyLostThb * 100) / 100;
        dailyLostKwh = Math.round(dailyLostKwh * 100) / 100;

        const projected7d = Math.round(dailyLostThb * 7 * 100) / 100;
        const projected30d = Math.round(dailyLostThb * 30 * 100) / 100;
        const status = getSoilingStatus(currentLossPct);
        const recommendation = computeAdvisor(projected30d, siteCleaningCost);

        return jsonResponse({
          site_id: siteId,
          telemetry: tel,
          daily: histDaily,
          monthly: histMonthly,
          soiling_loss_7d_pct: Math.round(loss7d * 10) / 10,
          current_soiling_loss_pct: currentLossPct,
          soiling_status: status,
          avg_expected_sun_hours: Math.round(expSun * 100) / 100,
          avg_actual_sun_hours: Math.round(actSun * 100) / 100,
          pr_pct: pr,
          financial: {
            daily_loss_kwh: dailyLostKwh,
            daily_loss_thb: dailyLostThb,
            projected_7d_thb: projected7d,
            projected_30d_thb: projected30d,
            cleaning_cost_thb: siteCleaningCost,
            effective_tariff: Math.round(effectiveTariff * 100) / 100,
            tariffs: {
              grid_import: state.gridImportTariff,
              feed_in: state.feedInTariff,
              effective_tariff: Math.round(effectiveTariff * 100) / 100,
            },
            recommendation,
          },
        });
      }

      // GET /api/history-daily?days=X&site_id=Y
      if (path.startsWith("history-daily") && request.method === "GET") {
        const days = parseInt(url.searchParams.get("days") || "7", 10);
        const siteId = url.searchParams.get("site_id") || null;
        const history = await getHistoryDaily(days, siteId, env);
        const enriched = history.map((r) => {
          const exp = Number(r.expected_yield_kwh || 0);
          const act = Number(r.actual_yield_kwh || 0);
          const loss = exp > 0 ? Math.max(0.0, ((exp - act) / exp) * 100.0) : 0;
          const lostThb = Math.max(0.0, exp - act) * state.feedInTariff;
          return {
            ...r,
            soiling_loss_pct: Math.round(loss * 10) / 10,
            revenue_lost_thb: Math.round(lostThb * 100) / 100,
          };
        });
        return jsonResponse(enriched);
      }

      // GET /api/history-monthly?months=X&site_id=Y
      if (path.startsWith("history-monthly") && request.method === "GET") {
        const months = parseInt(url.searchParams.get("months") || "12", 10);
        const siteId = url.searchParams.get("site_id") || null;
        const history = await getHistoryMonthly(months, siteId, env);
        const enriched = history.map((r) => {
          const exp = Number(r.expected_yield_kwh || 0);
          const act = Number(r.actual_yield_kwh || 0);
          const loss = exp > 0 ? Math.max(0.0, ((exp - act) / exp) * 100.0) : 0;
          const lostThb = Math.max(0.0, exp - act) * state.feedInTariff;
          return {
            ...r,
            soiling_loss_pct: Math.round(loss * 10) / 10,
            revenue_lost_thb: Math.round(lostThb * 100) / 100,
          };
        });
        return jsonResponse(enriched);
      }

      // GET /api/analytics-monthly
      if (path.startsWith("analytics-monthly") && request.method === "GET") {
        const history = await getHistoryMonthly(12, null, env);
        return jsonResponse(history);
      }

      return jsonResponse({ error: "Endpoint not found" }, 404);
    }

    // 3. Serve static frontend assets from ./static (HTML, CSS, JS)
    return env.ASSETS.fetch(request);
  },
};
