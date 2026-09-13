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
  financialPeriod: "today",
  financialData: {
    today: { yield_kwh: 0, consumed_kwh: 0, exported_kwh: 0 },
    week: { yield_kwh: 0, consumed_kwh: 0, exported_kwh: 0 },
    month: { yield_kwh: 0, consumed_kwh: 0, exported_kwh: 0 },
    year: { yield_kwh: 0, consumed_kwh: 0, exported_kwh: 0 },
  },
  financialLoaded: false,
  uiMode: localStorage.getItem("solar_ui_mode") || "classic",
  showcaseFilter: "all",
  showcaseSort: "soiling-desc",
  showcaseInnerView: "card",
  lastSnapshotData: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const fmt = (v, d = 1) => (v == null || isNaN(v) ? "\u2014" : Number(v).toFixed(d));
const fmtInt = (v) => (v == null || isNaN(v) ? "\u2014" : Math.round(v).toLocaleString());
const fmtTHB = (v) => (v == null || isNaN(v) ? "\u2014" : Math.round(v).toLocaleString());

function setOnline(online) {
  const badge = $("#connectionBadge");
  badge.textContent = online ? "ออนไลน์" : "ออฟไลน์";
  badge.classList.toggle("offline", !online);
  const setConn = $("#setConn");
  if (setConn) setConn.textContent = online ? "เชื่อมต่อสำเร็จ" : "ไม่สามารถเชื่อมต่อได้";
}

function setLastUpdated() {
  const el = $("#lastUpdated");
  if (el) el.textContent = "อัปเดตล่าสุด: " + new Date().toLocaleTimeString("th-TH");
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
  if (loss < 5) return { cls: "badge-clean", text: "🟢 ปกติ (< 5%)", row: "" };
  if (loss < 15) return { cls: "badge-warning", text: "🟡 เฝ้าระวัง (" + fmt(loss, 1) + "%)", row: "row-warning" };
  return { cls: "badge-critical", text: "🔴 วิกฤต (" + fmt(loss, 1) + "%)", row: "row-critical" };
}

function flowBadge(flow) {
  if (flow === "Exported") return '<span class="badge badge-exported">\u26A1 ส่งออก (Exported)</span>';
  if (flow === "Balanced") return '<span class="badge badge-balanced">= สมดุล (Balanced)</span>';
  return '<span class="badge badge-imported">\u26A1 นำเข้า (Imported)</span>';
}

function updateFinancialCards() {
  const period = state.financialPeriod || "today";
  const periodData = (state.financialData && state.financialData[period])
    ? state.financialData[period]
    : (state.financialData ? state.financialData.today : { yield_kwh: 0, consumed_kwh: 0, exported_kwh: 0 });

  const fit = state.tariffs.feed_in_tariff !== undefined
    ? Number(state.tariffs.feed_in_tariff)
    : Number(state.tariffs.feed_in || 2.20);
  const git = state.tariffs.grid_import_tariff !== undefined
    ? Number(state.tariffs.grid_import_tariff)
    : Number(state.tariffs.grid_import || 4.50);

  const yieldKwh = periodData.yield_kwh || 0;
  const consumedKwh = periodData.consumed_kwh || 0;
  const exportedKwh = periodData.exported_kwh || 0;

  // 1. จำนวนเงินที่ขายได้ (Solar Revenue):
  // พลังงานไฟฟ้าทั้งหมดที่ผลิต/ขายได้คูณเรทขายไฟ fit
  const revenueSold = yieldKwh * fit;

  // 2. เงินที่ประหยัดไปได้ (Client Savings):
  // พลังงานโซลาร์ที่ลูกค้าดึงไปใช้ (consumedKwh)
  const netSavings = consumedKwh * Math.max(0.0, git - fit);
  const grossSavings = consumedKwh * git;

  // Render Box 1: จำนวนเงินที่ขายได้
  const elRev = $("#mRevenueSold");
  const elRevSub = $("#mRevenueSoldSub");
  if (elRev) {
    elRev.textContent = fmtTHB(Math.round(revenueSold)) + " บาท";
  }
  if (elRevSub) {
    const yieldDisplay = yieldKwh >= 1000
      ? (yieldKwh / 1000).toFixed(2) + " MWh"
      : fmtInt(yieldKwh) + " kWh";
    elRevSub.textContent = "(" + yieldDisplay + " \u00D7 " + fit.toFixed(2) + " บาท/หน่วย)";
  }

  // Render Box 2: เงินที่ประหยัดไปได้
  const elSav = $("#mClientSavings");
  const elSavSub = $("#mClientSavingsSub");
  const elSavTag = $("#savingsPeriodTag");
  if (elSav) {
    const displaySaving = (git > fit && netSavings > 0) ? netSavings : grossSavings;
    elSav.textContent = fmtTHB(Math.round(displaySaving)) + " บาท";
  }
  if (elSavSub) {
    if (git > fit) {
      const diff = (git - fit).toFixed(2);
      elSavSub.textContent = "(ประหยัดส่วนต่าง " + diff + " บาท/หน่วย | เทียบไฟหลวง " + fmtTHB(Math.round(grossSavings)) + " บาท)";
    } else {
      elSavSub.textContent = "(มูลค่าเทียบเท่าไฟหลวง " + git.toFixed(2) + " บาท/หน่วย)";
    }
  }
  if (elSavTag) {
    const periodLabels = {
      today: "เฉพาะวันนี้",
      week: "สัปดาห์นี้ (7 วัน)",
      month: "เดือนนี้ (30 วัน)",
      year: "ปีนี้ (12 เดือน)",
    };
    elSavTag.textContent = periodLabels[period] || "เฉพาะวันนี้";
  }

  // Ensure select dropdown reflects current selection
  const sel = $("#revenuePeriodSelect");
  if (sel && sel.value !== period) {
    sel.value = period;
  }
}

function switchFinancialPeriod(period) {
  state.financialPeriod = period;
  updateFinancialCards();
}
window.switchFinancialPeriod = switchFinancialPeriod;

async function loadAllFinancialPeriods() {
  if (state.financialLoaded) return;
  try {
    const [hist7, hist30, hist12] = await Promise.all([
      api("history-daily?days=7"),
      api("history-daily?days=30"),
      api("history-monthly?months=12"),
    ]);

    if (Array.isArray(hist7)) {
      const y = hist7.reduce((acc, r) => acc + Number(r.actual_yield_kwh || 0), 0);
      const e = hist7.reduce((acc, r) => acc + Number(r.exported_kwh || 0), 0);
      const c = Math.max(0, y - e);
      state.financialData.week = { yield_kwh: y, consumed_kwh: c, exported_kwh: e };
    }

    if (Array.isArray(hist30)) {
      const y = hist30.reduce((acc, r) => acc + Number(r.actual_yield_kwh || 0), 0);
      const e = hist30.reduce((acc, r) => acc + Number(r.exported_kwh || 0), 0);
      const c = Math.max(0, y - e);
      state.financialData.month = { yield_kwh: y, consumed_kwh: c, exported_kwh: e };
    }

    if (Array.isArray(hist12)) {
      const y = hist12.reduce((acc, r) => acc + Number(r.actual_yield_kwh || 0), 0);
      const e = hist12.reduce((acc, r) => acc + Number(r.exported_kwh || 0), 0);
      const c = Math.max(0, y - e);
      state.financialData.year = { yield_kwh: y, consumed_kwh: c, exported_kwh: e };
    }

    state.financialLoaded = true;
    updateFinancialCards();
  } catch (err) {
    console.warn("Could not pre-aggregate historical financial periods:", err.message);
  }
}

function renderFleet(data) {
  const s = data.summary || data.fleet_summary || {};
  $("#mCapacity").textContent = fmt(s.total_capacity_mwp || 0, 2) + " MWp";
  $("#mYield").textContent = fmt(s.total_yield_mwh || 0, 2) + " MWh";
  $("#mConsumed").textContent = fmt(s.total_consumed_mwh || 0, 2) + " MWh";
  $("#mExported").textContent = fmt(s.total_exported_mwh || 0, 2) + " MWh";

  const lostVal = Math.max(0, s.today_revenue_lost_thb || 0);
  $("#mRevLost").textContent = fmtTHB(lostVal) + " บาท";
  $("#mRevLost").classList.toggle("is-zero", lostVal <= 0);
  $("#fleetSiteCount").textContent = s.sites_count || (data.sites ? data.sites.length : 0);

  // Update today's energy in financialData
  const todayYieldKwh = (s.total_yield_mwh || 0) * 1000;
  const todayConsumedKwh = (s.total_consumed_mwh || 0) * 1000;
  const todayExportedKwh = (s.total_exported_mwh || 0) * 1000;
  state.financialData.today = {
    yield_kwh: todayYieldKwh,
    consumed_kwh: todayConsumedKwh,
    exported_kwh: todayExportedKwh,
  };

  if (data.tariffs) {
    state.tariffs = data.tariffs;
    const fit = data.tariffs.feed_in_tariff !== undefined ? data.tariffs.feed_in_tariff : data.tariffs.feed_in;
    const inputTariff = $("#inputFeedInTariff");
    if (inputTariff && document.activeElement !== inputTariff && !isNaN(Number(fit))) {
      inputTariff.value = Number(fit).toFixed(2);
    }
    const revLostSub = $("#mRevLostSub");
    if (revLostSub && !isNaN(Number(fit))) {
      revLostSub.textContent = "(ประมาณการเซนเซอร์ Real-time & 4.5 PSH ที่ " + Number(fit).toFixed(2) + " บาท/หน่วย)";
    }
  }

  // Update financial cards (Revenue Sold & Client Savings)
  updateFinancialCards();

  // Load week, month, year data in background if not yet loaded
  if (!state.financialLoaded) {
    loadAllFinancialPeriods();
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
      ? "(0 บาท/วัน)"
      : "(\u2212" + fmtInt(dailyLoss) + " บาท/วัน)";

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
      "<td>" + fmt(site.sun_hours_h, 2) + " ชม.</td>" +
      '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span> " +
      '<span class="daily-loss">' + lossDisplay + "</span></td>";
    tr.addEventListener("click", () => openDeepDive(site.site_id));
    tbody.appendChild(tr);
  }

  // Save latest snapshot and render Modern Showcase Mode
  state.lastSnapshotData = data;
  renderShowcaseMode(data);
}

/* ==========================================================================
   MODERN INDUSTRIAL SCADA SHOWCASE MODE LOGIC
   ========================================================================== */

function setUiMode(mode) {
  state.uiMode = mode;
  localStorage.setItem("solar_ui_mode", mode);
  applyUiMode(mode);
}
window.setUiMode = setUiMode;

