// Conto Ore v2.1 — fix navigazione giorni + anti-doppio-wire
(() => {
  // Guard: se per qualche motivo questo file viene eseguito due volte, non rilegare eventi.
  if (window.__contoOreV21Loaded) return;
  window.__contoOreV21Loaded = true;

  const $ = (sel) => document.querySelector(sel);
  const STORAGE_KEY = "conto-ore.v2";

  const state = loadState();
  let currentDate = state.currentDate || todayYMD();

  function defaultState(){
    return {
      currentDate: null,
      settings: { hourlyRate: 0 },
      days: {} // { "YYYY-MM-DD": { morning:{start,end,gapMin} | null, afternoon:{start,end,gapMin} | null } }
    };
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      const s = JSON.parse(raw);
      return { ...defaultState(), ...s };
    }catch{
      return defaultState();
    }
  }

  function saveState(){
    state.currentDate = currentDate;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function dateToYMDLocal(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${dd}`;
  }

  function todayYMD(){
    return dateToYMDLocal(new Date());
  }

  function euro(n){
    const v = (Number.isFinite(n) ? n : 0);
    return new Intl.NumberFormat("it-IT",{style:"currency", currency:"EUR"}).format(v);
  }

  function parseNum(x){
    if(x===null || x===undefined || x==="") return 0;
    const s = String(x).replace(",",".");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function hhmmToMin(hhmm){
    if(!hhmm) return 0;
    const [h,m] = hhmm.split(":").map(Number);
    return (h*60 + m);
  }

  function formatHM(minutes){
    minutes = Math.max(0, Math.round(minutes));
    const h = Math.floor(minutes/60);
    const m = minutes%60;
    return `${h}:${String(m).padStart(2,"0")}`;
  }

  function timeOptions(){
    const out = [];
    for(let m=0; m<=1440; m+=15){
      const hh = String(Math.floor(m/60)).padStart(2,"0");
      const mm = String(m%60).padStart(2,"0");
      out.push(`${hh}:${mm}`);
    }
    return out;
  }

  function fillSelect(sel, opts, value){
    sel.innerHTML = "";
    for(const o of opts){
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    }
    sel.value = value;
  }

  function getDay(date){
    if(!state.days[date]) state.days[date] = { morning:null, afternoon:null };
    return state.days[date];
  }

  function computePart(part){
    if(!part) return { ok:true, workMin:0 };
    const s = hhmmToMin(part.start);
    const e = hhmmToMin(part.end);
    if(e <= s) return { ok:false, workMin:0 };
    const gap = Math.max(0, parseNum(part.gapMin));
    const work = Math.max(0, (e - s) - gap);
    return { ok:true, workMin:work };
  }

  function computeDay(date){
    const d = getDay(date);
    const m = computePart(d.morning);
    const a = computePart(d.afternoon);
    const ok = m.ok && a.ok;

    const workMin = (m.workMin + a.workMin);
    const rate = parseNum(state.settings.hourlyRate);
    const money = (workMin/60) * rate;

    return { ok, workMin, money };
  }

  // ISO week key: YYYY-Www (uso mezzogiorno locale per evitare DST/UTC)
  function isoWeekKey(dateStr){
    const d = new Date(dateStr + "T12:00:00");
    const day = (d.getDay()+6)%7; // Mon=0..Sun=6
    d.setDate(d.getDate() - day + 3); // Thu
    const weekYear = d.getFullYear();
    const firstThu = new Date(weekYear,0,4);
    const firstDay = (firstThu.getDay()+6)%7;
    firstThu.setDate(firstThu.getDate() - firstDay + 3);
    const weekNo = 1 + Math.round((d - firstThu) / (7*86400000));
    return `${weekYear}-W${String(weekNo).padStart(2,"0")}`;
  }

  function totalsForFilter(fn){
    let workMin = 0;
    let money = 0;
    for(const date of Object.keys(state.days)){
      if(!fn(date)) continue;
      const c = computeDay(date);
      workMin += c.workMin;
      money += c.money;
    }
    return { workMin, money };
  }

  function setDate(d){
    currentDate = d;
    const dp = $("#datePicker");
    if (dp) dp.value = currentDate;
    saveState();
    render();
  }

  /* ---------- Modal ---------- */
  function openModal(){
    const day = getDay(currentDate);
    const opts = timeOptions();

    fillSelect($("#mStart"), opts, day.morning?.start || "08:00");
    fillSelect($("#mEnd"),   opts, day.morning?.end   || "12:00");
    fillSelect($("#aStart"), opts, day.afternoon?.start || "14:00");
    fillSelect($("#aEnd"),   opts, day.afternoon?.end   || "18:00");

    $("#mGap").value = (day.morning?.gapMin ?? "");
    $("#aGap").value = (day.afternoon?.gapMin ?? "");

    $("#mEnabled").checked = !!day.morning;
    $("#aEnabled").checked = !!day.afternoon;

    syncEnabledUI();
    updatePreview();

    $("#dayModal").classList.add("show");
  }

  function closeModal(){
    $("#dayModal").classList.remove("show");
  }

  function syncEnabledUI(){
    const mOn = $("#mEnabled").checked;
    const aOn = $("#aEnabled").checked;

    $("#mFields").style.opacity = mOn ? "1" : ".45";
    $("#aFields").style.opacity = aOn ? "1" : ".45";

    $("#mStart").disabled = !mOn;
    $("#mEnd").disabled   = !mOn;
    $("#mGap").disabled   = !mOn;

    $("#aStart").disabled = !aOn;
    $("#aEnd").disabled   = !aOn;
    $("#aGap").disabled   = !aOn;
  }

  function updatePreview(){
    const tmp = {
      morning: $("#mEnabled").checked ? {
        start: $("#mStart").value, end: $("#mEnd").value, gapMin: parseNum($("#mGap").value)
      } : null,
      afternoon: $("#aEnabled").checked ? {
        start: $("#aStart").value, end: $("#aEnd").value, gapMin: parseNum($("#aGap").value)
      } : null
    };

    const m = computePart(tmp.morning);
    const a = computePart(tmp.afternoon);

    if(!m.ok || !a.ok){
      $("#previewHours").textContent = "—";
      $("#previewMoney").textContent = "Orari non validi";
      return;
    }
    const workMin = m.workMin + a.workMin;
    const money = (workMin/60) * parseNum(state.settings.hourlyRate);

    $("#previewHours").textContent = formatHM(workMin);
    $("#previewMoney").textContent = euro(money);
  }

  function saveDay(){
    const day = getDay(currentDate);

    const morning = $("#mEnabled").checked ? {
      start: $("#mStart").value,
      end: $("#mEnd").value,
      gapMin: parseNum($("#mGap").value)
    } : null;

    const afternoon = $("#aEnabled").checked ? {
      start: $("#aStart").value,
      end: $("#aEnd").value,
      gapMin: parseNum($("#aGap").value)
    } : null;

    const cm = computePart(morning);
    const ca = computePart(afternoon);
    if(!cm.ok || !ca.ok){
      alert("Controlla gli orari: la fine deve essere dopo l'inizio (mattina/pomeriggio).");
      return;
    }

    day.morning = morning;
    day.afternoon = afternoon;

    if(!day.morning && !day.afternoon){
      delete state.days[currentDate];
    }

    saveState();
    closeModal();
    render();
  }

  function deleteDay(){
    if(!state.days[currentDate]) return;
    if(!confirm("Cancellare i dati di questa giornata?")) return;
    delete state.days[currentDate];
    saveState();
    render();
  }

  /* ---------- Render ---------- */
  function renderDaySummary(){
    const d = state.days[currentDate];
    const el = $("#daySummary");
    if(!el) return;

    if(!d || (!d.morning && !d.afternoon)){
      el.textContent = "Nessun inserimento per questa data.";
      return;
    }
    const parts = [];
    if(d.morning){
      parts.push(`Mattina: ${d.morning.start}–${d.morning.end} (buco ${d.morning.gapMin||0} min)`);
    }else{
      parts.push("Mattina: —");
    }
    if(d.afternoon){
      parts.push(`Pomeriggio: ${d.afternoon.start}–${d.afternoon.end} (buco ${d.afternoon.gapMin||0} min)`);
    }else{
      parts.push("Pomeriggio: —");
    }
    el.textContent = parts.join(" · ");
  }

  function renderStats(){
    const y = currentDate.slice(0,4);
    const wk = isoWeekKey(currentDate);
    const mk = currentDate.slice(0,7);

    const day = totalsForFilter(d=>d===currentDate);
    const week = totalsForFilter(d=>isoWeekKey(d)===wk);
    const month = totalsForFilter(d=>d.slice(0,7)===mk);
    const year = totalsForFilter(d=>d.slice(0,4)===y);

    $("#dayHours").textContent = formatHM(day.workMin);
    $("#dayMoney").textContent = euro(day.money);

    $("#weekHours").textContent = formatHM(week.workMin);
    $("#weekMoney").textContent = euro(week.money);

    $("#monthHours").textContent = formatHM(month.workMin);
    $("#monthMoney").textContent = euro(month.money);

    $("#yearHours").textContent = formatHM(year.workMin);
    $("#yearMoney").textContent = euro(year.money);
  }

  function render(){
    const dp = $("#datePicker");
    if (dp) dp.value = currentDate;

    const hr = $("#hourlyRate");
    if (hr) hr.value = String(parseNum(state.settings.hourlyRate) || "");

    renderDaySummary();
    renderStats();
  }

  /* ---------- Export XLSX ---------- */
  function exportExcel(){
    if(!window.XLSX){
      alert("Libreria XLSX non caricata. Riprova con connessione attiva (serve per creare il file .xlsx).");
      return;
    }

    const year = currentDate.slice(0,4);
    const rate = parseNum(state.settings.hourlyRate);

    const dates = Object.keys(state.days)
      .filter(d=>d.startsWith(year+"-"))
      .sort();

    const dettaglio = [
      ["Data","M_inizio","M_fine","M_buco_min","P_inizio","P_fine","P_buco_min","Ore_lavorate","Guadagno_EUR"]
    ];

    const daily = new Map();
    const weekMap = new Map();
    const monthMap = new Map();

    for(const date of dates){
      const d = state.days[date];
      const c = computeDay(date);

      const mS = d.morning?.start || "";
      const mE = d.morning?.end || "";
      const mG = d.morning ? (d.morning.gapMin||0) : "";
      const aS = d.afternoon?.start || "";
      const aE = d.afternoon?.end || "";
      const aG = d.afternoon ? (d.afternoon.gapMin||0) : "";

      dettaglio.push([date, mS, mE, mG, aS, aE, aG, c.workMin/60, c.money]);

      if(!daily.has(date)) daily.set(date,{workMin:0,money:0});
      daily.get(date).workMin += c.workMin;
      daily.get(date).money += c.money;

      const wk = isoWeekKey(date);
      if(!weekMap.has(wk)) weekMap.set(wk,{workMin:0,money:0});
      weekMap.get(wk).workMin += c.workMin;
      weekMap.get(wk).money += c.money;

      const mk = date.slice(0,7);
      if(!monthMap.has(mk)) monthMap.set(mk,{workMin:0,money:0});
      monthMap.get(mk).workMin += c.workMin;
      monthMap.get(mk).money += c.money;
    }

    const giornaliero = [["Data","Ore_lavorate","Guadagno_EUR"]];
    Array.from(daily.entries()).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{
      giornaliero.push([k, v.workMin/60, v.money]);
    });

    const settimanale = [["Settimana_ISO","Ore_lavorate","Guadagno_EUR"]];
    Array.from(weekMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{
      settimanale.push([k, v.workMin/60, v.money]);
    });

    const mensile = [["Mese","Ore_lavorate","Guadagno_EUR"]];
    Array.from(monthMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{
      mensile.push([k, v.workMin/60, v.money]);
    });

    const totOreAnno = mensile.slice(1).reduce((a,r)=>a + (Number(r[1])||0), 0);
    const totMoneyAnno = mensile.slice(1).reduce((a,r)=>a + (Number(r[2])||0), 0);

    const riepilogo = [
      ["Anno", year],
      ["Paga_oraria_EUR", rate],
      ["Ore_totali_anno", totOreAnno],
      ["Guadagno_totale_anno_EUR", totMoneyAnno]
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riepilogo), "Riepilogo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mensile), "Mensile");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(settimanale), "Settimanale");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(giornaliero), "Giornaliero");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dettaglio), "Dettaglio");

    XLSX.writeFile(wb, `ContoOre_${year}.xlsx`);
  }

  /* ---------- Wire ---------- */
  function wire(){
    // sovrascrivo eventuali vecchi listener (fix “doppio click”)
    const prev = $("#prevDay");
    const next = $("#nextDay");
    const dp = $("#datePicker");

    // extra robust: se esistono, forzo type=button (evita comportamenti strani)
    if (prev) prev.type = "button";
    if (next) next.type = "button";

    if (dp) {
      dp.onchange = (e) => setDate(e.target.value);
    }

    if (prev) {
      prev.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const base = ($("#datePicker")?.value || currentDate);
        const d = new Date(base + "T12:00:00"); // mezzogiorno locale
        d.setDate(d.getDate() - 1);
        setDate(dateToYMDLocal(d));
      };
    }

    if (next) {
      next.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const base = ($("#datePicker")?.value || currentDate);
        const d = new Date(base + "T12:00:00");
        d.setDate(d.getDate() + 1);
        setDate(dateToYMDLocal(d));
      };
    }

    const hr = $("#hourlyRate");
    if (hr) {
      hr.oninput = (e) => {
        state.settings.hourlyRate = parseNum(e.target.value);
        saveState();
        render();
      };
    }

    const edit = $("#editDayBtn");
    const del = $("#deleteDayBtn");
    if (edit) edit.onclick = openModal;
    if (del) del.onclick = deleteDay;

    const close = $("#closeModal");
    const cancel = $("#cancelModal");
    const modal = $("#dayModal");
    if (close) close.onclick = closeModal;
    if (cancel) cancel.onclick = closeModal;
    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) closeModal();
      };
    }

    const mEn = $("#mEnabled");
    const aEn = $("#aEnabled");
    if (mEn) mEn.onchange = () => { syncEnabledUI(); updatePreview(); };
    if (aEn) aEn.onchange = () => { syncEnabledUI(); updatePreview(); };

    ["mStart","mEnd","aStart","aEnd"].forEach(id=>{
      const el = $("#"+id);
      if (el) el.onchange = updatePreview;
    });
    ["mGap","aGap"].forEach(id=>{
      const el = $("#"+id);
      if (el) el.oninput = updatePreview;
    });

    const saveBtn = $("#saveDay");
    if (saveBtn) saveBtn.onclick = saveDay;

    const exp = $("#exportBtn");
    if (exp) exp.onclick = exportExcel;

    document.onkeydown = (e) => {
      if(e.key==="Escape") closeModal();
    };

    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("./sw.js").catch(()=>{});
    }
  }

  function init(){
    const dp = $("#datePicker");
    if (dp) dp.value = currentDate;
    wire();
    render();
  }

  init();
})();
