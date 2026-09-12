/* Solar Fleet Operations & Monitoring Dashboard - Frontend Logic */

const state = {
  sites: [],
  currentSiteId: null,
  currentView: "fleet",
  autoRefresh: true,
  refreshTimer: null,
  refreshInterval: 30,
  charts: {},
  tariffs: { feed_in_tariff: 2.20, grid_import_tariff: 4.50 },
  siteSettings: [],
  syncStatus: { status: "idle", message: "" },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const fmt = (v, d = 1) => (v == null || isNaN(v) ? "\u2014" : Number(v).toFixed(d));
const fmtInt = (v) => (v == null || isNaN(v) ? "\u2014" : Math.round(v).toLocaleString());
const fmtTHB = (v) => (v == null || isNaN(v) ? "\u2014" : Math.round(v).toLocaleString());

function setOnline(online) {
  const badge = $("#connectionBadge");
  badge.textContent = online ? "ONLINE" : "OFFLINE";
  badge.classList.toggle("offline", !online);
  const setConn = $("#setConn");
  if (setConn) setConn.textContent = online ? "Connected" : "Unreachable";
}

function setLastUpdated() {
  const el = $("#lastUpdated");
  if (el) el.textContent = "Last updated: " + new Date().toLocaleTimeString();
}

/* ---------- API (relative paths only) ---------- */
async function api(path, options) {
  const resp = await fetch("api/" + path, options);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || ("HTTP " + resp.status));
  }
  return resp.json();
}

/* ---------- Fleet Overview ---------- */
function soilingBadge(loss) {
  if (loss < 5) return { cls: "badge-clean", text: "🟢 Normal (< 5%)", row: "" };
  if (loss < 15) return { cls: "badge-warning", text: "🟡 Warning (" + fmt(loss, 1) + "%)", row: "row-warning" };
  return { cls: "badge-critical", text: "🔴 Critical (" + fmt(loss, 1) + "%)", row: "row-critical" };
}

function flowBadge(flow) {
  if (flow === "Exported") return '<span class="badge badge-exported">\u26A1 Exported</span>';
  if (flow === "Balanced") return '<span class="badge badge-balanced">= Balanced</span>';
  return '<span class="badge badge-imported">\u26A1 Imported</span>';
}

function renderFleet(data) {
  const s = data.summary || data.fleet_summary || {};
  $("#mCapacity").textContent = fmt(s.total_capacity_mwp || 0, 2) + " MWp";
  $("#mYield").textContent = fmt(s.total_yield_mwh || 0, 2) + " MWh";
  $("#mConsumed").textContent = fmt(s.total_consumed_mwh || 0, 2) + " MWh";
  $("#mExported").textContent = fmt(s.total_exported_mwh || 0, 2) + " MWh";
  const finValue = Math.max(0, s.today_financial_value_thb || 0);
  $("#mFinValue").textContent = fmtTHB(finValue) + " THB";
  const lostVal = Math.max(0, s.today_revenue_lost_thb || 0);
  $("#mRevLost").textContent = fmtTHB(lostVal) + " THB";
  $("#mRevLost").classList.toggle("is-zero", lostVal <= 0);
  $("#fleetSiteCount").textContent = s.sites_count || (data.sites ? data.sites.length : 0);

  if (data.tariffs) {
    state.tariffs = data.tariffs;
    const fit = data.tariffs.feed_in_tariff !== undefined ? data.tariffs.feed_in_tariff : data.tariffs.feed_in;
    const inputTariff = $("#inputFeedInTariff");
    if (inputTariff && document.activeElement !== inputTariff && !isNaN(Number(fit))) {
      inputTariff.value = Number(fit).toFixed(2);
    }
    const revLostSub = $("#mRevLostSub");
    if (revLostSub && !isNaN(Number(fit))) {
      revLostSub.textContent = "(Real-time sensor estimation & 4.5 PSH at " + Number(fit).toFixed(2) + " THB/kWh)";
    }
  }

  if (data.sync) {
    updateSyncBadge(data.sync);
  }

  const tbody = $("#fleetTableBody");
  tbody.innerHTML = "";
  for (const site of data.sites) {
    const act = site.actual_yield_kwh || 0;
    const loss = site.soiling_loss_pct != null ? site.soiling_loss_pct : 0;
    const dailyLoss = site.daily_loss_thb || 0;
    const badge = soilingBadge(loss);
    const lossDisplay = (loss < 5 || dailyLoss <= 0)
      ? "(0 THB/day)"
      : "(\u2212" + fmtInt(dailyLoss) + " THB/day)";

    const tr = document.createElement("tr");
    tr.className = badge.row;
    tr.innerHTML =
      '<td class="site-id-cell">' + site.site_id + "</td>" +
      "<td>" + site.site_name + "</td>" +
      '<td>' + (site.irradiance_w_m2 > 0 ? "\u2600\uFE0F " : "") + fmtInt(site.irradiance_w_m2) + "</td>" +
      "<td>" + fmt(site.pv_power_kw, 1) + " kW</td>" +
      "<td>" + fmt(site.load_power_kw, 1) + " kW</td>" +
      "<td>" + flowBadge(site.flow_status) + "</td>" +
      "<td>" + fmtInt(act) + "</td>" +
      "<td>" + fmtInt(site.consumed_kwh) + "</td>" +
      "<td>" + fmt(site.sun_hours_h, 2) + " h</td>" +
      '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span> " +
      '<span class="daily-loss">' + lossDisplay + "</span></td>";
    tr.addEventListener("click", () => openDeepDive(site.site_id));
    tbody.appendChild(tr);
  }
}