function applyUiMode(mode) {
  const isShowcase = mode === "showcase";
  const btnClassic = $("#btnModeClassic");
  const btnShowcase = $("#btnModeShowcase");
  const viewClassic = $("#fleetClassicView");
  const viewShowcase = $("#fleetShowcaseView");
  const navGis = $("#navGisMap");

  if (btnClassic) btnClassic.classList.toggle("active", !isShowcase);
  if (btnShowcase) btnShowcase.classList.toggle("active", isShowcase);

  if (viewClassic) viewClassic.classList.toggle("hidden", isShowcase);
  if (viewShowcase) viewShowcase.classList.toggle("hidden", !isShowcase);

  // Requirement: GIS Map MUST ONLY appear in Showcase mode, NOT in Classic mode!
  if (navGis) navGis.classList.toggle("hidden", !isShowcase);

  // If user switches back to Classic mode while currently on GIS view, redirect to fleet view
  if (!isShowcase && state.currentView === "gis") {
    switchView("fleet");
  }

  document.body.classList.toggle("mode-showcase", isShowcase);

  if (isShowcase && state.lastSnapshotData) {
    renderShowcaseMode(state.lastSnapshotData);
  }

  // If on deepdive or analytics, reload to update chart themes
  if (state.currentView === "deepdive" && state.currentSiteId) {
    loadDeepDive(state.currentSiteId);
  } else if (state.currentView === "analytics") {
    loadFleetAnalytics();
  }
}
window.applyUiMode = applyUiMode;

function setShowcaseInnerView(innerView) {
  state.showcaseInnerView = innerView;
  const isCard = innerView === "card";
  const btnCard = $("#btnShowcaseViewCard");
  const btnTable = $("#btnShowcaseViewTable");
  const cardGrid = $("#scadaCardGrid");
  const tableView = $("#scadaTableView");

  if (btnCard) btnCard.classList.toggle("active", isCard);
  if (btnTable) btnTable.classList.toggle("active", !isCard);
  if (cardGrid) cardGrid.classList.toggle("hidden", !isCard);
  if (tableView) tableView.classList.toggle("hidden", isCard);
}
window.setShowcaseInnerView = setShowcaseInnerView;

function setScadaFilter(filter) {
  state.showcaseFilter = filter;
  $$(".scada-filter-pill").forEach((pill) => pill.classList.remove("active"));
  if (filter === "all") $("#scadaFilterAll")?.classList.add("active");
  if (filter === "clean") $("#scadaFilterClean")?.classList.add("active");
  if (filter === "fair") $("#scadaFilterFair")?.classList.add("active");
  if (filter === "critical") $("#scadaFilterCritical")?.classList.add("active");

  if (state.lastSnapshotData) {
    renderShowcaseCards(state.lastSnapshotData);
  }
}
window.setScadaFilter = setScadaFilter;

function setScadaSort(sortKey) {
  state.showcaseSort = sortKey;
  if (state.lastSnapshotData) {
    renderShowcaseCards(state.lastSnapshotData);
  }
}
window.setScadaSort = setScadaSort;

async function saveShowcaseTariff() {
  const inp = $("#scadaFeedInTariff");
  if (!inp) return;
  const val = parseFloat(inp.value);
  if (isNaN(val) || val < 0) {
    alert("กรุณากรอกเรทขายไฟเป็นตัวเลขที่ถูกต้อง");
    return;
  }
  const classicInp = $("#inputFeedInTariff");
  if (classicInp) classicInp.value = val.toFixed(2);

  try {
    await api("settings/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feed_in_tariff: val }),
    });
    state.tariffs.feed_in_tariff = val;
    state.tariffs.feed_in = val;
    const msg = $("#scadaTariffSavedMsg");
    if (msg) {
      msg.style.display = "inline";
      setTimeout(() => { msg.style.display = "none"; }, 3000);
    }
    await refreshFleet();
  } catch (err) {
    alert("บันทึกเรทไม่สำเร็จ: " + err.message);
  }
}
window.saveShowcaseTariff = saveShowcaseTariff;

function dispatchAllUrgentCleaning() {
  if (!state.sites || state.sites.length === 0) return;
  const criticalSites = state.sites.filter((s) => (s.soiling_loss_pct || 0) >= 10);
  if (criticalSites.length === 0) {
    alert("ระบบไม่พบไซต์ในเกณฑ์วิกฤตที่ต้องล้างด่วนในขณะนี้ ทุกไซต์มีค่าฝุ่นอยู่ในเกณฑ์มาตรฐาน (<10%)");
    return;
  }
  const siteNames = criticalSites.map((s) => `• ${s.site_id}: ${s.site_name} (ฝุ่น ${fmt(s.soiling_loss_pct, 1)}%, เสียหาย ฿${fmtInt(s.daily_loss_thb || 0)}/วัน)`).join("\n");
  const totalLoss = criticalSites.reduce((acc, s) => acc + (s.daily_loss_thb || 0), 0);
  
  if (confirm(`SCADA AI แนะนำออกใบงานล้างแผงทันทีสำหรับ ${criticalSites.length} ไซต์วิกฤต:\n\n${siteNames}\n\nรวมมูลค่าสูญเสียที่จะกู้คืนได้: ฿${fmtInt(totalLoss)} บาท/วัน\n\nต้องการยืนยันการออกใบงานส่งทีมปฏิบัติการหรือไม่?`)) {
    alert(`✓ ออกใบงานบำรุงรักษาเรียบร้อยแล้ว!\nระบบได้จัดคิวงานและส่งพิกัดไปยังทีมงานภาคสนามสำหรับ ${criticalSites.length} ไซต์เรียบร้อยแล้ว`);
  }
}
window.dispatchAllUrgentCleaning = dispatchAllUrgentCleaning;

function scheduleCleaningQuick(siteId, siteName) {
  const site = state.sites.find((s) => s.site_id === siteId);
  const loss = site ? (site.daily_loss_thb || 0) : 0;
  const cost = site ? (site.cleaning_cost_thb || 3000) : 3000;
  const payback = loss > 0 ? (cost / loss).toFixed(1) : "—";

  if (confirm(`ยืนยันการจัดคิวส่งทีมล้างแผงสำหรับไซต์:\n\n[${siteId}] ${siteName}\n\n• มูลค่าสูญเสียจากฝุ่น: ฿${fmtInt(loss)} บาท/วัน\n• ค่าบริการล้าง: ฿${fmtInt(cost)} บาท\n• คืนทุนการล้างใน: ${payback} วัน\n\nต้องการยืนยันจัดคิวด่วนหรือไม่?`)) {
    alert(`✓ จัดคิวล้างแผงสำหรับ ${siteId} เรียบร้อยแล้ว!\nทีมปฏิบัติการจะเข้าดำเนินการตามรอบเวลาที่กำหนด`);
  }
}
window.scheduleCleaningQuick = scheduleCleaningQuick;

function renderShowcaseMode(data) {
  if (!data) return;
  const s = data.summary || data.fleet_summary || {};
  const sites = data.sites || [];
  const fit = state.tariffs.feed_in_tariff !== undefined
    ? Number(state.tariffs.feed_in_tariff)
    : Number(state.tariffs.feed_in || 2.20);
  const git = state.tariffs.grid_import_tariff !== undefined
    ? Number(state.tariffs.grid_import_tariff)
    : Number(state.tariffs.grid_import || 4.50);

  // 1. Sync Tariff Input
  const inpFit = $("#scadaFeedInTariff");
  if (inpFit && document.activeElement !== inpFit) {
    inpFit.value = fit.toFixed(2);
  }
  const badgeFit = $("#scadaFitBadge");
  if (badgeFit) badgeFit.textContent = `FiT ${fit.toFixed(2)} THB`;

  // 2. Hero Metrics
  const capVal = s.total_capacity_mwp || (sites.reduce((acc, x) => acc + (x.capacity_kw || 0), 0) / 1000);
  const yieldVal = s.total_yield_mwh || (sites.reduce((acc, x) => acc + (x.actual_yield_kwh || 0), 0) / 1000);
  const consumedVal = s.total_consumed_mwh || (sites.reduce((acc, x) => acc + (x.consumed_kwh || 0), 0) / 1000);
  const exportedVal = s.total_exported_mwh || (sites.reduce((acc, x) => acc + (x.exported_kwh || 0), 0) / 1000);

  const elCap = $("#scadaCapacity");
  if (elCap) elCap.textContent = fmt(capVal, 2);

  const elYield = $("#scadaYield");
  if (elYield) elYield.textContent = fmt(yieldVal, 2);

  const psh = capVal > 0 ? (yieldVal / capVal).toFixed(2) : "0.00";
  const elPsh = $("#scadaYieldPsh");
  if (elPsh) elPsh.textContent = psh;

  const elConsumed = $("#scadaConsumed");
  if (elConsumed) elConsumed.textContent = fmt(consumedVal, 2);

  const consumedPct = yieldVal > 0 ? ((consumedVal / yieldVal) * 100).toFixed(1) + "%" : "0.0%";
  const elConsumedPct = $("#scadaConsumedPct");
  if (elConsumedPct) elConsumedPct.textContent = consumedPct;

  const elExported = $("#scadaExported");
  if (elExported) elExported.textContent = fmt(exportedVal, 2);

  const exportedPct = yieldVal > 0 ? ((exportedVal / yieldVal) * 100).toFixed(1) + "%" : "0.0%";
  const elExportedPct = $("#scadaExportedPct");
  if (elExportedPct) elExportedPct.textContent = exportedPct;

  const elFleetCount = $("#scadaFleetCount");
  if (elFleetCount) elFleetCount.textContent = sites.length;
  const elOnlineCount = $("#scadaOnlineCount");
  if (elOnlineCount) elOnlineCount.textContent = sites.length;

  // 3. Financial Attribution
  const todayYieldKwh = yieldVal * 1000;
  const todayConsumedKwh = consumedVal * 1000;
  const revenueSold = todayYieldKwh * fit;
  const netSavings = todayConsumedKwh * Math.max(0.0, git - fit);
  const grossSavings = todayConsumedKwh * git;
  const displaySaving = (git > fit && netSavings > 0) ? netSavings : grossSavings;

  const elRev = $("#scadaRevenueSold");
  if (elRev) elRev.textContent = "฿" + fmtTHB(Math.round(revenueSold));

  const elRevSub = $("#scadaRevenueSub");
  if (elRevSub) elRevSub.textContent = `${fmt(yieldVal, 2)} MWh × ${fit.toFixed(2)} บาท`;

  const elSav = $("#scadaClientSavings");
  if (elSav) elSav.textContent = "฿" + fmtTHB(Math.round(displaySaving));

  const elSavSub = $("#scadaSavingsSub");
  if (elSavSub) {
    if (git > fit) {
      elSavSub.textContent = `ประหยัด ${(git - fit).toFixed(2)} บ./หน่วย (เทียบ PEA ฿${fmtTHB(Math.round(grossSavings))})`;
    } else {
      elSavSub.textContent = `เทียบเท่าไฟหลวง ${git.toFixed(2)} บาท/หน่วย`;
    }
  }

  const lostVal = Math.max(0, s.today_revenue_lost_thb || 0);
  const elLost = $("#scadaRevenueLost");
  if (elLost) elLost.textContent = "฿" + fmtTHB(Math.round(lostVal));

  const elLoss30d = $("#scadaLoss30d");
  if (elLoss30d) elLoss30d.textContent = "฿" + fmtTHB(Math.round(lostVal * 30));

  const criticalSites = sites.filter((x) => (x.soiling_loss_pct || 0) >= 10);
  const elCritBadge = $("#scadaCritBadge");
  if (elCritBadge) elCritBadge.textContent = `${criticalSites.length} ไซต์วิกฤต`;

  // 4. Update Filter counts
  const cleanSites = sites.filter((x) => (x.soiling_loss_pct || 0) < 5);
  const fairSites = sites.filter((x) => (x.soiling_loss_pct || 0) >= 5 && (x.soiling_loss_pct || 0) < 10);

  if ($("#countFilterAll")) $("#countFilterAll").textContent = sites.length;
  if ($("#countFilterClean")) $("#countFilterClean").textContent = cleanSites.length;
  if ($("#countFilterFair")) $("#countFilterFair").textContent = fairSites.length;
  if ($("#countFilterCritical")) $("#countFilterCritical").textContent = criticalSites.length;

  const lastUpdateEl = $("#scadaLastUpdated");
  if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleTimeString("th-TH");

  // 5. Render Site Cards & Embedded Table
  renderShowcaseCards(data);

  // 6. Insight Banner Text
  const insightDesc = $("#scadaInsightDesc");
  if (insightDesc) {
    if (criticalSites.length > 0) {
      const topCrit = criticalSites.slice(0, 2).map((x) => x.site_id).join(" และ ");
      const totalRecov = criticalSites.reduce((acc, x) => acc + (x.daily_loss_thb || 0), 0);
      insightDesc.innerHTML = `การส่งทีมล้างพร้อมกัน ${criticalSites.length} ไซต์วิกฤต (<strong style="color:var(--scada-rose); font-family:var(--font-scada-head);">${topCrit}</strong>) จะกู้คืนรายได้ <strong style="color:var(--scada-emerald); font-family:var(--font-scada-head);">฿${fmtTHB(Math.round(totalRecov))}/วัน</strong> และถึงจุดคุ้มทุนเฉลี่ยใน <strong style="color:var(--scada-cyan); font-family:var(--font-scada-head);">3.2 วัน</strong>`;
    } else {
      insightDesc.textContent = `ประสิทธิภาพของฟลีทอยู่ในเกณฑ์ดีเยี่ยม ทุกไซต์มีความสะอาดอยู่ในเกณฑ์มาตรฐาน (ฝุ่นต่ำกว่า 10%) ไม่มีความจำเป็นเร่งด่วนในการส่งทีมล้าง`;
    }
  }
}

