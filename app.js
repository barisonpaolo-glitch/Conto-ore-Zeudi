const $ = (sel) => document.querySelector(sel);

const STORAGE_KEY = "conto-ore.v1";

const state = loadState();
let currentDate = state.currentDate || todayYMD();

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

function defaultState(){
  return {
    currentDate: null,
    settings: { hourlyRate: 0 },
    years: {} // { "2026": { days: { "2026-02-16": [shift,...] } } }
  };
}

function saveState(){
  state.currentDate = currentDate;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function yearKeyFromDate(d){ return d.slice(0,4); }
function yearData(y){
  if(!state.years[y]) state.years[y] = { days: {} };
  return state.years[y];
}

function todayYMD(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

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

function timeOptions(){
  const out = [];
  for(let m=0; m<=1440; m+=15){
    out.push(minToHHMM(m));
  }
  return out;
}

function hhmmToMin(hhmm){
  if(!hhmm) return 0;
  const [h,m] = hhmm.split(":").map(Number);
  return (h*60 + m);
}

function minToHHMM(min){
  min = clamp(min,0,1440);
  const h = Math.floor(min/60);
  const m = min%60;
  if(h===24 && m===0) return "24:00";
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function formatHM(minutes){
  minutes = Math.max(0, Math.round(minutes));
  const h = Math.floor(minutes/60);
  const m = minutes%60;
  return `${h}:${String(m).padStart(2,"0")}`;
}

function computeShift(shift){
  const start = hhmmToMin(shift.start);
  const end = hhmmToMin(shift.end);
  if(end <= start) return { ok:false, workMin:0, money:0, breaksMin:0, rate:0 };

  const breaks = (shift.breaks || []).map(b=>{
    const bs = hhmmToMin(b.start);
    const be = hhmmToMin(b.end);
    if(be <= bs) return 0;
    const s = clamp(bs, start, end);
    const e = clamp(be, start, end);
    return Math.max(0, e - s);
  });

  const breaksMin = breaks.reduce((a,b)=>a+b,0);
  const workMin = Math.max(0, (end - start) - breaksMin);

  const rate = (shift.rate===null || shift.rate===undefined || shift.rate==="") ? parseNum(state.settings.hourlyRate) : parseNum(shift.rate);
  const money = (workMin/60) * rate;

  return { ok:true, workMin, breaksMin, rate, money };
}

/* ISO week key: YYYY-Www */
function isoWeekKey(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay()+6)%7; // Mon=0..Sun=6
  d.setDate(d.getDate() - day + 3); // Thu
  const weekYear = d.getFullYear();
  const firstThu = new Date(weekYear,0,4);
  const firstDay = (firstThu.getDay()+6)%7;
  firstThu.setDate(firstThu.getDate() - firstDay + 3);
  const weekNo = 1 + Math.round((d - firstThu) / (7*86400000));
  return `${weekYear}-W${String(weekNo).padStart(2,"0")}`;
}

function allShiftsForYear(year){
  const yd = yearData(year);
  const out = [];
  for(const date of Object.keys(yd.days).sort()){
    for(const sh of (yd.days[date] || [])){
      out.push({ date, ...sh });
    }
  }
  return out;
}

function dayShifts(date){
  const y = yearKeyFromDate(date);
  const yd = yearData(y);
  if(!yd.days[date]) yd.days[date] = [];
  return yd.days[date];
}

function setDate(d){
  currentDate = d;
  $("#datePicker").value = currentDate;
  saveState();
  render();
}

/* ---------- UI ---------- */

let editingIndex = null;

function openShiftModal(index=null){
  editingIndex = index;
  const shifts = dayShifts(currentDate);
  const shift = (index===null) ? newEmptyShift() : JSON.parse(JSON.stringify(shifts[index]));

  $("#shiftTitle").textContent = (index===null) ? "Nuovo turno" : "Modifica turno";

  fillSelect($("#startTime"), timeOptions(), shift.start || "08:00");
  fillSelect($("#endTime"), timeOptions(), shift.end || "17:00");

  $("#shiftRate").value = (shift.rate===null || shift.rate===undefined) ? "" : String(shift.rate);
  $("#shiftNote").value = shift.note || "";

  $("#breakList").innerHTML = "";
  (shift.breaks || []).forEach(b => addBreakRow(b.start, b.end));
  // Se non ci sono pause, non ne aggiungo una “finta”: meno confusione.
  updatePreview();

  $("#shiftModal").classList.add("show");
}

function closeShiftModal(){
  $("#shiftModal").classList.remove("show");
  editingIndex = null;
}

function newEmptyShift(){
  return {
    start:"08:00",
    end:"17:00",
    breaks: [],
    rate: null,
    note:""
  };
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

function addBreakRow(start="12:00", end="12:30"){
  const row = document.createElement("div");
  row.className = "breakRow";

  const sWrap = document.createElement("div");
  const eWrap = document.createElement("div");

  const sLbl = document.createElement("label");
  sLbl.textContent = "Inizio";
  sLbl.className = "lbl";
  const eLbl = document.createElement("label");
  eLbl.textContent = "Fine";
  eLbl.className = "lbl";

  const sSel = document.createElement("select");
  const eSel = document.createElement("select");
  fillSelect(sSel, timeOptions(), start);
  fillSelect(eSel, timeOptions(), end);

  sSel.addEventListener("change", updatePreview);
  eSel.addEventListener("change", updatePreview);

  sWrap.appendChild(sLbl); sWrap.appendChild(sSel);
  eWrap.appendChild(eLbl); eWrap.appendChild(eSel);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "del";
  del.textContent = "🗑";
  del.addEventListener("click", ()=>{
    row.remove();
    updatePreview();
  });

  row.appendChild(sWrap);
  row.appendChild(eWrap);
  row.appendChild(del);

  $("#breakList").appendChild(row);
  updatePreview();
}

function collectBreaks(){
  const rows = Array.from($("#breakList").querySelectorAll(".breakRow"));
  return rows.map(r=>{
    const sels = r.querySelectorAll("select");
    return { start: sels[0].value, end: sels[1].value };
  }).filter(b=>b.start && b.end);
}

function updatePreview(){
  const tmp = {
    start: $("#startTime").value,
    end: $("#endTime").value,
    breaks: collectBreaks(),
    rate: ($("#shiftRate").value.trim()==="") ? null : parseNum($("#shiftRate").value),
    note: $("#shiftNote").value || ""
  };
  const c = computeShift(tmp);
  $("#previewHours").textContent = formatHM(c.workMin);
  $("#previewMoney").textContent = euro(c.money);
}

function saveShift(){
  const shift = {
    start: $("#startTime").value,
    end: $("#endTime").value,
    breaks: collectBreaks(),
    rate: ($("#shiftRate").value.trim()==="") ? null : parseNum($("#shiftRate").value),
    note: $("#shiftNote").value || ""
  };

  const c = computeShift(shift);
  if(!c.ok){
    alert("Controlla orari: l'ora fine deve essere dopo l'ora inizio.");
    return;
  }

  const shifts = dayShifts(currentDate);
  if(editingIndex===null){
    shifts.push(shift);
  }else{
    shifts[editingIndex] = shift;
  }
  saveState();
  closeShiftModal();
  render();
}

function deleteShift(index){
  const shifts = dayShifts(currentDate);
  if(!confirm("Eliminare questo turno?")) return;
  shifts.splice(index,1);
  saveState();
  render();
}

function renderShiftList(){
  const el = $("#shiftList");
  el.innerHTML = "";

  const shifts = dayShifts(currentDate);
  if(shifts.length===0){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "Nessun turno per questa data.";
    el.appendChild(empty);
    return;
  }

  shifts.forEach((sh, i)=>{
    const c = computeShift(sh);

    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    const main = document.createElement("div");
    main.className = "mainline";
    main.textContent = `${sh.start} → ${sh.end}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    const breaksTxt = c.breaksMin>0 ? `Pause: ${formatHM(c.breaksMin)}` : "Pause: 0:00";
    const noteTxt = sh.note ? ` · ${sh.note}` : "";
    meta.textContent = `${breaksTxt} · Lavoro: ${formatHM(c.workMin)} · ${euro(c.money)}${noteTxt}`;

    left.appendChild(main);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "right";

    const btns = document.createElement("div");
    btns.className = "pills";
    const edit = document.createElement("button");
    edit.className = "btn secondary";
    edit.textContent = "Modifica";
    edit.addEventListener("click", ()=>openShiftModal(i));
    const del = document.createElement("button");
    del.className = "btn secondary";
    del.textContent = "Elimina";
    del.addEventListener("click", ()=>deleteShift(i));
    btns.appendChild(edit);
    btns.appendChild(del);

    right.appendChild(btns);

    item.appendChild(left);
    item.appendChild(right);
    el.appendChild(item);
  });
}

function totalsForFilter(fn){
  let workMin = 0;
  let money = 0;
  for(const y of Object.keys(state.years)){
    const yd = state.years[y];
    for(const date of Object.keys(yd.days || {})){
      if(!fn(date)) continue;
      for(const sh of (yd.days[date]||[])){
        const c = computeShift(sh);
        workMin += c.workMin;
        money += c.money;
      }
    }
  }
  return { workMin, money };
}

function renderStats(){
  const y = yearKeyFromDate(currentDate);
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
  $("#datePicker").value = currentDate;
  $("#hourlyRate").value = String(parseNum(state.settings.hourlyRate) || "");
  renderShiftList();
  renderStats();
}

/* ---------- Export XLSX ---------- */

function exportExcel(){
  const year = yearKeyFromDate(currentDate);
  const shifts = allShiftsForYear(year);

  if(!window.XLSX){
    alert("Libreria XLSX non caricata. Serve connessione attiva per creare il file .xlsx (solo al momento dell’export).");
    return;
  }

  const detailRows = [
    ["Data","Inizio","Fine","Pause (min)","Ore lavorate","Paga oraria (€)","Guadagno (€)","Note"]
  ];

  const dailyMap = new Map();
  const weekMap = new Map();
  const monthMap = new Map();

  for(const sh of shifts){
    const c = computeShift(sh);
    const rate = (sh.rate===null || sh.rate===undefined || sh.rate==="") ? parseNum(state.settings.hourlyRate) : parseNum(sh.rate);
    detailRows.push([
      sh.date,
      sh.start,
      sh.end,
      c.breaksMin,
      (c.workMin/60),
      rate,
      c.money,
      sh.note || ""
    ]);

    if(!dailyMap.has(sh.date)) dailyMap.set(sh.date,{workMin:0,money:0});
    dailyMap.get(sh.date).workMin += c.workMin;
    dailyMap.get(sh.date).money += c.money;

    const wKey = isoWeekKey(sh.date);
    if(!weekMap.has(wKey)) weekMap.set(wKey,{workMin:0,money:0});
    weekMap.get(wKey).workMin += c.workMin;
    weekMap.get(wKey).money += c.money;

    const mKey = sh.date.slice(0,7);
    if(!monthMap.has(mKey)) monthMap.set(mKey,{workMin:0,money:0});
    monthMap.get(mKey).workMin += c.workMin;
    monthMap.get(mKey).money += c.money;
  }

  const dailyRows = [["Data","Ore lavorate","Guadagno (€)"]];
  Array.from(dailyMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([d,v])=>{
    dailyRows.push([d, v.workMin/60, v.money]);
  });

  const weeklyRows = [["Settimana (ISO)","Ore lavorate","Guadagno (€)"]];
  Array.from(weekMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{
    weeklyRows.push([k, v.workMin/60, v.money]);
  });

  const monthlyRows = [["Mese","Ore lavorate","Guadagno (€)"]];
  Array.from(monthMap.entries()).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{
    monthlyRows.push([k, v.workMin/60, v.money]);
  });

  const yearTotals = monthlyRows.slice(1).reduce((acc,r)=>acc + (Number(r[1])||0), 0);
  const yearMoney = monthlyRows.slice(1).reduce((acc,r)=>acc + (Number(r[2])||0), 0);

  const summaryRows = [
    ["Anno", year],
    ["Paga oraria globale (€)", parseNum(state.settings.hourlyRate)],
    ["Ore totali anno", yearTotals],
    ["Guadagno totale anno (€)", yearMoney]
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Riepilogo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(monthlyRows), "Mensile");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(weeklyRows), "Settimanale");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyRows), "Giornaliero");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "Dettaglio");

  XLSX.writeFile(wb, `ContoOre_${year}.xlsx`);
}

/* ---------- Wire ---------- */

function wire(){
  $("#datePicker").addEventListener("change", (e)=>setDate(e.target.value));

  $("#prevDay").addEventListener("click", ()=>{
    const d = new Date(currentDate+"T00:00:00");
    d.setDate(d.getDate()-1);
    setDate(d.toISOString().slice(0,10));
  });
  $("#nextDay").addEventListener("click", ()=>{
    const d = new Date(currentDate+"T00:00:00");
    d.setDate(d.getDate()+1);
    setDate(d.toISOString().slice(0,10));
  });

  $("#hourlyRate").addEventListener("input", (e)=>{
    state.settings.hourlyRate = parseNum(e.target.value);
    saveState();
    render();
  });

  $("#addShiftBtn").addEventListener("click", ()=>openShiftModal(null));
  $("#exportBtn").addEventListener("click", exportExcel);

  $("#closeShift").addEventListener("click", closeShiftModal);
  $("#cancelShift").addEventListener("click", closeShiftModal);
  $("#shiftModal").addEventListener("click", (e)=>{
    if(e.target === $("#shiftModal")) closeShiftModal();
  });

  $("#startTime").addEventListener("change", updatePreview);
  $("#endTime").addEventListener("change", updatePreview);
  $("#shiftRate").addEventListener("input", updatePreview);
  $("#shiftNote").addEventListener("input", updatePreview);
  $("#addBreakBtn").addEventListener("click", ()=>addBreakRow("12:00","12:30"));
  $("#saveShift").addEventListener("click", saveShift);

  document.addEventListener("keydown", (e)=>{
    if(e.key==="Escape") closeShiftModal();
  });

  // PWA Service Worker
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

(function init(){
  $("#datePicker").value = currentDate;
  wire();
  render();
})();