async function refreshFleet() {
  try {
    const data = await api("snapshot");
    state.sites = data.sites;
    renderFleet(data);
    populateSiteFilter();
    setOnline(true);

    setLastUpdated();
    if (state.currentView === "settings") {
      $("#setGroupId").textContent = data.group_id;
    }
  } catch (err) {
    setOnline(false);
    console.error("Fleet refresh failed:", err);
  }
}

/* ---------- Deep-Dive ---------- */
function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    state.charts[key] = null;
  }
}

function renderPowerFlowChart(tel) {
  destroyChart("power");
  const ctx = document.getElementById("powerFlowChart").getContext("2d");
  const pv = Number(tel.pv_power_kw || 0);
  const load = Number(tel.load_power_kw || 0);
  const net = Math.abs(pv - load);
  const exported = pv > load;

  const nightBadge = $("#powerFlowNightBadge");
  if (nightBadge) {
    nightBadge.classList.toggle("hidden", pv > 0);
  }

  state.charts.power = new Chart(ctx, {

    type: "bar",
    data: {
      labels: ["PV Generation", "Load Demand", "Net " + (exported ? "Export" : "Import")],
      datasets: [
        {
          label: "Power (kW)",
          data: [pv, load, net],
          backgroundColor: [
            "rgba(34,197,94,0.85)",
            "rgba(59,130,246,0.85)",
            exported ? "rgba(20,184,166,0.85)" : "rgba(107,114,128,0.85)",
          ],
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "Power (kW)" } } },
    },
  });
}

function renderCumEnergyChart(daily) {
  destroyChart("cum");
  const labels = daily.map((d) => d.date.slice(5));
  const expCum = [];
  const actCum = [];
  let ce = 0, ca = 0;
  for (const d of daily) {
    ce += d.expected_yield_kwh;
    ca += d.actual_yield_kwh;
    expCum.push(+ce.toFixed(1));
    actCum.push(+ca.toFixed(1));
  }
  const ctx = document.getElementById("cumEnergyChart").getContext("2d");
  state.charts.cum = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Expected Yield (kWh)",
          data: expCum,
          borderColor: "#9ca3af",
          backgroundColor: "rgba(156,163,175,0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
        {
          label: "Actual Yield (kWh)",
          data: actCum,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.18)",
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "Cumulative kWh" } } },
    },
  });
}

function renderMonthlyChart(monthly) {
  destroyChart("monthly");
  const labels = monthly.map((m) => m.month);
  const ctx = document.getElementById("monthlyChart").getContext("2d");
  state.charts.monthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Expected (kWh)",
          data: monthly.map((m) => +m.expected_yield_kwh.toFixed(0)),
          backgroundColor: "rgba(156,163,175,0.55)",
          borderRadius: 4,
        },
        {
          label: "Actual (kWh)",
          data: monthly.map((m) => +m.actual_yield_kwh.toFixed(0)),
          backgroundColor: "rgba(34,197,94,0.8)",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "Energy (kWh)" } } },
    },
  });
}

function renderFleetMonthlyChart(monthly) {
  destroyChart("fleetMonthly");
  const byMonth = {};
  for (const m of monthly) {
    if (!byMonth[m.month]) byMonth[m.month] = { exp: 0, act: 0 };
    byMonth[m.month].exp += m.expected_yield_kwh;
    byMonth[m.month].act += m.actual_yield_kwh;
  }
  const months = Object.keys(byMonth).sort();
  const ctx = document.getElementById("fleetMonthlyChart").getContext("2d");
  state.charts.fleetMonthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "Expected (kWh)",
          data: months.map((m) => +byMonth[m].exp.toFixed(0)),
          backgroundColor: "rgba(156,163,175,0.55)",
          borderRadius: 4,
        },
        {
          label: "Actual (kWh)",
          data: months.map((m) => +byMonth[m].act.toFixed(0)),
          backgroundColor: "rgba(37,99,235,0.8)",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true, title: { display: true, text: "Fleet Energy (kWh)" } } },
    },
  });
}