function renderShowcaseCards(data) {
  if (!data || !data.sites) return;
  const container = $("#scadaCardGrid");
  const tableBody = $("#scadaTableBody");
  if (!container) return;

  const fit = state.tariffs.feed_in_tariff !== undefined
    ? Number(state.tariffs.feed_in_tariff)
    : Number(state.tariffs.feed_in || 2.20);

  // Filter
  let filtered = [...data.sites];
  if (state.showcaseFilter === "clean") {
    filtered = filtered.filter((s) => (s.soiling_loss_pct || 0) < 5);
  } else if (state.showcaseFilter === "fair") {
    filtered = filtered.filter((s) => (s.soiling_loss_pct || 0) >= 5 && (s.soiling_loss_pct || 0) < 10);
  } else if (state.showcaseFilter === "critical") {
    filtered = filtered.filter((s) => (s.soiling_loss_pct || 0) >= 10);
  }

  // Sort
  if (state.showcaseSort === "soiling-desc") {
    filtered.sort((a, b) => (b.soiling_loss_pct || 0) - (a.soiling_loss_pct || 0));
  } else if (state.showcaseSort === "revenue-desc") {
    filtered.sort((a, b) => ((b.actual_yield_kwh || 0) * fit) - ((a.actual_yield_kwh || 0) * fit));
  } else if (state.showcaseSort === "power-desc") {
    filtered.sort((a, b) => (b.pv_power_kw || 0) - (a.pv_power_kw || 0));
  } else if (state.showcaseSort === "name-asc") {
    filtered.sort((a, b) => (a.site_id || "").localeCompare(b.site_id || ""));
  }

  // Build Cards HTML
  container.innerHTML = filtered.map((site) => {
    const sid = site.site_id;
    const sname = site.site_name || "";
    const region = site.region || "เขตปทุมธานีและภาคกลาง";
    const loss = site.soiling_loss_pct != null ? site.soiling_loss_pct : 0;
    const dailyLoss = site.daily_loss_thb || 0;
    const pvPower = site.pv_power_kw || 0;
    const cap = site.capacity_kw || site.capacity_kwp || 500;
    const irr = site.irradiance_w_m2 || 0;
    const actYield = site.actual_yield_kwh || 0;
    const todayRev = actYield * fit;
    const cost = site.cleaning_cost_thb || 3000;
    const payback = dailyLoss > 0 ? (cost / dailyLoss).toFixed(1) : null;

    let badgeClass = "badge-clean";
    let badgeLabel = `สะอาดดี ${fmt(loss, 1)}%`;
    let cardClass = "card-status-clean";
    let pingClass = "";
    let gaugeClass = "bar-clean";
    let pctTextClass = "text-clean";
    let gaugeWidth = Math.min(100, Math.max(8, (loss / 20) * 100));
    let actionBtn = `<button class="btn-card-action action-clean" onclick="event.stopPropagation(); openDeepDive('${sid}')">ดูรายละเอียด</button>`;
    let gaugeSubText = "ประสิทธิภาพแผงปกติ";

    if (loss >= 10) {
      cardClass = "card-status-critical";
      badgeClass = "badge-crit";
      badgeLabel = `ฝุ่นวิกฤต ${fmt(loss, 1)}%`;
      pingClass = "ping-crit";
      gaugeClass = "bar-crit";
      pctTextClass = "text-crit";
      gaugeSubText = payback ? `คืนทุนใน ${payback} วัน` : "แนะนำล้างด่วน";
      actionBtn = `<button class="btn-card-action action-crit" onclick="event.stopPropagation(); scheduleCleaningQuick('${sid}', '${sname.replace(/'/g, "\\'")}')">⚡ ล้างด่วน</button>`;
    } else if (loss >= 5) {
      cardClass = "card-status-fair";
      badgeClass = "badge-fair";
      badgeLabel = `ฝุ่นปานกลาง ${fmt(loss, 1)}%`;
      pingClass = "ping-fair";
      gaugeClass = "bar-fair";
      pctTextClass = "text-fair";
      gaugeSubText = payback ? `คืนทุนใน ${payback} วัน` : "แนะนำล้างใน 7 วัน";
      actionBtn = `<button class="btn-card-action action-fair" onclick="event.stopPropagation(); scheduleCleaningQuick('${sid}', '${sname.replace(/'/g, "\\'")}')">จัดคิวล้าง</button>`;
    }

    return `
      <div class="scada-site-card ${cardClass}" onclick="openDeepDive('${sid}')" title="คลิกเพื่อดูการวิเคราะห์รายไซต์ (Site Deep-Dive)">
        <div>
          <div class="scada-card-top">
            <div>
              <div class="scada-card-id-row">
                <span class="scada-card-site-id">${sid}</span>
                <span class="scada-live-ping ${pingClass}"></span>
              </div>
              <h4 class="scada-card-name" title="${sname}">${sname}</h4>
            </div>
            <span class="scada-card-status-badge ${badgeClass}">${badgeLabel}</span>
          </div>

          <div class="scada-card-telemetry">
            <div class="telemetry-item">
              <span>☀️</span>
              <span class="val">${fmtInt(irr)} W/m²</span>
            </div>
            <div class="telemetry-item">
              <span>⚡</span>
              <span class="val">${fmt(pvPower, 1)} / ${fmtInt(cap)} kWp</span>
            </div>
          </div>

          <div class="scada-soiling-gauge-box">
            <div class="gauge-top-row">
              <span class="title">การสูญเสียจากฝุ่น</span>
              <span class="loss-val">${dailyLoss > 0 ? '−฿' + fmtInt(dailyLoss) + '/วัน' : '0 บาท/วัน'}</span>
            </div>
            <div class="gauge-track">
              <div class="gauge-bar ${gaugeClass}" style="width: ${gaugeWidth.toFixed(0)}%;"></div>
            </div>
            <div class="gauge-sub-row">
              <span>${gaugeSubText}</span>
              <span class="pct-tag ${pctTextClass}">${fmt(loss, 1)}% LOSS</span>
            </div>
          </div>

          <div class="scada-card-financial-box">
            <div>
              <div class="fin-col-label">Today Revenue</div>
              <div class="fin-col-val">฿${fmtTHB(Math.round(todayRev))}</div>
            </div>
            <div style="text-align:right;">
              <div class="fin-col-label">Energy Yield</div>
              <div class="fin-col-val yield-val">${fmtInt(actYield)} kWh</div>
            </div>
          </div>
        </div>

        <div class="scada-card-footer">
          <span class="scada-card-region">${region}</span>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join("");

  // Build Table HTML (for optional table view inside showcase)
  if (tableBody) {
    tableBody.innerHTML = filtered.map((site) => {
      const sid = site.site_id;
      const sname = site.site_name || "";
      const loss = site.soiling_loss_pct != null ? site.soiling_loss_pct : 0;
      const dailyLoss = site.daily_loss_thb || 0;
      const pvPower = site.pv_power_kw || 0;
      const irr = site.irradiance_w_m2 || 0;
      const actYield = site.actual_yield_kwh || 0;
      const todayRev = actYield * fit;
      const isCrit = loss >= 10;
      const isFair = loss >= 5 && loss < 10;

      let badge = `<span class="scada-card-status-badge badge-clean">สะอาดดี ${fmt(loss, 1)}%</span>`;
      let btn = `<button class="scada-btn-link" onclick="event.stopPropagation(); openDeepDive('${sid}')">ดูข้อมูล</button>`;

      if (isCrit) {
        badge = `<span class="scada-card-status-badge badge-crit">วิกฤต ${fmt(loss, 1)}%</span>`;
        btn = `<button class="btn-card-action action-crit" onclick="event.stopPropagation(); scheduleCleaningQuick('${sid}', '${sname.replace(/'/g, "\\'")}')">ล้างด่วน</button>`;
      } else if (isFair) {
        badge = `<span class="scada-card-status-badge badge-fair">ปานกลาง ${fmt(loss, 1)}%</span>`;
        btn = `<button class="btn-card-action action-fair" onclick="event.stopPropagation(); scheduleCleaningQuick('${sid}', '${sname.replace(/'/g, "\\'")}')">จัดคิว</button>`;
      }

      return `
        <tr class="${isCrit ? 'row-crit' : ''}" onclick="openDeepDive('${sid}')">
          <td class="mono font-semibold" style="color:var(--scada-cyan);">${sid}</td>
          <td>${sname}</td>
          <td style="text-align:right;" class="mono">${irr > 0 ? '☀️ ' : ''}${fmtInt(irr)} W/m²</td>
          <td style="text-align:right;" class="mono">${fmt(pvPower, 1)} kW</td>
          <td style="text-align:right;" class="mono" style="color:var(--scada-emerald);">${fmtInt(actYield)}</td>
          <td style="text-align:right;" class="mono font-semibold">฿${fmtTHB(Math.round(todayRev))}</td>
          <td style="text-align:center;">${badge}</td>
          <td style="text-align:right;" class="mono ${isCrit ? 'text-crit font-bold' : ''}">${dailyLoss > 0 ? '−฿' + fmtInt(dailyLoss) : '0 บ.'}</td>
          <td style="text-align:center;">${btn}</td>
        </tr>
      `;
    }).join("");
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
    if (state.currentView === "gis") {
      renderGisMapView();
    }
  } catch (err) {
    setOnline(false);
    console.error("Fleet refresh failed:", err);
  }
}

/* ==========================================================================
   THAILAND SOLAR FLEET GIS MAP RADAR LOGIC (SHOWCASE ONLY)
   ========================================================================== */

const GIS_SITE_COORDINATES = {
  "SOLAR-BKK-01": { lat: 13.7563, lng: 100.5018, region: "central", name: "Bangkok Urban Factory Rooftop" },
  "SOLAR-RYG-02": { lat: 12.6815, lng: 101.2816, region: "east", name: "Rayong Industrial Estate Warehouse" },
  "SOLAR-CBI-03": { lat: 13.3611, lng: 100.9847, region: "east", name: "Chonburi Coastal Office Park" },
  "SOLAR-SPK-04": { lat: 13.5991, lng: 100.5998, region: "central", name: "Samut Prakan Cold Storage Hub" },
  "SOLAR-AYA-05": { lat: 14.3532, lng: 100.5684, region: "central", name: "Ayutthaya Mixed Industrial Plant" },
  "SOLAR-CNX-06": { lat: 18.7883, lng: 98.9853, region: "north", name: "Chiang Mai Hotel & Resort" },
  "SOLAR-KKC-07": { lat: 16.4322, lng: 102.8236, region: "isan", name: "Khon Kaen Regional Hospital" },
  "SOLAR-NMA-08": { lat: 14.9799, lng: 102.0978, region: "isan", name: "Nakhon Ratchasima Shopping Mall" },
  "SOLAR-SGK-09": { lat: 7.1756, lng: 100.6143, region: "south", name: "Songkhla Data Center" },
  "SOLAR-PTM-10": { lat: 14.0208, lng: 100.5250, region: "central", name: "Pathum Thani School Campus" },
};

const REGION_LABELS = {
  central: "ภาคกลาง & กทม.",
  east: "ภาคตะวันออก (EEC)",
  isan: "ภาคตะวันออกเฉียงเหนือ",
  north: "ภาคเหนือ",
  south: "ภาคใต้",
};

/** Extract short Thai province name from site_name or GIS coords */
function _shortProvince(siteId) {
  const map = {
    "SOLAR-BKK-01": "กรุงเทพฯ",
    "SOLAR-RYG-02": "ระยอง",
    "SOLAR-CBI-03": "ชลบุรี",
    "SOLAR-SPK-04": "สมุทรปราการ",
    "SOLAR-AYA-05": "อยุธยา",
    "SOLAR-CNX-06": "เชียงใหม่",
    "SOLAR-KKC-07": "ขอนแก่น",
    "SOLAR-NMA-08": "นครราชสีมา",
    "SOLAR-SGK-09": "สงขลา",
    "SOLAR-PTM-10": "ปทุมธานี",
  };
  return map[siteId] || siteId;
}

function _soilingColor(lossPct) {
  if (lossPct > 10) return { main: "#ef4444", glow: "#ef4444", core: "#2a0000", text: "#fca5a5" };
  if (lossPct >= 5) return { main: "#ffb95f", glow: "#ffb95f", core: "#2a1700", text: "#ffb95f" };
  return { main: "#4edea3", glow: "#4edea3", core: "#002113", text: "#4edea3" };
}

function _soilingLabel(lossPct) {
  if (lossPct > 10) return `วิกฤต ${lossPct.toFixed(1)}%`;
  if (lossPct >= 5) return `ฝุ่นสะสม ${lossPct.toFixed(1)}%`;
  return `สะอาด ${lossPct.toFixed(1)}%`;
}

/* ==========================================================================
   SVG MAP PAN & ZOOM CONTROLLER (PURE JAVASCRIPT, NO EXTERNAL DEPENDENCY)
   ========================================================================== */

let gisViewBox = { x: 0, y: 0, w: 800, h: 950 };
const GIS_DEFAULT_VIEWBOX = { x: 0, y: 0, w: 800, h: 950 };
let gisIsPanning = false;
let gisStartPoint = { x: 0, y: 0 };
let gisHasInitializedControls = false;

function updateGisViewBox() {
  const svg = document.getElementById("gisVectorSvg");
  if (!svg) return;
  svg.setAttribute("viewBox", `${Math.round(gisViewBox.x)} ${Math.round(gisViewBox.y)} ${Math.round(gisViewBox.w)} ${Math.round(gisViewBox.h)}`);

  // Calculate zoom scale relative to default viewBox width (800)
  const scale = gisViewBox.w / GIS_DEFAULT_VIEWBOX.w;

  // Scale-independent factors:
  // When zooming in, scale decreases. Multiplying SVG font size by fontFactor
  // ensures the on-screen rendered font stays steady (or grows very subtly)
  // instead of exploding and covering half the map.
  const fontFactor = Math.max(0.26, Math.min(1.0, Math.pow(scale, 0.90)));
  const dotFactor = Math.max(0.35, Math.min(1.0, Math.pow(scale, 0.65)));

  // Update pin labels (keep on-screen text crisp and un-cluttered)
  svg.querySelectorAll(".gis-pin-label").forEach((el) => {
    if (!el.hasAttribute("data-base-x")) {
      el.setAttribute("data-base-x", el.getAttribute("x") || "12");
      el.setAttribute("data-base-y", el.getAttribute("y") || "3");
      el.setAttribute("data-base-font", el.getAttribute("font-size") || "10.5");
    }
    const baseX = parseFloat(el.getAttribute("data-base-x"));
    const baseY = parseFloat(el.getAttribute("data-base-y"));
    const baseSize = parseFloat(el.getAttribute("data-base-font"));
    el.setAttribute("font-size", (baseSize * fontFactor).toFixed(1));
    el.setAttribute("x", (baseX * dotFactor).toFixed(1));
    el.setAttribute("y", (baseY * dotFactor).toFixed(1));
  });

  // Update pin status texts
  svg.querySelectorAll(".gis-pin-status").forEach((el) => {
    if (!el.hasAttribute("data-base-x")) {
      el.setAttribute("data-base-x", el.getAttribute("x") || "12");
      el.setAttribute("data-base-y", el.getAttribute("y") || "14");
      el.setAttribute("data-base-font", el.getAttribute("font-size") || "8.5");
    }
    const baseX = parseFloat(el.getAttribute("data-base-x"));
    const baseY = parseFloat(el.getAttribute("data-base-y"));
    const baseSize = parseFloat(el.getAttribute("data-base-font"));
    el.setAttribute("font-size", (baseSize * fontFactor).toFixed(1));
    el.setAttribute("x", (baseX * dotFactor).toFixed(1));
    el.setAttribute("y", (baseY * dotFactor).toFixed(1));
  });

  // Update pin dots, glow & cores
  svg.querySelectorAll(".gis-pin-glow").forEach((el) => {
    if (!el.hasAttribute("data-base-r")) el.setAttribute("data-base-r", el.getAttribute("r") || "14");
    const baseR = parseFloat(el.getAttribute("data-base-r"));
    el.setAttribute("r", (baseR * dotFactor).toFixed(1));
  });

  svg.querySelectorAll(".gis-pin-dot").forEach((el) => {
    if (!el.hasAttribute("data-base-r")) el.setAttribute("data-base-r", el.getAttribute("r") || "5");
    const baseR = parseFloat(el.getAttribute("data-base-r"));
    el.setAttribute("r", (baseR * dotFactor).toFixed(1));
  });

  svg.querySelectorAll(".gis-pin-core").forEach((el) => {
    if (!el.hasAttribute("data-base-r")) el.setAttribute("data-base-r", el.getAttribute("r") || "2");
    const baseR = parseFloat(el.getAttribute("data-base-r"));
    el.setAttribute("r", (baseR * dotFactor).toFixed(1));
  });

  // Fade out large regional watermarks and sea labels when zoomed in
  const watermarkOpacity = scale < 0.6 ? "0.15" : (scale < 0.8 ? "0.4" : "0.7");
  svg.querySelectorAll(".gis-region-watermark").forEach((el) => {
    el.setAttribute("font-size", (10 * fontFactor).toFixed(1));
    el.style.opacity = watermarkOpacity;
  });
  svg.querySelectorAll(".gis-water-label").forEach((el) => {
    el.setAttribute("font-size", (11 * fontFactor).toFixed(1));
    el.style.opacity = watermarkOpacity;
  });

  // Telemetry trunk lines stroke width
  svg.querySelectorAll(".gis-trunk-line").forEach((el) => {
    el.setAttribute("stroke-width", (0.9 * fontFactor).toFixed(2));
  });
}

function zoomGisMap(factor, clientX, clientY) {
  const minW = 200; // max zoom in
  const maxW = 1200; // max zoom out
  const newW = Math.max(minW, Math.min(maxW, gisViewBox.w * factor));
  const newH = newW * (GIS_DEFAULT_VIEWBOX.h / GIS_DEFAULT_VIEWBOX.w);

  const svg = document.getElementById("gisVectorSvg");
  let px = 0.5;
  let py = 0.5;

  if (svg && clientX != null && clientY != null) {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      px = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      py = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    }
  }

  gisViewBox.x += (gisViewBox.w - newW) * px;
  gisViewBox.y += (gisViewBox.h - newH) * py;
  gisViewBox.w = newW;
  gisViewBox.h = newH;
  updateGisViewBox();
}
window.zoomGisMap = zoomGisMap;

function resetGisZoom() {
  gisViewBox = { ...GIS_DEFAULT_VIEWBOX };
  updateGisViewBox();
}
window.resetGisZoom = resetGisZoom;

function panToGisRegion(region) {
  const targets = {
    all: { x: 0, y: 0, w: 800, h: 950 },
    central: { x: 170, y: 230, w: 320, h: 380 },
    east: { x: 260, y: 310, w: 300, h: 356 },
    isan: { x: 330, y: 140, w: 380, h: 451 },
    north: { x: 60, y: 40, w: 360, h: 427 },
    south: { x: 100, y: 460, w: 380, h: 451 },
  };
  const target = targets[region] || targets.all;
  gisViewBox = { ...target };
  updateGisViewBox();
}
window.panToGisRegion = panToGisRegion;