function renderGauge(loss, status) {
  destroyChart("gauge");
  const ctx = document.getElementById("soilingGauge").getContext("2d");
  const color =
    status.level === "clean" ? "#22c55e" : status.level === "warning" ? "#f59e0b" : "#dc2626";
  state.charts.gauge = new Chart(ctx, {
    type: "doughnut",
    data: {
      datasets: [
        {
          data: [Math.min(loss, 100), Math.max(100 - loss, 0)],
          backgroundColor: [color, "#e5e7eb"],
          borderWidth: 0,
          circumference: 270,
          rotation: 225,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "72%",
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
  $("#gaugeValue").textContent = fmt(loss, 1) + "%";
  const chip = $("#gaugeStatus");
  chip.textContent = status.status_text;
  chip.style.color = color;
}

function statusChip(status) {
  const el = $("#ddStatusChip");
  el.textContent = status.status_text;
  el.className = "status-chip " + status.level;
}

function renderAdvisor(fin) {
  if (!fin) return;
  const rec = fin.recommendation || {};
  const loss7d = Number(fin.projected_7d_thb || 0);
  const loss30d = Number(fin.projected_30d_thb || 0);
  const cleaningCost = Number(fin.cleaning_cost_thb || 15000);
  const netBenefit = loss30d - cleaningCost;

  $("#adv7d").textContent = fmtTHB(loss7d) + " THB";
  $("#adv30d").textContent = fmtTHB(loss30d) + " THB";
  $("#advCost").textContent = fmtTHB(cleaningCost) + " THB";
  const inpSiteCost = $("#inputSiteCleaningCost");
  if (inpSiteCost) inpSiteCost.value = Math.round(cleaningCost);

  const advNet = $("#advNet");
  const advNetSub = $("#advNetSub");
  if (netBenefit > 0) {
    advNet.textContent = "+" + fmtTHB(netBenefit) + " THB";
    advNet.style.color = "#16a34a"; // green
    if (advNetSub) advNetSub.textContent = "ประหยัดเงินได้สุทธิใน 30 วันเมื่อสั่งล้างทันที";
  } else {
    advNet.textContent = (netBenefit === 0 ? "0" : "\u2212" + fmtTHB(Math.abs(netBenefit))) + " THB";
    advNet.style.color = "#6b7280"; // neutral/muted
    if (advNetSub) advNetSub.textContent = "ยังไม่คุ้มทุนที่จะล้าง (ต้นทุนค่าล้างสูงกว่ารายได้ที่จะเสีย)";
  }

  const adv7dSub = $("#adv7dSub");
  if (adv7dSub) adv7dSub.textContent = "เงินที่จะหายไปใน 7 วันข้างหน้าหากไม่ล้างวันนี้";
  const adv30dSub = $("#adv30dSub");
  if (adv30dSub) adv30dSub.textContent = "เงินที่จะหายไปใน 30 วันข้างหน้าหากไม่ล้างวันนี้";
  const advCostSub = $("#advCostSub");
  if (advCostSub) advCostSub.textContent = "ต้นทุนค่าบริการล้างแผงของไซต์นี้";

  const color = rec.color || (netBenefit > 0 ? "red" : "green");
  const badge = $("#advisorBadge");
  badge.textContent = rec.badge_text || (netBenefit > 0 ? "⚠️ ACTION REQUIRED" : "ℹ️ MONITORING");
  badge.className = "advisor-badge " + color;

  const alert = $("#advisorAlert");
  alert.className = "advisor-alert advisor-" + color;
  const alertIcon = alert.querySelector(".advisor-alert-icon");
  if (alertIcon) {
    alertIcon.textContent = netBenefit > 0 ? "⚠️" : "ℹ️";
  }
  const alertText = $("#advisorAlertText");
  if (alertText) {
    alertText.innerHTML = rec.html_message || (rec.message ? rec.message.replace(/\n/g, "<br>") : "—");
  }
}

async function loadDeepDive(siteId) {
  try {
    const d = await api("deepdive/" + siteId);
    const site = state.sites.find((s) => s.site_id === siteId) || {};
    $("#deepdiveTitle").textContent =
      "Site Deep-Dive: " + siteId + " (" + (site.site_name || (d.telemetry && d.telemetry.site_name) || siteId) + ")";

    renderPowerFlowChart(d.telemetry || {});
    renderCumEnergyChart(d.daily || []);
    renderMonthlyChart(d.monthly || []);

    $("#ddExpSun").textContent = fmt(d.avg_expected_sun_hours, 2) + " h";
    $("#ddActSun").textContent = fmt(d.avg_actual_sun_hours, 2) + " h";
    $("#ddPR").textContent = fmt(d.pr_pct, 1) + "%";
    $("#ddPrIcon").textContent = d.pr_pct < 95 ? "\u26A0" : "";
    
    const currentLossPct = d.current_soiling_loss_pct !== undefined ? d.current_soiling_loss_pct : d.soiling_loss_7d_pct;
    $("#ddLoss").textContent = fmt(currentLossPct, 1) + "%";
    const lossCard = $("#ddLossCard");
    lossCard.className = "stack-card " +
      (d.soiling_status.level === "clean" ? "green" : d.soiling_status.level === "warning" ? "amber" : "red");
    $("#ddLossIcon").textContent = d.soiling_status.level === "clean" ? "" : "\u26A0";

    renderGauge(currentLossPct, d.soiling_status);
    statusChip(d.soiling_status);
    $("#ddROI").textContent = d.soiling_status.roi;

    const weeklyLossThb = d.financial && d.financial.projected_7d_thb !== undefined
      ? d.financial.projected_7d_thb
      : (d.financial && d.financial.daily_loss_thb ? d.financial.daily_loss_thb * 7 : 0);

    $("#ddEnergyLost").textContent =
      weeklyLossThb > 0
        ? "\u2248 " + fmtTHB(weeklyLossThb) + " THB / week (มูลค่าที่กำลังจะเสียไปต่อสัปดาห์หากชะลอการล้าง)"
        : "0 THB / week (แผงสะอาด ไม่มีมูลค่าสูญเสียสะสม)";
    $("#ddAdvice").textContent = d.soiling_status.advice;

    renderAdvisor(d.financial);
    refreshCurrentSiteDaily();
    refreshCurrentSiteMonthly();
  } catch (err) {
    console.error("Deep-dive loading error:", err);
  }
}

function sum(arr) {
  return arr.reduce((a, b) => a + Number(b || 0), 0);
}

/* ---------- Tariff & Settings Management ---------- */
async function loadSettings() {
  try {
    const res = await api("settings");
    if (res.tariffs) {
      state.tariffs = res.tariffs;
      const fit = res.tariffs.feed_in_tariff !== undefined ? res.tariffs.feed_in_tariff : res.tariffs.feed_in;
      const inputTariff = $("#inputFeedInTariff");
      if (inputTariff && !isNaN(Number(fit))) inputTariff.value = Number(fit).toFixed(2);
      const revLostSub = $("#mRevLostSub");
      if (revLostSub && !isNaN(Number(fit))) {
        revLostSub.textContent = "(Real-time sensor estimation & 4.5 PSH at " + Number(fit).toFixed(2) + " THB/kWh)";
      }
    }
    if (res.site_settings) {
      state.siteSettings = res.site_settings;
    }
    if (res.sync) {
      updateSyncBadge(res.sync);
    }
  } catch (err) {
    console.warn("Could not load settings:", err);
  }
}

async function saveFeedInTariff() {
  const input = $("#inputFeedInTariff");
  if (!input) return;
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 0) {
    alert("กรุณากรอกตัวเลขเรทส่งคืนการไฟฟ้าที่ถูกต้อง (เช่น 2.20)");
    return;
  }
  const btn = $("#btnSaveTariff");
  if (btn) btn.disabled = true;
  try {
    const res = await api("settings/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feed_in_tariff: val }),
    });
    const msg = $("#tariffSaveMsg");
    if (msg) {
      msg.classList.remove("hidden");
      setTimeout(() => msg.classList.add("hidden"), 3000);
    }
    await refreshFleet();
  } catch (err) {
    alert("บันทึกเรทไม่สำเร็จ: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------- Per-Site Cleaning Cost Management ---------- */
function toggleSiteCleaningEdit() {
  const box = $("#inlineCleaningCostBox");
  if (!box) return;
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) {
    const inp = $("#inputSiteCleaningCost");
    if (inp) {
      inp.focus();
      inp.select();
    }
  }
}

async function saveSiteCleaningCost() {
  const siteId = state.currentSiteId;
  const inp = $("#inputSiteCleaningCost");
  if (!siteId || !inp) return;
  const val = parseFloat(inp.value);
  if (isNaN(val) || val < 0) {
    alert("กรุณากรอกค่าบริการล้างแผงที่ถูกต้อง");
    return;
  }
  try {
    await api("settings/cleaning-cost/" + encodeURIComponent(siteId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleaning_cost_thb: val }),
    });
    toggleSiteCleaningEdit();
    await loadDeepDive(siteId);
  } catch (err) {
    alert("บันทึกค่าล้างแผงไม่สำเร็จ: " + err.message);
  }
}

async function openCleaningModal() {
  const modal = $("#modalCleaningCosts");
  const tbody = $("#cleaningCostTableBody");
  if (!modal || !tbody) return;

  try {
    const res = await api("settings");
    if (res.site_settings) state.siteSettings = res.site_settings;
  } catch (e) {
    console.warn(e);
  }

  const list = state.siteSettings && state.siteSettings.length > 0
    ? state.siteSettings
    : state.sites;

  tbody.innerHTML = list.map((s) => {
    const sid = s.site_id;
    const name = s.site_name || "";
    const region = s.region || "";
    const cost = s.cleaning_cost_thb != null ? s.cleaning_cost_thb : 15000;
    return (
      '<tr>' +
        '<td class="mono font-semibold">' + sid + '</td>' +
        '<td>' + name + ' <span class="muted" style="font-size:12px;">(' + region + ')</span></td>' +
        '<td style="text-align:right;">' +
          '<input type="number" class="modal-cleaning-input" data-site-id="' + sid + '" value="' + Math.round(cost) + '" step="500" min="0" /> THB' +
        '</td>' +
      '</tr>'
    );
  }).join("");

  modal.classList.remove("hidden");
}

function closeCleaningModal() {
  const modal = $("#modalCleaningCosts");
  if (modal) modal.classList.add("hidden");
}

async function saveAllCleaningCosts() {
  const inputs = $$(".modal-cleaning-input");
  const costs = {};
  inputs.forEach((inp) => {
    const sid = inp.dataset.siteId;
    const val = parseFloat(inp.value);
    if (sid && !isNaN(val)) {
      costs[sid] = val;
    }
  });

  try {
    await api("settings/cleaning-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costs }),
    });
    closeCleaningModal();
    await refreshFleet();
    if (state.currentView === "deepdive" && state.currentSiteId) {
      await loadDeepDive(state.currentSiteId);
    }
  } catch (err) {
    alert("บันทึกค่าล้างรายไซต์ไม่สำเร็จ: " + err.message);
  }
}

/* ---------- Background & Manual Sync ---------- */
function updateSyncBadge(sync) {
  const badge = $("#syncBadge");
  if (!badge || !sync) return;
  const status = sync.status || "idle";
  if (status === "syncing") {
    badge.textContent = "\uD83D\uDFE1 Syncing...";
    badge.style.borderColor = "#fcd34d";
    badge.style.color = "#92400e";
  } else if (status === "success") {
    const timeStr = sync.updated_at ? new Date(sync.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    badge.textContent = "\uD83D\uDFE2 Local Ready" + (timeStr ? " (" + timeStr + ")" : "");
    badge.style.borderColor = "#86efac";
    badge.style.color = "#166534";
  } else if (status === "warning") {
    badge.textContent = "\uD83D\uDFE1 Local Cached (Upstream slow)";
    badge.style.borderColor = "#fcd34d";
    badge.style.color = "#92400e";
  } else {
    badge.textContent = "\u26AA Local Ready";
    badge.style.borderColor = "#e2e8f0";
    badge.style.color = "#475569";
  }
}

async function manualSync() {
  const btn = $("#btnSyncNow");
  const txt = $("#syncBtnText");
  if (btn) btn.classList.add("syncing");
  if (txt) txt.textContent = "Syncing...";
  updateSyncBadge({ status: "syncing" });
  try {
    const res = await api("sync", { method: "POST" });
    updateSyncBadge({ status: res.status || "success", updated_at: new Date().toISOString() });
    await refreshFleet();
  } catch (err) {
    console.warn("Sync warning:", err);
    updateSyncBadge({ status: "warning" });
  } finally {
    if (btn) btn.classList.remove("syncing");
    if (txt) txt.textContent = "Sync Data";
  }
}

function openDeepDive(siteId) {
  state.currentSiteId = siteId;
  $("#siteSelect").value = siteId;
  switchView("deepdive");
  loadDeepDive(siteId);
}

function populateSiteSelect() {
  const sel = $("#siteSelect");
  sel.innerHTML = state.sites
    .map((s) => '<option value="' + s.site_id + '">' + s.site_id + " &mdash; " + s.site_name + "</option>")
    .join("");
}

/* ---------- Analytics ---------- */
async function loadFleetAnalytics() {
  try {
    const data = await api("analytics-monthly");
    renderFleetMonthlyChart(data);
  } catch (err) {
    console.error("Analytics load failed:", err);
  }
}

/* ---------- Views & Navigation ---------- */
function switchView(view) {
  state.currentView = view;
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + view).classList.remove("hidden");
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  if (view === "analytics") loadFleetAnalytics();
  if (view === "settings") {
    $("#setApiBase").textContent = location.origin;
  }
}

/* ---------- Auto-refresh ---------- */
function startAutoRefresh() {
  stopAutoRefresh();
  if (!state.autoRefresh) return;
  state.refreshTimer = setInterval(() => {
    if (state.currentView === "fleet") refreshFleet();
    else if (state.currentView === "deepdive" && state.currentSiteId) loadDeepDive(state.currentSiteId);
  }, state.refreshInterval * 1000);
}

function stopAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}

/* ---------- Fleet History (Daily & Monthly) ---------- */
function populateSiteFilter() {
  const sel = $("#historySiteFilter");
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">All Sites (ทุกไซต์ใน Fleet)</option>' +
    state.sites
      .map((s) => '<option value="' + s.site_id + '">' + s.site_id + " &mdash; " + s.site_name + "</option>")
      .join("");
  if (currentVal) sel.value = currentVal;
}

async function loadDailyHistory(days = 7, siteId = "") {
  const tbody = $("#fleetHistoryTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted); font-size:13.5px;">Loading daily history records...</td></tr>';
  try {
    const filterSite = siteId || ($("#historySiteFilter") ? $("#historySiteFilter").value : "");
    const query = "history-daily?days=" + days + (filterSite ? "&site_id=" + encodeURIComponent(filterSite) : "");
    const data = await api(query);
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted);">No daily records found for this selection.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0)
        ? "(0 THB/day)"
        : "(\u2212" + fmtInt(dailyLoss) + " THB/day)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.date || "\u2014") + "</td>" +
        '<td class="site-id-cell">' + (r.site_id || "\u2014") + "</td>" +
        "<td>" + (r.site_name || "\u2014") + "</td>" +
        "<td>" + (r.weather_condition || "\u2014") + "</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 2) + " h</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tr.addEventListener("click", () => openDeepDive(r.site_id));
      tbody.appendChild(tr);
    }
    const histUpdated = $("#historyLastUpdated");
    if (histUpdated) histUpdated.textContent = "Loaded " + data.length + " daily records";
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--red); padding:24px;">Failed to load daily history: ' + err.message + '</td></tr>';
  }
}