function initGisMapControls() {
  const svg = document.getElementById("gisVectorSvg");
  if (!svg || gisHasInitializedControls) return;
  gisHasInitializedControls = true;

  // Mouse drag panning
  svg.addEventListener("mousedown", (e) => {
    if (e.target.closest(".gis-node")) return;
    gisIsPanning = true;
    gisStartPoint = { x: e.clientX, y: e.clientY };
    svg.classList.add("is-panning");
  });

  window.addEventListener("mousemove", (e) => {
    if (!gisIsPanning) return;
    const rect = svg.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const scaleX = gisViewBox.w / rect.width;
    const scaleY = gisViewBox.h / rect.height;
    const dx = (e.clientX - gisStartPoint.x) * scaleX;
    const dy = (e.clientY - gisStartPoint.y) * scaleY;
    gisViewBox.x -= dx;
    gisViewBox.y -= dy;
    gisStartPoint = { x: e.clientX, y: e.clientY };
    updateGisViewBox();
  });

  window.addEventListener("mouseup", () => {
    if (gisIsPanning) {
      gisIsPanning = false;
      svg.classList.remove("is-panning");
    }
  });

  // Wheel zoom
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.85;
    zoomGisMap(factor, e.clientX, e.clientY);
  }, { passive: false });

  // Double click to zoom in
  svg.addEventListener("dblclick", (e) => {
    if (e.target.closest(".gis-node")) return;
    zoomGisMap(0.7, e.clientX, e.clientY);
  });

  // Touch pinch & pan
  let touchStartDist = 0;
  let touchStartCenter = { x: 0, y: 0 };
  let touchLastPos = { x: 0, y: 0 };

  svg.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchLastPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.hypot(dx, dy);
      touchStartCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    }
  }, { passive: true });

  svg.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) {
      const rect = svg.getBoundingClientRect();
      const scaleX = gisViewBox.w / rect.width;
      const scaleY = gisViewBox.h / rect.height;
      const dx = (e.touches[0].clientX - touchLastPos.x) * scaleX;
      const dy = (e.touches[0].clientY - touchLastPos.y) * scaleY;
      gisViewBox.x -= dx;
      gisViewBox.y -= dy;
      touchLastPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      updateGisViewBox();
    } else if (e.touches.length === 2 && touchStartDist > 0) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const factor = touchStartDist / dist;
      touchStartDist = dist;
      zoomGisMap(factor, touchStartCenter.x, touchStartCenter.y);
    }
  }, { passive: false });
}
window.initGisMapControls = initGisMapControls;

/* ==========================================================================
   GIS MAP RENDERING & TELEMETRY SYNC
   ========================================================================== */

function renderGisMapView() {
  initGisMapControls();

  const sites = (state.lastSnapshotData && state.lastSnapshotData.sites) || state.sites || [];
  if (sites.length === 0) return;

  let totalLoss = 0;
  let totalFlux = 0;
  let critCount = 0;
  let fairCount = 0;
  let cleanCount = 0;

  // Build a quick lookup: siteId → site data
  const siteMap = {};
  for (const s of sites) {
    siteMap[s.site_id] = s;
    const lossPct = Number(s.soiling_loss_pct != null ? s.soiling_loss_pct : (s.soiling_loss_percent != null ? s.soiling_loss_percent : 0));
    const revLost = Number(s.daily_loss_thb != null ? s.daily_loss_thb : (s.daily_financial_loss_thb != null ? s.daily_financial_loss_thb : 0));
    const flux = Number(s.irradiance_w_m2 || 0);

    totalLoss += revLost;
    totalFlux += flux;

    if (lossPct > 10) critCount++;
    else if (lossPct >= 5) fairCount++;
    else cleanCount++;
  }

  const avgFlux = sites.length > 0 ? Math.round(totalFlux / sites.length) : 0;
  const onlineCount = sites.length;

  // --- Header telemetry ---
  const elGpsSync = $("#gisGpsSyncCount");
  if (elGpsSync) elGpsSync.textContent = `${onlineCount}/${onlineCount} ONLINE`;

  const elAvgFlux = $("#gisAvgIrradiance");
  if (elAvgFlux) elAvgFlux.textContent = avgFlux + " W/m²";

  const elTotalLoss = $("#gisTotalLoss");
  if (elTotalLoss) elTotalLoss.textContent = "฿" + Math.round(totalLoss).toLocaleString() + "/วัน";

  // --- Legend counts ---
  const elCrit = $("#legendCritCount");
  if (elCrit) elCrit.textContent = critCount + " ไซต์";

  const elFair = $("#legendFairCount");
  if (elFair) elFair.textContent = fairCount + " ไซต์";

  const elClean = $("#legendCleanCount");
  if (elClean) elClean.textContent = cleanCount + " ไซต์";

  // --- Update SVG Map Pins dynamically ---
  const pinNodes = $$(".gis-node[data-site-id]");
  pinNodes.forEach((node) => {
    const siteId = node.getAttribute("data-site-id");
    const site = siteMap[siteId];
    if (!site) return;

    const lossPct = Number(site.soiling_loss_pct != null ? site.soiling_loss_pct : (site.soiling_loss_percent != null ? site.soiling_loss_percent : 0));
    const colors = _soilingColor(lossPct);
    const isCrit = lossPct > 10;

    // Update circle colors
    const glowCircle = node.querySelector(".gis-pin-glow");
    if (glowCircle) {
      glowCircle.setAttribute("fill", colors.glow);
      glowCircle.setAttribute("fill-opacity", isCrit ? "0.25" : "0.15");
      glowCircle.setAttribute("data-base-r", isCrit ? "18" : "14");
      if (isCrit) {
        glowCircle.classList.add("gis-ping-circle");
      } else {
        glowCircle.classList.remove("gis-ping-circle");
      }
    }

    const dotCircle = node.querySelector(".gis-pin-dot");
    if (dotCircle) {
      dotCircle.setAttribute("fill", colors.main);
      dotCircle.setAttribute("data-base-r", isCrit ? "7" : lossPct >= 5 ? "5.5" : "5");
    }

    const coreCircle = node.querySelector(".gis-pin-core");
    if (coreCircle) {
      coreCircle.setAttribute("fill", isCrit ? "#ffffff" : colors.core);
    }

    // Update status text
    const statusText = node.querySelector(".gis-pin-status");
    if (statusText) {
      statusText.textContent = _soilingLabel(lossPct);
      statusText.setAttribute("fill", colors.text);
    }
  });

  // --- Regional Summary Cards ---
  const regionContainer = $("#gisRegionalCards");
  if (regionContainer) {
    const regionData = {};
    for (const s of sites) {
      const coords = GIS_SITE_COORDINATES[s.site_id];
      const region = coords ? coords.region : "central";
      if (!regionData[region]) {
        regionData[region] = { sites: [], totalCapacity: 0, totalLoss: 0, maxLoss: 0 };
      }
      regionData[region].sites.push(s);
      regionData[region].totalCapacity += Number(s.capacity_kwp || 0);
      const revLost = Number(s.daily_loss_thb != null ? s.daily_loss_thb : (s.daily_financial_loss_thb != null ? s.daily_financial_loss_thb : 0));
      regionData[region].totalLoss += revLost;
      const sl = Number(s.soiling_loss_pct != null ? s.soiling_loss_pct : (s.soiling_loss_percent != null ? s.soiling_loss_percent : 0));
      if (sl > regionData[region].maxLoss) regionData[region].maxLoss = sl;
    }

    const regionOrder = ["central", "east", "isan", "north", "south"];
    let cardsHTML = "";

    for (const regionKey of regionOrder) {
      const rd = regionData[regionKey];
      if (!rd) continue;

      const maxLoss = rd.maxLoss;
      const dotClass = maxLoss > 10 ? "dot-critical" : maxLoss >= 5 ? "dot-fair" : "dot-clean";
      const dotStyle = maxLoss > 10 ? 'class="scada-pulse-dot" style="background:var(--scada-rose); width:6px; height:6px;"' : `class="pill-dot ${dotClass}"`;
      const lossColor = maxLoss > 10 ? "#f87171" : maxLoss >= 5 ? "var(--scada-amber)" : "var(--scada-emerald)";
      const barClass = maxLoss > 10 ? "bar-crit" : maxLoss >= 5 ? "bar-fair" : "bar-clean";
      const capMWp = (rd.totalCapacity / 1000).toFixed(2);
      const lossThb = Math.round(rd.totalLoss);
      const gaugeWidth = totalLoss > 0 ? Math.min(Math.round((rd.totalLoss / totalLoss) * 100), 100) : 5;

      cardsHTML += `
        <div class="region-card" onclick="filterGisRegion('${regionKey}')">
          <div class="region-top">
            <div style="display:flex; align-items:center; gap:6px;">
              <span ${dotStyle}></span>
              <strong>${REGION_LABELS[regionKey] || regionKey}</strong>
            </div>
            <span class="region-site-count">${rd.sites.length} ไซต์</span>
          </div>
          <div class="region-stats-grid">
            <div><span class="lbl">กำลังผลิตติดตั้ง</span><span class="val">${capMWp} MWp</span></div>
            <div><span class="lbl">สูญเสียสะสม</span><span class="val" style="color:${lossColor};">฿${lossThb.toLocaleString()}/วัน</span></div>
          </div>
          <div class="gauge-track" style="height:4px; margin-top:8px;">
            <div class="gauge-bar ${barClass}" style="width:${gaugeWidth}%;"></div>
          </div>
        </div>`;
    }
    regionContainer.innerHTML = cardsHTML;
  }

  // --- Priority Watchlist (TOP 3 by soiling loss %) ---
  const watchlistContainer = $("#gisWatchlist");
  if (watchlistContainer) {
    const sorted = [...sites].sort((a, b) => {
      const lossA = Number(a.soiling_loss_pct != null ? a.soiling_loss_pct : (a.soiling_loss_percent || 0));
      const lossB = Number(b.soiling_loss_pct != null ? b.soiling_loss_pct : (b.soiling_loss_percent || 0));
      return lossB - lossA;
    });
    const top3 = sorted.slice(0, 3);
    let wlHTML = "";

    top3.forEach((s, idx) => {
      const lossPct = Number(s.soiling_loss_pct != null ? s.soiling_loss_pct : (s.soiling_loss_percent != null ? s.soiling_loss_percent : 0));
      const lossThb = Math.round(Number(s.daily_loss_thb != null ? s.daily_loss_thb : (s.daily_financial_loss_thb != null ? s.daily_financial_loss_thb : 0)));
      const isCrit = lossPct > 10;
      const isFair = lossPct >= 5 && lossPct <= 10;
      const numColor = isCrit ? "#f87171" : isFair ? "var(--scada-amber)" : "var(--scada-emerald)";
      const detailColor = isCrit ? "#fca5a5" : isFair ? "var(--scada-amber)" : "var(--scada-emerald)";
      const badgeLabel = isCrit ? "วิกฤต" : isFair ? "เฝ้าระวัง" : "ปกติ";
      const badgeBg = isCrit ? "rgba(239,68,68,0.2)" : isFair ? "rgba(255,185,95,0.2)" : "rgba(78,222,163,0.2)";
      const badgeColor = isCrit ? "#fca5a5" : isFair ? "var(--scada-amber)" : "var(--scada-emerald)";
      const province = _shortProvince(s.site_id);

      wlHTML += `
        <div class="queue-item" style="background:#0b101c; border:1px solid var(--scada-border-subtle); border-radius:8px; padding:9px 12px; display:flex; align-items:center; justify-content:space-between; cursor:pointer;" onclick="openDeepDive('${s.site_id}')">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--font-scada-head); font-weight:800; color:${numColor}; font-size:12px;">${idx + 1}</span>
            <div>
              <div style="font-size:12px; font-weight:700; color:#ffffff;">${s.site_id} (${province})</div>
              <div style="font-size:10px; color:${detailColor};">สูญเสีย ฿${lossThb.toLocaleString()}/วัน • ฝุ่น ${lossPct.toFixed(1)}%</div>
            </div>
          </div>
          <span class="scada-badge-tag" style="background:${badgeBg}; color:${badgeColor}; font-size:9px;">${badgeLabel}</span>
        </div>`;
    });
    watchlistContainer.innerHTML = wlHTML;
  }

  // --- Drone / Inspection Strip (show top 3 sites by soiling) ---
  const droneContainer = $("#gisDroneStrip");
  if (droneContainer) {
    const sorted = [...sites].sort((a, b) => {
      const lossA = Number(a.soiling_loss_pct != null ? a.soiling_loss_pct : (a.soiling_loss_percent || 0));
      const lossB = Number(b.soiling_loss_pct != null ? b.soiling_loss_pct : (b.soiling_loss_percent || 0));
      return lossB - lossA;
    });
    const top3 = sorted.slice(0, 3);
    const icons = ["🚁", "🌊", "🤖"];
    let stripHTML = "";

    top3.forEach((s, idx) => {
      const lossPct = Number(s.soiling_loss_pct != null ? s.soiling_loss_pct : (s.soiling_loss_percent != null ? s.soiling_loss_percent : 0));
      const isCrit = lossPct > 10;
      const isFair = lossPct >= 5 && lossPct <= 10;
      const tagColor = isCrit ? "#f87171" : isFair ? "var(--scada-amber)" : "var(--scada-emerald)";
      const tagIcon = isCrit ? "⚠️" : isFair ? "🔍" : "✓";
      const province = _shortProvince(s.site_id);
      const cleanPct = (100 - lossPct).toFixed(1);
      const statusLabel = isCrit ? `ฝุ่นหนา: ${lossPct.toFixed(1)}%` : isFair ? `ฝุ่นปานกลาง: ${lossPct.toFixed(1)}%` : `แผงสะอาด: ${cleanPct}% Clean`;
      const dailyLoss = Number(s.daily_loss_thb != null ? s.daily_loss_thb : (s.daily_financial_loss_thb != null ? s.daily_financial_loss_thb : 0));
      const detailLine = isCrit
        ? `สูญเสีย ฿${Math.round(dailyLoss).toLocaleString()}/วัน`
        : `กำลังผลิต ${Number(s.pv_power_kw || 0).toFixed(0)} kW`;

      stripHTML += `
        <div class="drone-card">
          <div class="drone-thumb" style="background:linear-gradient(135deg, #1e293b, #0f172a); display:flex; align-items:center; justify-content:center; font-size:24px;">${icons[idx] || "📡"}</div>
          <div class="drone-info">
            <div class="drone-tag" style="color:${tagColor};">${tagIcon} สถานี${province} (${s.site_id})</div>
            <div class="drone-title">${statusLabel}</div>
            <div class="drone-time">${detailLine}</div>
          </div>
        </div>`;
    });
    droneContainer.innerHTML = stripHTML;
  }

  // Focus currently selected site if still present, else SOLAR-BKK-01 or first site
  const currentFocusedId = $("#gisCardSiteId")?.textContent;
  const targetSite = (currentFocusedId && sites.find((s) => s.site_id === currentFocusedId))
    || sites.find((s) => s.site_id === "SOLAR-BKK-01")
    || sites[0];
  if (targetSite) {
    focusGisSite(targetSite.site_id);
  }

  // Apply scale-independent pin & font scaling
  updateGisViewBox();
}
window.renderGisMapView = renderGisMapView;

function focusGisSite(siteId) {
  const sites = (state.lastSnapshotData && state.lastSnapshotData.sites) || state.sites || [];
  const coords = GIS_SITE_COORDINATES[siteId] || { lat: 13.7563, lng: 100.5018, region: "central", name: siteId };

  const site = sites.find((s) => s.site_id === siteId) || sites[0] || {
    site_id: siteId,
    site_name: coords.name || siteId,
    soiling_loss_pct: 0.0,
    pv_power_kw: 130.0,
    daily_loss_thb: 0,
    irradiance_w_m2: 250,
  };

  const lossPct = Number(site.soiling_loss_pct != null ? site.soiling_loss_pct : (site.soiling_loss_percent != null ? site.soiling_loss_percent : 0));
  const lossThb = Math.round(Number(site.daily_loss_thb != null ? site.daily_loss_thb : (site.daily_financial_loss_thb != null ? site.daily_financial_loss_thb : 0)));
  const isCrit = lossPct > 10;
  const isFair = lossPct >= 5 && lossPct <= 10;

  // Highlight selected SVG pin
  const nodes = $$(".gis-node");
  nodes.forEach((n) => {
    const sId = n.getAttribute("data-site-id");
    const isTarget = sId === siteId;
    n.classList.toggle("is-active", isTarget);
    if (isTarget) {
      n.style.filter = "drop-shadow(0 0 12px rgba(76, 215, 246, 1)) brightness(1.35)";
    } else {
      n.style.filter = "none";
    }
  });

  const cardSiteId = $("#gisCardSiteId");
  if (cardSiteId) cardSiteId.textContent = site.site_id;

  const cardSiteName = $("#gisCardSiteName");
  if (cardSiteName) cardSiteName.textContent = `${coords.name || site.site_name}`;

  const cardCoords = $("#gisCardCoords");
  if (cardCoords) cardCoords.textContent = `${coords.lat.toFixed(4)}° N, ${coords.lng.toFixed(4)}° E`;

  const cardDot = $("#gisCardDot");
  if (cardDot) {
    cardDot.style.background = isCrit ? "var(--scada-rose)" : isFair ? "var(--scada-amber)" : "var(--scada-emerald)";
  }

  const cardStatusTitle = $("#gisCardStatusTitle");
  if (cardStatusTitle) {
    cardStatusTitle.textContent = isCrit ? "CRITICAL SOILING ALERT" : isFair ? "MONITORING ADVISORY" : "OPTIMAL PERFORMANCE";
    cardStatusTitle.style.color = isCrit ? "#fca5a5" : isFair ? "var(--scada-amber)" : "var(--scada-emerald)";
  }

  const cardBadge = $("#gisCardBadge");
  if (cardBadge) {
    cardBadge.textContent = `SOILING ${lossPct.toFixed(1)}%`;
    cardBadge.className = `scada-card-status-badge ${isCrit ? "badge-crit" : isFair ? "badge-fair" : "badge-clean"}`;
  }

  const cardOutput = $("#gisCardOutput");
  if (cardOutput) cardOutput.textContent = `${Number(site.pv_power_kw || 0).toFixed(1)} kW`;

  const cardDeficit = $("#gisCardDeficit");
  if (cardDeficit) {
    cardDeficit.textContent = `฿${lossThb.toLocaleString()} /วัน`;
    cardDeficit.style.color = isCrit ? "#f87171" : isFair ? "var(--scada-amber)" : "var(--scada-emerald)";
  }

  const cardFlux = $("#gisCardFlux");
  if (cardFlux) cardFlux.textContent = `${Math.round(Number(site.irradiance_w_m2 || 0))} W/m²`;

  const cardPayback = $("#gisCardPayback");
  if (cardPayback) {
    const cost = Number(site.cleaning_cost_thb || state.siteCleaningCosts[siteId] || 15000);
    const dailyLossVal = Math.max(lossThb, 1);
    if (lossThb <= 0) {
      cardPayback.textContent = "ไม่ต้องล้าง (สะอาด)";
    } else {
      const paybackDays = (cost / dailyLossVal).toFixed(1);
      cardPayback.textContent = paybackDays <= 30 ? `${paybackDays} วัน` : "> 30 วัน";
    }
  }

  const cardWeather = $("#gisCardWeather");
  if (cardWeather) {
    cardWeather.innerHTML = isCrit
      ? "<span>⚠️ สภาพอากาศ: มีฝุ่นสะสมหนาแน่น ควรเข้าทำความสะอาด</span>"
      : isFair
      ? "<span>🌤️ สภาพอากาศ: มีฝุ่นสะสมปานกลาง กำลังผลิตอยู่ในเกณฑ์เฝ้าระวัง</span>"
      : "<span>✨ สภาพอากาศ: แผงสะอาด สภาพการทำงานปกติ ประสิทธิภาพการผลิตสูงสุด</span>";
  }
}
window.focusGisSite = focusGisSite;

function filterGisSites(query) {
  const q = (query || "").trim().toLowerCase();
  const nodes = $$(".gis-node");
  nodes.forEach((node) => {
    const text = node.textContent.toLowerCase();
    if (!q || text.includes(q)) {
      node.style.opacity = "1";
      node.style.pointerEvents = "auto";
    } else {
      node.style.opacity = "0.2";
      node.style.pointerEvents = "none";
    }
  });
}
window.filterGisSites = filterGisSites;

function filterGisRegion(region) {
  $$(".gis-filter-chip").forEach((c) => {
    c.classList.toggle("active", c.getAttribute("data-region") === region);
  });

  const nodes = $$(".gis-node");
  nodes.forEach((node) => {
    const siteId = node.getAttribute("data-site-id") || "";
    const siteRegion = GIS_SITE_COORDINATES[siteId]?.region;

    if (region === "all" || siteRegion === region) {
      node.style.opacity = "1";
      node.style.pointerEvents = "auto";
      node.style.filter = "drop-shadow(0 0 8px rgba(76, 215, 246, 0.8))";
    } else {
      node.style.opacity = "0.2";
      node.style.pointerEvents = "none";
      node.style.filter = "none";
    }
  });

  // Smoothly pan & zoom to the selected region
  panToGisRegion(region);
}
window.filterGisRegion = filterGisRegion;

function openDeepDiveFromGis() {
  const siteId = $("#gisCardSiteId")?.textContent || "SOLAR-BKK-01";
  openDeepDive(siteId);
}
window.openDeepDiveFromGis = openDeepDiveFromGis;

/* ---------- Deep-Dive ---------- */
function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    state.charts[key] = null;
  }
}

function getChartTheme() {
  const isShowcase = state.uiMode === "showcase";
  return {
    textColor: isShowcase ? "#94a3b8" : "#475569",
    gridColor: isShowcase ? "rgba(34, 47, 70, 0.6)" : "rgba(229, 231, 235, 0.8)",
    trackColor: isShowcase ? "#1e293b" : "#e5e7eb",
    font: { family: "'Space Grotesk', sans-serif", size: 11 },
  };
}