async function loadMonthlyHistory(months = 12, siteId = "") {
  const tbody = $("#fleetMonthlyTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted); font-size:13.5px;">Loading monthly history records...</td></tr>';
  try {
    const filterSite = siteId || ($("#historySiteFilter") ? $("#historySiteFilter").value : "");
    const query = "history-monthly?months=" + months + (filterSite ? "&site_id=" + encodeURIComponent(filterSite) : "");
    const data = await api(query);
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted);">No monthly records found for this selection.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0)
        ? "(0 THB)"
        : "(\u2212" + fmtInt(dailyLoss) + " THB)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.month || "\u2014") + "</td>" +
        '<td class="site-id-cell">' + (r.site_id || "\u2014") + "</td>" +
        "<td>" + (r.site_name || "\u2014") + "</td>" +
        "<td>" + (r.days_recorded || "\u2014") + " d</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 1) + " h</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tr.addEventListener("click", () => openDeepDive(r.site_id));
      tbody.appendChild(tr);
    }
    const histUpdated = $("#historyLastUpdated");
    if (histUpdated) histUpdated.textContent = "Loaded " + data.length + " monthly records";
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--red); padding:24px;">Failed to load monthly history: ' + err.message + '</td></tr>';
  }
}

/* ---------- Site Deep-Dive Daily & Monthly Breakdown ---------- */
async function refreshCurrentSiteDaily() {
  const siteId = state.currentSiteId;
  const tbody = $("#ddDailyTableBody");
  if (!siteId || !tbody) return;
  const days = $("#ddDailyDaysSelect") ? parseInt($("#ddDailyDaysSelect").value, 10) : 7;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">Loading ' + days + '-day records...</td></tr>';
  try {
    const data = await api("history-daily?days=" + days + "&site_id=" + encodeURIComponent(siteId));
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">No daily records available.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0) ? "(0 THB/day)" : "(\u2212" + fmtInt(dailyLoss) + " THB/day)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.date || "\u2014") + "</td>" +
        "<td>" + (r.weather_condition || "\u2014") + "</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 2) + " h</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--red); padding:18px;">Failed to load daily breakdown: ' + err.message + '</td></tr>';
  }
}