function renderPowerFlowChart(tel) {
  destroyChart("power");
  const ctx = document.getElementById("powerFlowChart").getContext("2d");
  const pv = Number(tel.pv_power_kw || 0);
  const load = Number(tel.load_power_kw || 0);
  const net = Math.abs(pv - load);
  const exported = pv > load;
  const theme = getChartTheme();

  const nightBadge = $("#powerFlowNightBadge");
  if (nightBadge) {
    nightBadge.classList.toggle("hidden", pv > 0);
  }

  state.charts.power = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["กำลังผลิต PV", "โหลดที่ใช้", exported ? "ส่งออกสุทธิ" : "นำเข้าสุทธิ"],
      datasets: [
        {
          label: "กำลังไฟฟ้า (kW)",
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
      scales: {
        x: {
          ticks: { color: theme.textColor, font: theme.font },
          grid: { color: theme.gridColor },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "กำลังไฟฟ้า (kW)", color: theme.textColor, font: theme.font },
          ticks: { color: theme.textColor, font: theme.font },
          grid: { color: theme.gridColor },
        },
      },
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
  const theme = getChartTheme();
  const ctx = document.getElementById("cumEnergyChart").getContext("2d");
  state.charts.cum = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "ผลผลิตคาดหวัง (kWh)",
          data: expCum,
          borderColor: "#9ca3af",
          backgroundColor: "rgba(156,163,175,0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
        {
          label: "ผลผลิตจริง (kWh)",
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
      plugins: {
        legend: {
          position: "top",
          labels: { color: theme.textColor, font: theme.font },
        },
      },
      scales: {
        x: {
          ticks: { color: theme.textColor, font: theme.font },
          grid: { color: theme.gridColor },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "พลังงานสะสม (kWh)", color: theme.textColor, font: theme.font },
          ticks: { color: theme.textColor, font: theme.font },
          grid: { color: theme.gridColor },
        },
      },
    },
  });
}

function renderMonthlyChart(monthly) {
  destroyChart("monthly");
  const labels = monthly.map((m) => m.month);
  const theme = getChartTheme();
  const ctx = document.getElementById("monthlyChart").getContext("2d");
  state.charts.monthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "ผลผลิตคาดหวัง (kWh)",
          data: monthly.map((m) => +m.expected_yield_kwh.toFixed(0)),
          backgroundColor: "rgba(156,163,175,0.55)",
          borderRadius: 4,
        },
        {
          label: "ผลผลิตจริง (kWh)",
          data: monthly.map((m) => +m.actual_yield_kwh.toFixed(0)),
          backgroundColor: "rgba(34,197,94,0.8)",
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { color: theme.textColor, font: theme.font },
        },
      },
      scales: {
        x: {
          ticks: { color: theme.textColor, font: theme.font },
          grid: { color: theme.gridColor },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "พลังงาน (kWh)", color: theme.textColor, font: theme.font },
          ticks: { color: theme.textColor, font: theme.font },
          grid: { color: theme.gridColor },
        },
      },
    },
  });
}

function renderFleetMonthlyChart(monthly) {
  destroyChart("fleetMonthly");
  if (!monthly || !Array.isArray(monthly) || monthly.length === 0) return;

  const byMonth = {};
  for (const m of monthly) {
    const month = m.month || "Unknown";
    if (!byMonth[month]) byMonth[month] = { exp: 0, act: 0 };
    byMonth[month].exp += (Number(m.expected_yield_kwh) || 0);
    byMonth[month].act += (Number(m.actual_yield_kwh) || 0);
  }
  const months = Object.keys(byMonth).sort();
  const isShowcase = state.uiMode === "showcase";
  const theme = getChartTheme();
  const canvas = document.getElementById("fleetMonthlyChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  state.charts.fleetMonthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "ผลผลิตคาดหวัง (Expected kWh)",
          data: months.map((m) => Math.round(byMonth[m].exp)),
          backgroundColor: isShowcase ? "rgba(100, 116, 139, 0.55)" : "rgba(156, 163, 175, 0.55)",
          borderColor: isShowcase ? "#64748b" : "#9ca3af",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "ผลผลิตจริง (Actual kWh)",
          data: months.map((m) => Math.round(byMonth[m].act)),
          backgroundColor: isShowcase ? "rgba(6, 182, 212, 0.85)" : "rgba(37, 99, 235, 0.8)",
          borderColor: isShowcase ? "#22d3ee" : "#2563eb",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top",
          labels: { color: theme.textColor, font: theme.font },
        },
        tooltip: {
          backgroundColor: isShowcase ? "rgba(15, 23, 42, 0.95)" : "rgba(0, 0, 0, 0.85)",
          titleColor: isShowcase ? "#f8fafc" : "#ffffff",
          bodyColor: isShowcase ? "#cbd5e1" : "#ffffff",
          borderColor: isShowcase ? "rgba(56, 189, 248, 0.4)" : "rgba(255, 255, 255, 0.2)",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function (context) {
              const val = context.parsed.y || 0;
              return ` ${context.dataset.label}: ${val.toLocaleString()} kWh`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: theme.textColor, font: theme.font },
          grid: { color: theme.gridColor },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "พลังงานรวมทั้ง Fleet (kWh)", color: theme.textColor, font: theme.font },
          ticks: {
            color: theme.textColor,
            font: theme.font,
            callback: function (val) {
              return val >= 1000 ? (val / 1000).toLocaleString() + "k" : val;
            },
          },
          grid: { color: theme.gridColor },
        },
      },
    },
  });

  // Render monthly summary table if present
  const tableBody = document.getElementById("fleetMonthlyTableBody");
  if (tableBody) {
    const sortedDesc = [...months].reverse();
    let tableHtml = "";
    for (const m of sortedDesc) {
      const exp = byMonth[m].exp;
      const act = byMonth[m].act;
      const diff = act - exp;
      const ratio = exp > 0 ? (act / exp) * 100 : 100;
      const isGood = ratio >= 98;
      const isWarn = ratio >= 90 && ratio < 98;
      const badgeCls = isGood ? "badge-clean" : isWarn ? "badge-warning" : "badge-critical";
      const statusText = isGood ? "🟢 ปกติ" : isWarn ? "🟡 เฝ้าระวัง" : "🔴 ต่ำกว่าเกณฑ์";
      const diffSign = diff >= 0 ? "+" : "";

      tableHtml += `
        <tr>
          <td><strong>${m}</strong></td>
          <td>${Math.round(exp).toLocaleString()} kWh</td>
          <td style="color:${isShowcase ? '#22d3ee' : '#2563eb'}; font-weight:600;">${Math.round(act).toLocaleString()} kWh</td>
          <td style="color:${diff >= 0 ? '#10b981' : '#f87171'};">${diffSign}${Math.round(diff).toLocaleString()} kWh</td>
          <td><strong>${ratio.toFixed(1)}%</strong></td>
          <td><span class="badge ${badgeCls}">${statusText}</span></td>
        </tr>`;
    }
    tableBody.innerHTML = tableHtml;
  }
}