async function refreshCurrentSiteMonthly() {
  const siteId = state.currentSiteId;
  const tbody = $("#ddMonthlyTableBody");
  if (!siteId || !tbody) return;
  const months = $("#ddMonthlyMonthsSelect") ? parseInt($("#ddMonthlyMonthsSelect").value, 10) : 12;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">Loading ' + months + '-month records...</td></tr>';
  try {
    const data = await api("history-monthly?months=" + months + "&site_id=" + encodeURIComponent(siteId));
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">No monthly records available.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0) ? "(0 THB)" : "(\u2212" + fmtInt(dailyLoss) + " THB)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.month || "\u2014") + "</td>" +
        "<td>" + (r.days_recorded || "\u2014") + " d</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 1) + " h</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--red); padding:18px;">Failed to load monthly breakdown: ' + err.message + '</td></tr>';
  }
}

function switchFleetView(mode) {
  const isLive = mode === "live";
  const isDaily = mode === "daily";
  const isMonthly = mode === "monthly";

  const btnViewLive = $("#btnViewLive");
  const btnViewDailyHistory = $("#btnViewDailyHistory");
  const btnViewMonthlyHistory = $("#btnViewMonthlyHistory");

  const liveTableWrap = $("#liveTableWrap");
  const historyTableWrap = $("#historyTableWrap");
  const monthlyTableWrap = $("#monthlyTableWrap");

  const liveControls = $("#liveControls");
  const historyControls = $("#historyControls");
  const dailyRangeWrap = $("#dailyRangeWrap");
  const monthlyRangeWrap = $("#monthlyRangeWrap");
  const fleetTableTitle = $("#fleetTableTitle");

  if (btnViewLive) {
    btnViewLive.classList.toggle("active", isLive);
    btnViewLive.style.setProperty("background", isLive ? "#2563eb" : "transparent", "important");
    btnViewLive.style.setProperty("color", isLive ? "#ffffff" : "#64748b", "important");
  }
  if (btnViewDailyHistory) {
    btnViewDailyHistory.classList.toggle("active", isDaily);
    btnViewDailyHistory.style.setProperty("background", isDaily ? "#2563eb" : "transparent", "important");
    btnViewDailyHistory.style.setProperty("color", isDaily ? "#ffffff" : "#64748b", "important");
  }
  if (btnViewMonthlyHistory) {
    btnViewMonthlyHistory.classList.toggle("active", isMonthly);
    btnViewMonthlyHistory.style.setProperty("background", isMonthly ? "#2563eb" : "transparent", "important");
    btnViewMonthlyHistory.style.setProperty("color", isMonthly ? "#ffffff" : "#64748b", "important");
  }

  if (liveTableWrap) liveTableWrap.classList.toggle("hidden", !isLive);
  if (liveControls) liveControls.classList.toggle("hidden", !isLive);

  if (historyTableWrap) historyTableWrap.classList.toggle("hidden", !isDaily);
  if (monthlyTableWrap) monthlyTableWrap.classList.toggle("hidden", !isMonthly);

  if (historyControls) historyControls.classList.toggle("hidden", isLive);
  if (dailyRangeWrap) dailyRangeWrap.classList.toggle("hidden", !isDaily);
  if (monthlyRangeWrap) monthlyRangeWrap.classList.toggle("hidden", !isMonthly);

  if (fleetTableTitle) {
    fleetTableTitle.textContent = isLive ? "Real-time Fleet Status" : isDaily ? "Fleet Daily History" : "Fleet Monthly History";
  }

  const siteId = $("#historySiteFilter") ? $("#historySiteFilter").value : "";
  if (isDaily) {
    const days = $("#historyDaysSelect") ? parseInt($("#historyDaysSelect").value, 10) : 7;
    loadDailyHistory(days, siteId);
  }
  if (isMonthly) {
    const months = $("#historyMonthsSelect") ? parseInt($("#historyMonthsSelect").value, 10) : 12;
    loadMonthlyHistory(months, siteId);
  }
}