function renderGauge(loss, status) {
  destroyChart("gauge");
  const ctx = document.getElementById("soilingGauge").getContext("2d");
  const theme = getChartTheme();
  const color =
    status.level === "clean" ? "#22c55e" : status.level === "warning" ? "#f59e0b" : "#dc2626";
  state.charts.gauge = new Chart(ctx, {
    type: "doughnut",
    data: {
      datasets: [
        {
          data: [Math.min(loss, 100), Math.max(100 - loss, 0)],
          backgroundColor: [color, theme.trackColor],
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

  $("#adv7d").textContent = fmtTHB(loss7d) + " บาท";
  $("#adv30d").textContent = fmtTHB(loss30d) + " บาท";
  $("#advCost").textContent = fmtTHB(cleaningCost) + " บาท";
  const inpSiteCost = $("#inputSiteCleaningCost");
  if (inpSiteCost) inpSiteCost.value = Math.round(cleaningCost);

  const advNet = $("#advNet");
  const advNetSub = $("#advNetSub");
  if (netBenefit > 0) {
    advNet.textContent = "+" + fmtTHB(netBenefit) + " บาท";
    advNet.style.color = "#16a34a"; // green
    if (advNetSub) advNetSub.textContent = "ประหยัดเงินได้สุทธิใน 30 วันเมื่อสั่งล้างทันที";
  } else {
    advNet.textContent = (netBenefit === 0 ? "0" : "\u2212" + fmtTHB(Math.abs(netBenefit))) + " บาท";
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
  badge.textContent = rec.badge_text || (netBenefit > 0 ? "⚠️ สั่งล้างทันที" : "ℹ️ เฝ้าระวังต่อเนื่อง");
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
      "วิเคราะห์รายไซต์ (Site Deep-Dive): " + siteId + " (" + (site.site_name || (d.telemetry && d.telemetry.site_name) || siteId) + ")";

    renderPowerFlowChart(d.telemetry || {});
    renderCumEnergyChart(d.daily || []);
    renderMonthlyChart(d.monthly || []);

    $("#ddExpSun").textContent = fmt(d.avg_expected_sun_hours, 2) + " ชม.";
    $("#ddActSun").textContent = fmt(d.avg_actual_sun_hours, 2) + " ชม.";
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
        ? "\u2248 " + fmtTHB(weeklyLossThb) + " บาท / สัปดาห์ (มูลค่าที่จะเสียไปหากชะลอการล้าง)"
        : "0 บาท / สัปดาห์ (แผงสะอาด ไม่มีมูลค่าสูญเสียสะสม)";
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
          '<input type="number" class="modal-cleaning-input" data-site-id="' + sid + '" value="' + Math.round(cost) + '" step="500" min="0" /> บาท' +
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
    badge.textContent = "\uD83D\uDFE1 กำลังซิงค์...";
    badge.style.borderColor = "#fcd34d";
    badge.style.color = "#92400e";
  } else if (status === "success") {
    const timeStr = sync.updated_at ? new Date(sync.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    badge.textContent = "\uD83D\uDFE2 พร้อมใช้งาน" + (timeStr ? " (" + timeStr + ")" : "");
    badge.style.borderColor = "#86efac";
    badge.style.color = "#166534";
  } else if (status === "warning") {
    badge.textContent = "\uD83D\uDFE1 ใช้ข้อมูลแคช (API ตอบสนองช้า)";
    badge.style.borderColor = "#fcd34d";
    badge.style.color = "#92400e";
  } else {
    badge.textContent = "\u26AA พร้อมใช้งาน";
    badge.style.borderColor = "#e2e8f0";
    badge.style.color = "#475569";
  }
}

let isSyncingInProgress = false;
let lastSyncTimestamp = 0;

async function manualSync() {
  const now = Date.now();
  if (isSyncingInProgress) return;
  if (now - lastSyncTimestamp < 2500) {
    return; // Cooldown to prevent spam clicking
  }

  isSyncingInProgress = true;
  lastSyncTimestamp = now;

  const btnSync = $("#btnSyncNow");
  const txtSync = $("#syncBtnText");
  const btnRefresh = $("#btnRefresh");
  const txtRefresh = $("#btnRefreshText");

  if (btnSync) {
    btnSync.classList.add("syncing");
    btnSync.disabled = true;
  }
  if (txtSync) txtSync.textContent = "กำลังซิงค์...";

  if (btnRefresh) {
    btnRefresh.classList.add("syncing");
    btnRefresh.disabled = true;
  }
  if (txtRefresh) txtRefresh.textContent = "กำลังรีเฟรช...";

  updateSyncBadge({ status: "syncing" });
  try {
    const res = await api("sync", { method: "POST" });
    updateSyncBadge({ status: res.status || "success", updated_at: new Date().toISOString() });
    await refreshFleet();
  } catch (err) {
    console.warn("Sync warning:", err);
    updateSyncBadge({ status: "warning" });
  } finally {
    setTimeout(() => {
      isSyncingInProgress = false;
      if (btnSync) {
        btnSync.classList.remove("syncing");
        btnSync.disabled = false;
      }
      if (txtSync) txtSync.textContent = "ซิงค์ข้อมูล";
      if (btnRefresh) {
        btnRefresh.classList.remove("syncing");
        btnRefresh.disabled = false;
      }
      if (txtRefresh) txtRefresh.textContent = "รีเฟรชทันที";
    }, 1200);
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
    let data;
    try {
      data = await api("analytics-monthly");
    } catch (e) {
      data = await api("history-monthly");
    }
    if (data && Array.isArray(data)) {
      renderFleetMonthlyChart(data);
    }
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

  if (view === "deepdive") {
    const targetSiteId = state.currentSiteId || (state.sites && state.sites.length > 0 ? state.sites[0].site_id : "SOLAR-BKK-01");
    state.currentSiteId = targetSiteId;
    const sel = $("#siteSelect");
    if (sel && sel.value !== targetSiteId) sel.value = targetSiteId;
    loadDeepDive(targetSiteId);
  } else if (view === "gis") {
    renderGisMapView();
    initGisMapControls();
  } else if (view === "analytics") {
    loadFleetAnalytics();
  } else if (view === "settings") {
    $("#setApiBase").textContent = location.origin;
  }
}

/* ---------- Auto-refresh ---------- */
function startAutoRefresh() {
  stopAutoRefresh();
  if (!state.autoRefresh) return;
  state.refreshTimer = setInterval(() => {
    if (state.currentView === "fleet" || state.currentView === "gis") refreshFleet();
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
  const firstSiteId = state.sites && state.sites.length > 0 ? state.sites[0].site_id : "";

  sel.innerHTML =
    (state.sites || [])
      .map((s) => '<option value="' + s.site_id + '">' + s.site_id + " &mdash; " + s.site_name + "</option>")
      .join("") +
    '<option value="">ทุกไซต์ใน Fleet (All Sites)</option>';

  if (currentVal && Array.from(sel.options).some((o) => o.value === currentVal)) {
    sel.value = currentVal;
  } else if (firstSiteId) {
    sel.value = firstSiteId;
  }
}

async function loadDailyHistory(days = 7, siteId = "") {
  const tbody = $("#fleetHistoryTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted); font-size:13.5px;">กำลังโหลดข้อมูลประวัติรายวัน...</td></tr>';
  try {
    const filterSite = siteId || ($("#historySiteFilter") ? $("#historySiteFilter").value : "");
    const query = "history-daily?days=" + days + (filterSite ? "&site_id=" + encodeURIComponent(filterSite) : "");
    const data = await api(query);
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted);">ไม่พบข้อมูลประวัติรายวันตามเงื่อนไขที่เลือก</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0)
        ? "(0 บาท/วัน)"
        : "(\u2212" + fmtInt(dailyLoss) + " บาท/วัน)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.date || "\u2014") + "</td>" +
        '<td class="site-id-cell">' + (r.site_id || "\u2014") + "</td>" +
        "<td>" + (r.site_name || "\u2014") + "</td>" +
        "<td>" + (r.weather_condition || "\u2014") + "</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 2) + " ชม.</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tr.addEventListener("click", () => openDeepDive(r.site_id));
      tbody.appendChild(tr);
    }
    const histUpdated = $("#historyLastUpdated");
    if (histUpdated) histUpdated.textContent = "โหลดข้อมูลประวัติรายวันเรียบร้อย " + data.length + " รายการ";
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--red); padding:24px;">เกิดข้อผิดพลาดในการโหลดข้อมูลประวัติรายวัน: ' + err.message + '</td></tr>';
  }
}

async function loadMonthlyHistory(months = 12, siteId = "") {
  const tbody = $("#fleetMonthlyTableBody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted); font-size:13.5px;">กำลังโหลดข้อมูลประวัติรายเดือน...</td></tr>';
  try {
    const filterSite = siteId || ($("#historySiteFilter") ? $("#historySiteFilter").value : "");
    const query = "history-monthly?months=" + months + (filterSite ? "&site_id=" + encodeURIComponent(filterSite) : "");
    const data = await api(query);
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--muted);">ไม่พบข้อมูลประวัติรายเดือนตามเงื่อนไขที่เลือก</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0)
        ? "(0 บาท)"
        : "(\u2212" + fmtInt(dailyLoss) + " บาท)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.month || "\u2014") + "</td>" +
        '<td class="site-id-cell">' + (r.site_id || "\u2014") + "</td>" +
        "<td>" + (r.site_name || "\u2014") + "</td>" +
        "<td>" + (r.days_recorded || "\u2014") + " วัน</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 1) + " ชม.</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tr.addEventListener("click", () => openDeepDive(r.site_id));
      tbody.appendChild(tr);
    }
    const histUpdated = $("#historyLastUpdated");
    if (histUpdated) histUpdated.textContent = "โหลดข้อมูลประวัติรายเดือนเรียบร้อย " + data.length + " รายการ";
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--red); padding:24px;">เกิดข้อผิดพลาดในการโหลดข้อมูลประวัติรายเดือน: ' + err.message + '</td></tr>';
  }
}

/* ---------- Site Deep-Dive Daily & Monthly Breakdown ---------- */
async function refreshCurrentSiteDaily() {
  const siteId = state.currentSiteId;
  const tbody = $("#ddDailyTableBody");
  if (!siteId || !tbody) return;
  const days = $("#ddDailyDaysSelect") ? parseInt($("#ddDailyDaysSelect").value, 10) : 7;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">กำลังโหลดข้อมูลย้อนหลัง ' + days + ' วัน...</td></tr>';
  try {
    const data = await api("history-daily?days=" + days + "&site_id=" + encodeURIComponent(siteId));
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">ไม่มีข้อมูลประวัติรายวัน</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0) ? "(0 บาท/วัน)" : "(\u2212" + fmtInt(dailyLoss) + " บาท/วัน)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.date || "\u2014") + "</td>" +
        "<td>" + (r.weather_condition || "\u2014") + "</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 2) + " ชม.</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--red); padding:18px;">เกิดข้อผิดพลาดในการโหลดข้อมูลประวัติรายวัน: ' + err.message + '</td></tr>';
  }
}

async function refreshCurrentSiteMonthly() {
  const siteId = state.currentSiteId;
  const tbody = $("#ddMonthlyTableBody");
  if (!siteId || !tbody) return;
  const months = $("#ddMonthlyMonthsSelect") ? parseInt($("#ddMonthlyMonthsSelect").value, 10) : 12;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">กำลังโหลดข้อมูลย้อนหลัง ' + months + ' เดือน...</td></tr>';
  try {
    const data = await api("history-monthly?months=" + months + "&site_id=" + encodeURIComponent(siteId));
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:var(--muted);">ไม่มีข้อมูลประวัติรายเดือน</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    for (const r of data) {
      const loss = r.soiling_loss_pct != null ? r.soiling_loss_pct : 0;
      const dailyLoss = r.daily_loss_thb || 0;
      const badge = soilingBadge(loss);
      const lossDisplay = (loss < 5 || dailyLoss <= 0) ? "(0 บาท)" : "(\u2212" + fmtInt(dailyLoss) + " บาท)";

      const tr = document.createElement("tr");
      tr.className = badge.row;
      tr.innerHTML =
        '<td class="mono font-semibold">' + (r.month || "\u2014") + "</td>" +
        "<td>" + (r.days_recorded || "\u2014") + " วัน</td>" +
        "<td>" + fmt(r.avg_irradiance_w_m2, 1) + " W/m\u00B2</td>" +
        "<td>" + fmt(r.sun_hours_h, 1) + " ชม.</td>" +
        "<td>" + fmtInt(r.expected_yield_kwh) + "</td>" +
        "<td>" + fmtInt(r.actual_yield_kwh) + "</td>" +
        '<td><span class="badge ' + badge.cls + '">' + badge.text + "</span></td>" +
        '<td><span class="daily-loss font-semibold">' + lossDisplay + "</span></td>";
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--red); padding:18px;">เกิดข้อผิดพลาดในการโหลดข้อมูลประวัติรายเดือน: ' + err.message + '</td></tr>';
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
    fleetTableTitle.textContent = isLive ? "สถานะระบบ Real-time ทุกไซต์" : isDaily ? "ประวัติรายวันทุกไซต์ (Fleet Daily History)" : "ประวัติรายเดือนทุกไซต์ (Fleet Monthly History)";
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
  // Mobile Drawer Navigation Helpers
  function closeMobileSidebar() {
    const sidebar = $("#sidebar");
    const backdrop = $("#sidebarBackdrop");
    if (sidebar) sidebar.classList.remove("mobile-open");
    if (backdrop) backdrop.classList.remove("active");
  }

  // Navigation Links
  $$(".nav-item").forEach((n) => {
    n.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(n.dataset.view);
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      }
    });
  });

  // Hamburger / Collapse Button
  const menuToggle = $("#menuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        const sidebar = $("#sidebar");
        const backdrop = $("#sidebarBackdrop");
        if (sidebar) {
          const isOpen = sidebar.classList.toggle("mobile-open");
          if (backdrop) backdrop.classList.toggle("active", isOpen);
        }
      } else {
        const sidebar = $("#sidebar");
        if (sidebar) sidebar.classList.toggle("collapsed");
      }
    });
  }

  // Dismiss backdrop click
  const backdrop = $("#sidebarBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", closeMobileSidebar);
  }

  // Clean up on viewport resize
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      closeMobileSidebar();
    }
  });

  const btnRefresh = $("#btnRefresh");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", manualSync);
  }
  const btnRefreshTop = $("#btnRefreshTop");
  if (btnRefreshTop) {
    btnRefreshTop.addEventListener("click", manualSync);
  }

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
  applyUiMode(state.uiMode);
  populateSiteSelect();
  populateSiteFilter();
  startAutoRefresh();
}

window.addEventListener("DOMContentLoaded", init);