window.switchFleetView = switchFleetView;
window.loadDailyHistory = loadDailyHistory;
window.loadMonthlyHistory = loadMonthlyHistory;
window.refreshCurrentSiteDaily = refreshCurrentSiteDaily;
window.refreshCurrentSiteMonthly = refreshCurrentSiteMonthly;
window.manualSync = manualSync;
window.saveFeedInTariff = saveFeedInTariff;
window.toggleSiteCleaningEdit = toggleSiteCleaningEdit;
window.saveSiteCleaningCost = saveSiteCleaningCost;
window.openCleaningModal = openCleaningModal;
window.closeCleaningModal = closeCleaningModal;
window.saveAllCleaningCosts = saveAllCleaningCosts;

/* ---------- Init ---------- */
async function init() {
  // Navigation
  $$(".nav-item").forEach((n) => {
    n.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(n.dataset.view);
    });
  });
  $("#menuToggle").addEventListener("click", () =>
    $("#sidebar").classList.toggle("collapsed")
  );
  $("#btnRefresh").addEventListener("click", refreshFleet);
  $("#btnRefreshTop").addEventListener("click", refreshFleet);

  // Quick Tariff & Site Cost Keydown Listeners
  const inputTariff = $("#inputFeedInTariff");
  if (inputTariff) {
    inputTariff.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveFeedInTariff();
    });
  }
  const inputSiteCost = $("#inputSiteCleaningCost");
  if (inputSiteCost) {
    inputSiteCost.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveSiteCleaningCost();
    });
  }

  // Live vs Daily vs Monthly View Toggle
  const btnViewLive = $("#btnViewLive");
  const btnViewDailyHistory = $("#btnViewDailyHistory");
  const btnViewMonthlyHistory = $("#btnViewMonthlyHistory");
  if (btnViewLive) btnViewLive.addEventListener("click", () => switchFleetView("live"));
  if (btnViewDailyHistory) btnViewDailyHistory.addEventListener("click", () => switchFleetView("daily"));
  if (btnViewMonthlyHistory) btnViewMonthlyHistory.addEventListener("click", () => switchFleetView("monthly"));

  const historySiteFilter = $("#historySiteFilter");
  if (historySiteFilter) {
    historySiteFilter.addEventListener("change", () => {
      const isMonthly = $("#btnViewMonthlyHistory") && $("#btnViewMonthlyHistory").classList.contains("active");
      if (isMonthly) {
        const months = $("#historyMonthsSelect") ? parseInt($("#historyMonthsSelect").value, 10) : 12;
        loadMonthlyHistory(months, historySiteFilter.value);
      } else {
        const days = $("#historyDaysSelect") ? parseInt($("#historyDaysSelect").value, 10) : 7;
        loadDailyHistory(days, historySiteFilter.value);
      }
    });
  }

  const historyDaysSelect = $("#historyDaysSelect");
  if (historyDaysSelect) {
    historyDaysSelect.addEventListener("change", () => {
      const siteId = historySiteFilter ? historySiteFilter.value : "";
      loadDailyHistory(parseInt(historyDaysSelect.value, 10), siteId);
    });
  }

  const historyMonthsSelect = $("#historyMonthsSelect");
  if (historyMonthsSelect) {
    historyMonthsSelect.addEventListener("change", () => {
      const siteId = historySiteFilter ? historySiteFilter.value : "";
      loadMonthlyHistory(parseInt(historyMonthsSelect.value, 10), siteId);
    });
  }

  const btnRefreshHistory = $("#btnRefreshHistory");
  if (btnRefreshHistory) {
    btnRefreshHistory.addEventListener("click", () => {
      const isMonthly = $("#btnViewMonthlyHistory") && $("#btnViewMonthlyHistory").classList.contains("active");
      const siteId = historySiteFilter ? historySiteFilter.value : "";
      if (isMonthly) {
        const months = historyMonthsSelect ? parseInt(historyMonthsSelect.value, 10) : 12;
        loadMonthlyHistory(months, siteId);
      } else {
        const days = historyDaysSelect ? parseInt(historyDaysSelect.value, 10) : 7;
        loadDailyHistory(days, siteId);
      }
    });
  }

  const ddDailyDaysSelect = $("#ddDailyDaysSelect");
  if (ddDailyDaysSelect) {
    ddDailyDaysSelect.addEventListener("change", refreshCurrentSiteDaily);
  }
  const ddMonthlyMonthsSelect = $("#ddMonthlyMonthsSelect");
  if (ddMonthlyMonthsSelect) {
    ddMonthlyMonthsSelect.addEventListener("change", refreshCurrentSiteMonthly);
  }

  $("#autoRefresh").addEventListener("change", (e) => {
    state.autoRefresh = e.target.checked;
    startAutoRefresh();
  });
  $("#refreshInterval").addEventListener("change", (e) => {
    state.refreshInterval = parseInt(e.target.value, 10);
    $("#refreshIntervalLabel").textContent = state.refreshInterval + "s";
    startAutoRefresh();
  });

  // Tabs
  $$(".tab-btn").forEach((t) => {
    t.addEventListener("click", () => {
      $$(".tab-btn").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $$(".tab-pane").forEach((p) => p.classList.add("hidden"));
      $("#tab-" + t.dataset.tab).classList.remove("hidden");
    });
  });

  $("#siteSelect").addEventListener("change", (e) => {
    openDeepDive(e.target.value);
  });

  await loadSettings();
  await refreshFleet();
  populateSiteSelect();
  populateSiteFilter();
  startAutoRefresh();
}

window.addEventListener("DOMContentLoaded", init);

