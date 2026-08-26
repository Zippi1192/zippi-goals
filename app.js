'use strict';

const APP_ID='2026-goals';
const APP_VERSION='0.3.0';
const BACKUP_VERSION=1;
const DB_NAME='2026GoalsDB';
const DB_VERSION=3;
const SETTINGS_KEY='2026GoalsSettings_v3';
const LEGACY_V2_KEY='goalTracker2026_v2';
const MONTH_DAYS=[31,28,31,30,31,30,31,31,30,31,30,31];

let db=null;
let state={config:null,daily:{},events:[],monthMemos:Array(12).fill(''),manualProgress:{},lastTouched:{},legacyLists:{},meta:{}};
let settings=loadSettings();
let YEAR=2026;
let DAILY={};
let GOALS=[];
let EVENT_TYPES={};
let QUICK_TYPES=[];
let calCursor=new Date(2026,7,1);
let selectedDate='';
let storyImage=null;
let swRegistration=null;
let waitingWorker=null;
let controllerReloading=false;

function clone(x){return JSON.parse(JSON.stringify(x));}
function loadSettings(){
  try{return Object.assign({lastBackupAt:null,lastBackupFile:null,lastView:'today',legacyV2Migrated:false,backupWarnDays:30,backupUrgentDays:60},JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'));}
  catch(e){return {lastBackupAt:null,lastBackupFile:null,lastView:'today',legacyV2Migrated:false,backupWarnDays:30,backupUrgentDays:60};}
}
function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}
function isoLocal(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}
function dateFromIso(s){const [y,m,d]=String(s).split('-').map(Number);return new Date(y,m-1,d,12);}
function fmtDate(s,opt={month:'long',day:'numeric',weekday:'short'}){return new Intl.DateTimeFormat('ja-JP',opt).format(dateFromIso(s));}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function clamp(v,a=0,b=100){return Math.max(a,Math.min(b,v));}
function uuid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);}
function dayOfYear(d){const start=new Date(d.getFullYear(),0,0);return Math.floor((d-start)/86400000);}
function daysInYear(y){return ((y%4===0&&y%100!==0)||y%400===0)?366:365;}
function nowForYear(){const n=new Date();return n.getFullYear()===YEAR?n:new Date(YEAR,7,26,12);}
function daysBetween(a,b){return Math.floor((b-a)/86400000);}
function hasConfig(){return !!(state.config&&Array.isArray(state.config.goals)&&state.config.goals.length);}
function applyConfig(){
  const c=state.config||{};
  YEAR=+c.year||2026;
  DAILY=c.daily||{};
  GOALS=Array.isArray(c.goals)?c.goals:[];
  EVENT_TYPES=c.eventTypes||{};
  QUICK_TYPES=Array.isArray(c.quickTypes)?c.quickTypes:[];
  const n=nowForYear();
  if(!selectedDate)selectedDate=isoLocal(n);
  if(calCursor.getFullYear()!==YEAR)calCursor=new Date(YEAR,n.getMonth(),1);
  document.title=c.appTitle||'2026 GOALS';
  document.querySelector('.brand h1').textContent=c.appTitle||'2026 GOALS';
  document.querySelector('.brand-mark').textContent=String(YEAR).slice(-2);
  document.getElementById('goalsHeading').textContent=`${GOALS.length} GOALS`;
}

// ---------- IndexedDB ----------
function openDatabase(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=req.result,old=e.oldVersion;
      if(old<1){
        d.createObjectStore('config',{keyPath:'key'});
        d.createObjectStore('daily',{keyPath:'date'});
        const ev=d.createObjectStore('events',{keyPath:'id'});
        ev.createIndex('date','date',{unique:false});
        ev.createIndex('goalId','goalId',{unique:false});
        d.createObjectStore('monthMemos',{keyPath:'month'});
        d.createObjectStore('meta',{keyPath:'key'});
      }
      if(old>=1&&old<2){
        const ev=req.transaction.objectStore('events');
        if(!ev.indexNames.contains('date'))ev.createIndex('date','date',{unique:false});
        if(!ev.indexNames.contains('goalId'))ev.createIndex('goalId','goalId',{unique:false});
      }
      if(old<3){
        const ev=req.transaction.objectStore('events');
        if(!ev.indexNames.contains('type'))ev.createIndex('type','type',{unique:false});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error('データベース更新がブロックされています。古いタブやPWAを閉じてください。'));
  });
}
function reqPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function txPromise(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('transaction aborted'));});}
async function loadStateFromDb(){
  const tx=db.transaction(['config','daily','events','monthMemos','meta'],'readonly');
  // Queue all reads before awaiting so Safari does not auto-close the transaction between requests.
  const configReq=tx.objectStore('config').getAll();
  const dailyReq=tx.objectStore('daily').getAll();
  const eventsReq=tx.objectStore('events').getAll();
  const memoReq=tx.objectStore('monthMemos').getAll();
  const metaReq=tx.objectStore('meta').getAll();
  const [configRows,dailyRows,events,memoRows,metaRows]=await Promise.all([configReq,dailyReq,eventsReq,memoReq,metaReq].map(reqPromise));
  const meta=Object.fromEntries(metaRows.map(x=>[x.key,x.value]));
  const daily={}; dailyRows.forEach(r=>daily[r.date]=r.values||{});
  const monthMemos=Array(12).fill('');memoRows.forEach(r=>{if(r.month>=0&&r.month<12)monthMemos[r.month]=r.text||'';});
  return {
    config:configRows.find(x=>x.key==='main')?.value||null,
    daily,
    events:Array.isArray(events)?events:[],
    monthMemos,
    manualProgress:meta.manualProgress||{},
    lastTouched:meta.lastTouched||{},
    legacyLists:meta.legacyLists||{},
    meta:meta.appMeta||{}
  };
}
function persistAllState(){
  const tx=db.transaction(['config','daily','events','monthMemos','meta'],'readwrite');
  const cs=tx.objectStore('config'),ds=tx.objectStore('daily'),es=tx.objectStore('events'),ms=tx.objectStore('monthMemos'),meta=tx.objectStore('meta');
  cs.clear();ds.clear();es.clear();ms.clear();meta.clear();
  if(state.config)cs.put({key:'main',value:clone(state.config)});
  Object.entries(state.daily||{}).forEach(([date,values])=>ds.put({date,values:clone(values)}));
  (state.events||[]).forEach(e=>es.put(clone(e)));
  (state.monthMemos||[]).forEach((text,month)=>ms.put({month,text:text||''}));
  meta.put({key:'manualProgress',value:clone(state.manualProgress||{})});
  meta.put({key:'lastTouched',value:clone(state.lastTouched||{})});
  meta.put({key:'legacyLists',value:clone(state.legacyLists||{})});
  meta.put({key:'appMeta',value:Object.assign({},state.meta||{},{schemaVersion:DB_VERSION,updatedAt:new Date().toISOString()})});
  return txPromise(tx);
}
async function saveState(msg){
  try{await persistAllState();if(msg)toast(msg);}
  catch(e){console.error(e);alert('保存に失敗しました。バックアップを取り、アプリを再起動してください。');}
}
async function wipeDatabase(){
  state={config:null,daily:{},events:[],monthMemos:Array(12).fill(''),manualProgress:{},lastTouched:{},legacyLists:{},meta:{}};
  await persistAllState();
}

// ---------- Backup / restore ----------
function backupObject(kind='backup'){
  return {
    app:APP_ID,
    kind,
    backupVersion:BACKUP_VERSION,
    appVersion:APP_VERSION,
    schemaVersion:DB_VERSION,
    exportedAt:new Date().toISOString(),
    payload:{
      config:clone(state.config),
      daily:clone(state.daily),
      events:clone(state.events),
      monthMemos:clone(state.monthMemos),
      manualProgress:clone(state.manualProgress),
      lastTouched:clone(state.lastTouched),
      legacyLists:clone(state.legacyLists),
      meta:clone(state.meta)
    },
    settings:{backupWarnDays:settings.backupWarnDays,backupUrgentDays:settings.backupUrgentDays}
  };
}
function backupFilename(obj){const d=new Date(obj.exportedAt);const p=n=>String(n).padStart(2,'0');return `2026-goals-backup-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.json`;}
async function saveBackupFile({forUpdate=false}={}){
  if(!hasConfig()){toast('先に初期データを読み込んでください');return false;}
  const obj=backupObject('backup');
  const name=backupFilename(obj);
  const file=new File([JSON.stringify(obj,null,2)],name,{type:'application/json'});
  let saved=false;
  try{
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],title:'2026 GOALS バックアップ',text:'「ファイルに保存」からiCloud Driveへ保存できます。'});
      saved=true;
    }else{
      const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);saved=true;
      if(forUpdate)alert('バックアップJSONを保存しました。ファイルアプリ / ダウンロード先に残っていることを確認してください。');
    }
  }catch(e){if(e?.name!=='AbortError')console.error(e);return false;}
  if(saved){settings.lastBackupAt=obj.exportedAt;settings.lastBackupFile=name;saveSettings();renderBackupNotices();toast('バックアップを保存しました');}
  return saved;
}
function validateImport(obj){
  if(!obj||obj.app!==APP_ID||!obj.payload)throw new Error('2026 GOALS用のJSONではありません');
  if(!obj.payload.config||!Array.isArray(obj.payload.config.goals))throw new Error('目標設定が含まれていません');
  return obj;
}
async function restoreObject(obj,{initial=false}={}){
  validateImport(obj);
  state={
    config:clone(obj.payload.config),
    daily:clone(obj.payload.daily||{}),
    events:clone(obj.payload.events||[]),
    monthMemos:Array.isArray(obj.payload.monthMemos)?clone(obj.payload.monthMemos).slice(0,12):Array(12).fill(''),
    manualProgress:clone(obj.payload.manualProgress||{}),
    lastTouched:clone(obj.payload.lastTouched||{}),
    legacyLists:clone(obj.payload.legacyLists||{}),
    meta:Object.assign({},clone(obj.payload.meta||{}),{restoredAt:new Date().toISOString(),sourceKind:obj.kind||'backup'})
  };
  while(state.monthMemos.length<12)state.monthMemos.push('');
  await persistAllState();
  applyConfig();
  if(obj.kind==='backup'){settings.lastBackupAt=obj.exportedAt||new Date().toISOString();settings.lastBackupFile='復元したバックアップ';saveSettings();}
  document.getElementById('setupOverlay').classList.remove('open');
  renderAll();
  renderBackupNotices();
  if(initial)await offerLegacyV2Migration();
}
async function readJsonFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{try{resolve(JSON.parse(r.result));}catch(e){reject(e);}};r.onerror=()=>reject(r.error);r.readAsText(file);});}
async function handleImportFile(file,{initial=false}={}){
  try{
    const obj=validateImport(await readJsonFile(file));
    const msg=obj.kind==='seed'?'初期データを読み込みます。':'現在のデータをバックアップ内容で置き換えます。';
    if(!initial&&!confirm(`${msg}\nよろしいですか？`))return;
    await restoreObject(obj,{initial});
    toast(obj.kind==='seed'?'初期データを読み込みました':'バックアップから復元しました');
  }catch(e){console.error(e);alert(`読み込めませんでした。\n${e.message||'JSON形式を確認してください。'}`);}
}
function backupAgeDays(){if(!settings.lastBackupAt)return Infinity;return Math.max(0,Math.floor((Date.now()-new Date(settings.lastBackupAt).getTime())/86400000));}
function backupStatusText(){
  const age=backupAgeDays();
  if(!Number.isFinite(age))return {level:'urgent',title:'バックアップ未作成',detail:'最初のバックアップをiCloud Driveへ保存しておくと安心です。'};
  if(age>=settings.backupUrgentDays)return {level:'urgent',title:`最終バックアップから${age}日`,detail:'更新前にバックアップ推奨。'};
  if(age>=settings.backupWarnDays)return {level:'warn',title:`最終バックアップから${age}日`,detail:'そろそろ月次バックアップを保存しましょう。'};
  return {level:'good',title:`バックアップ ${age}日前`,detail:settings.lastBackupFile||'保存済み'};
}
function renderBackupNotices(){
  ['todayBackupNotice','monthlyBackupNotice'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    if(!hasConfig()){el.innerHTML='';return;}
    const s=backupStatusText();
    if(s.level==='good'){el.innerHTML='';return;}
    el.innerHTML=`<div class="backup-notice ${s.level==='urgent'?'urgent':''}"><div><b>${esc(s.title)}</b>${esc(s.detail)}</div><button class="backup-now">保存</button></div>`;
    el.querySelector('.backup-now').onclick=()=>saveBackupFile();
  });
}

// ---------- Legacy v0.2 migration ----------
function getLegacyV2(){try{const x=JSON.parse(localStorage.getItem(LEGACY_V2_KEY)||'null');return x&&x.version===2?x:null;}catch(e){return null;}}
async function offerLegacyV2Migration(){
  const old=getLegacyV2();if(!old||settings.legacyV2Migrated||!hasConfig())return;
  const hasUseful=(old.events&&old.events.length)||Object.keys(old.daily||{}).length||(old.monthMemos||[]).some(Boolean);
  if(!hasUseful)return;
  if(confirm('同じPWA内にv0.2の追加記録が見つかりました。IndexedDBへ移行しますか？\n基準値は増やさず、日次・イベント・月次メモだけを引き継ぎます。'))await migrateLegacyV2();
}
async function migrateLegacyV2(){
  const old=getLegacyV2();if(!old){toast('v0.2データは見つかりません');return;}
  Object.entries(old.daily||{}).forEach(([date,rec])=>state.daily[date]=Object.assign({},state.daily[date]||{},rec));
  const ids=new Set(state.events.map(e=>e.id));(old.events||[]).forEach(e=>{if(!ids.has(e.id))state.events.push(e);});
  (old.monthMemos||[]).forEach((m,i)=>{if(m&&!state.monthMemos[i])state.monthMemos[i]=m;});
  state.manualProgress=Object.assign({},state.manualProgress,old.manualProgress||{});
  state.lastTouched=Object.assign({},state.lastTouched,old.lastTouched||{});
  state.legacyLists=Object.assign({},state.legacyLists,old.legacyLists||{});
  settings.legacyV2Migrated=true;saveSettings();await saveState('v0.2の記録をIndexedDBへ移行しました');renderAll();
}

// ---------- Domain logic ----------
function goalById(id){return GOALS.find(g=>g.id===id);}
function eventsForGoal(id){return state.events.filter(e=>+e.goalId===+id);}
function eventsOn(date){return state.events.filter(e=>e.date===date).sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));}
function dailyState(date,key){return state.daily[date]?.[key]||null;}
async function setDaily(date,key,val){state.daily[date]=state.daily[date]||{};if(val)state.daily[date][key]=val;else delete state.daily[date][key];await saveState();renderAll();}
function cycleDaily(date,key){const cur=dailyState(date,key),next=cur===null?'yes':cur==='yes'?'no':null;setDaily(date,key,next);}
function legacyMonthTotal(key,throughMonth=11){const legacy=DAILY[key]?.legacy||[];let success=0,total=0;for(let i=0;i<=throughMonth;i++){if(Number.isFinite(+legacy[i])){success+=+legacy[i];total+=MONTH_DAYS[i];}}return {success,total};}
function firstLogMonth(key){const legacy=DAILY[key]?.legacy||[];let i=0;while(i<12&&Number.isFinite(+legacy[i]))i++;return i;}
function habitCounts(key,throughDate=isoLocal(nowForYear())){
  const through=dateFromIso(throughDate),throughMi=through.getMonth();
  const legacy=legacyMonthTotal(key,throughMi);
  let success=legacy.success,total=legacy.total;
  const startMi=firstLogMonth(key);
  if(throughMi<startMi)return {success,total,rate:total?success/total*100:0};
  const start=new Date(YEAR,startMi,1,12);const end=new Date(Math.min(through.getTime(),new Date(YEAR,11,31,12).getTime()));
  if(end>=start)total+=daysBetween(start,end)+1;
  for(const [date,rec] of Object.entries(state.daily)){const d=dateFromIso(date);if(d>=start&&d<=end&&rec[key]==='yes')success++;}
  return {success,total,rate:total?success/total*100:0};
}
function monthHabitAggregate(key,mi){
  const legacy=DAILY[key]?.legacy||[];
  if(Number.isFinite(+legacy[mi])){const success=+legacy[mi],total=MONTH_DAYS[mi];return {success,total,rate:success/total*100,source:'legacy'};}
  let success=0;for(let d=1;d<=MONTH_DAYS[mi];d++){const iso=isoLocal(new Date(YEAR,mi,d,12));if(dailyState(iso,key)==='yes')success++;}
  const now=nowForYear();let total=MONTH_DAYS[mi];if(mi===now.getMonth())total=now.getDate();if(mi>now.getMonth())total=0;
  return {success,total,rate:total?success/total*100:0,source:'daily'};
}
function latestEvent(id){return eventsForGoal(id).slice().sort((a,b)=>(b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')))[0]||null;}
function goalMetric(g){
  if(!g)return {pct:0,text:'-'};
  if(g.kind==='count'){const add=eventsForGoal(g.id).filter(e=>e.counted!==false).length,current=(g.base||0)+add;return {current,target:g.target,pct:g.target?clamp(current/g.target*100):0,text:`${current}/${g.target}${g.unit||''}`};}
  if(g.kind==='one'){const done=eventsForGoal(g.id).some(e=>e.complete===true);const current=(g.base||0)+(done?1:0);return {current,target:g.target,pct:g.target?clamp(current/g.target*100):0,text:`${current}/${g.target}${g.unit||''}`};}
  if(g.kind==='escape'){const es=eventsForGoal(g.id).filter(e=>e.counted!==false);const success=(g.baseSuccess||0)+es.filter(e=>e.result==='success').length,total=(g.baseTotal||0)+es.length,rate=total?success/total*100:0;return {current:rate,target:g.target,pct:g.target?clamp(rate/g.target*100):0,text:`${success}/${total} · ${rate.toFixed(1)}%`};}
  if(g.kind==='habit'){const h=habitCounts(g.habit);return {current:h.rate,target:g.target,pct:g.target?clamp(h.rate/g.target*100):0,text:`${h.success}/${h.total} · ${h.rate.toFixed(0)}%`};}
  if(g.kind==='lower'){const es=eventsForGoal(g.id).filter(e=>Number.isFinite(+e.value));if(!es.length)return {current:null,target:g.target,pct:0,text:'未記録'};const best=Math.min(...es.map(e=>+e.value));return {current:best,target:g.target,pct:clamp(g.target/best*100),text:`BEST ${best}${g.unit||''}`};}
  if(g.kind==='range'){const e=latestEvent(g.id);if(!e||!Number.isFinite(+e.value))return {current:null,pct:0,text:'未記録'};const v=+e.value,pct=v>=g.min&&v<=g.max?100:clamp(100-Math.min(Math.abs(v-g.min),Math.abs(v-g.max))*20);return {current:v,pct,text:`${v.toFixed(1)}${g.unit||''}`};}
  if(g.kind==='manual'){const es=eventsForGoal(g.id).filter(e=>Number.isFinite(+e.progress));const latest=es.slice().sort((a,b)=>(b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')))[0];const p=latest?+latest.progress:+(state.manualProgress[g.id]??g.baseProgress??0);return {current:p,pct:clamp(p),text:`進捗 ${p}%`};}
  return {pct:0,text:'-'};
}
function eventLabel(e){const t=EVENT_TYPES[e.type]||{label:'記録',emoji:'•'};let detail='';if(t.fields==='escape')detail=e.result==='success'?'成功':'失敗';else if(['score','minutes','weight'].includes(t.fields))detail=`${e.value}${t.valueUnit||''}`;else if(e.complete)detail='完了';else if(Number.isFinite(+e.progress))detail=`${e.progress}%`;else detail=e.title||e.name||'';return {emoji:t.emoji||'•',label:t.label||'記録',detail};}

// ---------- Rendering ----------
function renderAll(){if(!hasConfig())return;renderHeader();renderToday();renderCalendar();renderGoals();renderMonthly();renderBackupNotices();}
function renderHeader(){const d=nowForYear();document.getElementById('headerSub').textContent=`${d.getMonth()+1}月${d.getDate()}日 · IndexedDB保存 · v${APP_VERSION}`;}
function renderToday(){
  const today=isoLocal(nowForYear()),d=dateFromIso(today);selectedDate=selectedDate||today;
  document.getElementById('todayDateLabel').textContent=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(d);
  document.getElementById('todayGreeting').textContent='TODAY';document.getElementById('yearDays').textContent=`今年 ${dayOfYear(d)} / ${daysInYear(YEAR)}日`;
  let yes=0;const entries=Object.entries(DAILY);document.getElementById('todayDaily').innerHTML=entries.map(([key,x])=>{const st=dailyState(today,key);if(st==='yes')yes++;return dailyRowHtml(today,key,x,st);}).join('');
  document.getElementById('todayDone').textContent=`今日 ○ ${yes}/${entries.length}`;
  document.querySelectorAll('#todayDaily .state-toggle').forEach(b=>b.onclick=()=>cycleDaily(today,b.dataset.key));
  renderWeek();renderQuick();renderTodayEvents();
}
function dailyRowHtml(date,key,x,st){const label=st==='yes'?'○':st==='no'?'×':'未';return `<div class="daily-row"><div class="emoji">${x.emoji||'✓'}</div><div><b>${esc(x.label||key)}</b><small>${st==='yes'?'記録済み':st==='no'?'やってない':'まだ未記録'}</small></div><button class="state-toggle ${st||''}" data-key="${esc(key)}" data-date="${date}">${label}</button></div>`;}
function renderWeek(){
  const now=nowForYear(),dow=now.getDay(),diff=dow===0?-6:1-dow,start=new Date(now);start.setDate(now.getDate()+diff);start.setHours(12,0,0,0);
  document.getElementById('weekProgress').innerHTML=Object.entries(DAILY).map(([key,x])=>{let n=0;for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);if(d<=now&&dailyState(isoLocal(d),key)==='yes')n++;}const target=+x.weeklyTarget||4,left=Math.max(0,target-n),p=Math.min(n/target*100,100);return `<div class="week-card"><small>${x.emoji||'✓'} ${esc(x.label||key)}</small><div class="big">${n}/${target}</div><div class="bar"><i style="width:${p}%"></i></div><small>${left?`あと${left}回`:'達成 ✓'}</small></div>`;}).join('');
}
function renderQuick(){const ids=state.config.quickGoalIds||GOALS.filter(g=>g.quick).map(g=>g.id);const cards=ids.map(id=>goalById(id)).filter(Boolean);document.getElementById('quickProgress').innerHTML=cards.map(g=>{const m=goalMetric(g);return `<div class="progress-card"><div class="progress-top"><b>${esc(g.shortTitle||g.title)}</b><span class="progress-icon">${EVENT_TYPES[g.eventType]?.emoji||'🎯'}</span></div><div class="progress-val">${esc(m.text)}</div><small>${m.pct>=100?'達成 ✓':`目標進捗 ${Math.round(m.pct)}%`}</small></div>`;}).join('')||'<div class="card empty">クイック表示の目標なし</div>';}
function renderTodayEvents(){const today=isoLocal(nowForYear()),es=eventsOn(today);document.getElementById('todayEvents').innerHTML=es.length?es.map(eventRowHtml).join(''):`<div class="card empty">今日はまだイベント記録なし。<br>DAILYだけで終わってOK。</div>`;bindEventEdit('#todayEvents');}
function eventRowHtml(e){const l=eventLabel(e);return `<div class="event-row"><div class="ei">${l.emoji}</div><div class="main"><b>${esc(e.title||e.name||l.label)}</b><small>${esc(l.detail)}${e.note?` · ${esc(e.note)}`:''}</small></div><button class="mini-btn edit-event" data-id="${esc(e.id)}">修正</button></div>`;}
function bindEventEdit(scope){document.querySelectorAll(`${scope} .edit-event`).forEach(b=>b.onclick=()=>openEventForm(state.events.find(e=>e.id===b.dataset.id)?.type,undefined,b.dataset.id));}
function renderCalendar(){
  const y=calCursor.getFullYear(),m=calCursor.getMonth();document.getElementById('calTitle').textContent=`${y}年 ${m+1}月`;
  const first=new Date(y,m,1,12),start=new Date(y,m,1-first.getDay(),12),today=nowForYear();let html='';
  const dailyKeys=Object.keys(DAILY).slice(0,4);
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const iso=isoLocal(d),other=d.getMonth()!==m,st=state.daily[iso]||{},ev=eventsOn(iso).length,future=d>today;
    const dots=dailyKeys.map(k=>`<i class="dot ${st[k]==='yes'?'on':st[k]==='no'?'off':''}"></i>`).join('');
    html+=`<button class="day ${other?'other':''} ${iso===isoLocal(today)?'today':''} ${iso===selectedDate?'selected':''} ${future?'future':''}" data-date="${iso}"><span class="day-num">${d.getDate()}</span><span class="dots">${dots}${ev?'<i class="dot event"></i>':''}</span>${state.lastTouched[iso]?'<span class="touchmark">記録</span>':''}</button>`;
  }
  document.getElementById('calendarGrid').innerHTML=html;document.querySelectorAll('#calendarGrid .day').forEach(b=>b.onclick=()=>{selectedDate=b.dataset.date;const d=dateFromIso(selectedDate);calCursor=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar();openDateSheet(selectedDate);});
}
function openDateSheet(date){
  const future=dateFromIso(date)>nowForYear(),mi=dateFromIso(date).getMonth();const daily=Object.entries(DAILY).map(([key,x])=>dailyRowHtml(date,key,x,dailyState(date,key))).join(''),es=eventsOn(date);
  const legacyNote=Object.values(DAILY).some(x=>Number.isFinite(+x.legacy?.[mi]))?'<div class="install-note">この月の習慣率は旧メモの月間集計値を基準にしています。ここで日次ログを追記しても、その月の既存集計値は二重計上防止のため変更しません。</div>':'';
  const html=`<div class="sheet-title"><div><h2>${fmtDate(date)}</h2><span class="badge ${state.lastTouched[date]?'good':''}">${state.lastTouched[date]?'記録済み':'未確定'}</span></div><button class="sheet-close" data-close>×</button></div>${future?'<div class="install-note">未来の日付です。予定ログは追加できますが、日次チェックは通常は当日に記録してください。</div>':''}${legacyNote}<div class="section-head"><div><h2>DAILY</h2><p>未記録・○・×を個別に変更できます。</p></div></div><div class="daily-list" id="sheetDaily">${daily}</div><button class="primary blue" id="saveDateTouch">この日の記録を保存</button><div class="section-head"><div><h2>EVENT</h2><p>この日に起きたこと。</p></div><button class="link-btn" id="addToDate">＋追加</button></div><div id="sheetEvents" class="event-list">${es.length?es.map(eventRowHtml).join(''):'<div class="card empty">イベントなし</div>'}</div>`;
  openSheet(html);document.querySelectorAll('#sheetDaily .state-toggle').forEach(b=>b.onclick=async()=>{const cur=dailyState(date,b.dataset.key),next=cur===null?'yes':cur==='yes'?'no':null;state.daily[date]=state.daily[date]||{};if(next)state.daily[date][b.dataset.key]=next;else delete state.daily[date][b.dataset.key];await saveState();renderAll();openDateSheet(date);});
  document.getElementById('saveDateTouch').onclick=async()=>{state.lastTouched[date]=new Date().toISOString();await saveState('この日の記録を保存しました');renderAll();openDateSheet(date);};
  document.getElementById('addToDate').onclick=()=>openAddChooser(date);bindEventEdit('#sheetEvents');
}
function renderGoals(){document.getElementById('goalsList').innerHTML=GOALS.map(g=>{const m=goalMetric(g),done=m.pct>=100;return `<button class="goal-card" data-goal="${g.id}"><div class="goal-head"><div class="goal-num">${String(g.id).padStart(2,'0')}</div><div style="min-width:0"><div class="goal-title">${esc(g.title)}</div><div class="goal-detail">${esc(g.detail||'')}</div></div><div class="goal-right"><div class="goal-value">${esc(m.text)}</div><div class="goal-pct">${Math.round(m.pct)}%</div></div></div><div class="goal-bar"><i class="${done?'done':''}" style="width:${Math.min(m.pct,100)}%"></i></div></button>`;}).join('');document.querySelectorAll('.goal-card').forEach(b=>b.onclick=()=>openGoalSheet(+b.dataset.goal));}
function openGoalSheet(id){const g=goalById(id);if(!g)return;const m=goalMetric(g),es=eventsForGoal(id).slice().sort((a,b)=>(b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||''))),legacy=g.eventType&&state.legacyLists[g.eventType];const html=`<div class="sheet-title"><div><h2>${String(id).padStart(2,'0')} ${esc(g.title)}</h2><span class="badge ${m.pct>=100?'good':''}">${esc(m.text)}</span></div><button class="sheet-close" data-close>×</button></div><div class="card"><div class="goal-detail">${esc(g.detail||'')}</div><div class="progress-val" style="font-size:30px">${Math.round(m.pct)}%</div><div class="bar"><i style="width:${Math.min(100,m.pct)}%"></i></div></div>${g.eventType?'<button class="primary blue" id="goalAdd">＋ この目標を更新</button>':''}<div class="section-head"><div><h2>更新履歴</h2><p>新しく追加したログ。</p></div></div><div id="goalEvents" class="event-list">${es.length?es.map(eventRowHtml).join(''):'<div class="card empty">新しいログはまだありません</div>'}</div>${legacy?`<div class="section-head"><div><h2>これまでのメモ</h2><p>旧メモから引き継いだ参考リスト。集計は基準値に含まれています。</p></div></div><div class="card small-text">${legacy.slice(0,80).map(x=>esc(x)).join('<br>')}</div>`:''}`;openSheet(html);if(document.getElementById('goalAdd'))document.getElementById('goalAdd').onclick=()=>openEventForm(g.eventType,isoLocal(nowForYear()));bindEventEdit('#goalEvents');}
function openAddChooser(date=isoLocal(nowForYear())){const validQuick=QUICK_TYPES.filter(k=>EVENT_TYPES[k]);const quick=validQuick.map(k=>{const t=EVENT_TYPES[k];return `<button class="action-chip choose-type" data-type="${esc(k)}"><span>${t.emoji||'＋'}</span>${esc(t.label||k)}</button>`;}).join('');const rest=Object.keys(EVENT_TYPES).filter(k=>!validQuick.includes(k)).map(k=>{const t=EVENT_TYPES[k];return `<button class="action-chip choose-type" data-type="${esc(k)}"><span>${t.emoji||'＋'}</span>${esc(t.label||k)}</button>`;}).join('');openSheet(`<div class="sheet-title"><div><h2>＋ 記録を追加</h2><span class="badge">${fmtDate(date,{month:'numeric',day:'numeric'})}</span></div><button class="sheet-close" data-close>×</button></div><div class="section-head"><div><h2>よく使う</h2></div></div><div class="action-grid">${quick||'<div class="small-text">設定なし</div>'}</div><div class="section-head"><div><h2>その他</h2></div></div><div class="action-grid">${rest}</div>`);document.querySelectorAll('.choose-type').forEach(b=>b.onclick=()=>openEventForm(b.dataset.type,date));}
function openEventForm(type,date=isoLocal(nowForYear()),editId=null){
  const t=EVENT_TYPES[type];if(!t)return;const e=editId?state.events.find(x=>x.id===editId):null;date=e?.date||date;let fields='';const titleVal=esc(e?.title||''),noteVal=esc(e?.note||'');
  if(t.fields==='title')fields=`<div class="field"><label>タイトル</label><input id="evTitle" value="${titleVal}" placeholder="作品名"></div>`;
  if(t.fields==='friend')fields=`<div class="field"><label>名前</label><input id="evName" value="${esc(e?.name||'')}" placeholder="名前"></div><div class="field"><label>きっかけ / グループ</label><input id="evGroup" value="${esc(e?.group||'')}" placeholder="きっかけ、グループなど"></div>`;
  if(t.fields==='escape')fields=`<div class="field"><label>公演名</label><input id="evTitle" value="${titleVal}" placeholder="公演名"></div><div class="field"><label>結果</label><select id="evResult"><option value="success" ${e?.result==='success'?'selected':''}>○ 成功</option><option value="fail" ${e?.result==='fail'?'selected':''}>× 失敗</option></select></div><label class="check-row"><input id="evCounted" type="checkbox" ${e?.counted===false?'':'checked'}><span>成功率にカウントする</span></label>`;
  if(t.fields==='score')fields=`<div class="field"><label>${esc(t.valueLabel||'スコア')}</label><input id="evValue" type="number" inputmode="numeric" value="${e?.value??''}" placeholder="${esc(t.placeholder||'')}" ></div>`;
  if(t.fields==='weight')fields=`<div class="field"><label>${esc(t.valueLabel||'体重')}</label><input id="evValue" type="number" inputmode="decimal" step="0.1" value="${e?.value??''}" placeholder="${esc(t.placeholder||'')}" ></div>`;
  if(t.fields==='minutes')fields=`<div class="field"><label>${esc(t.valueLabel||'タイム（分）')}</label><input id="evValue" type="number" inputmode="decimal" step="0.1" value="${e?.value??''}" placeholder="${esc(t.placeholder||'')}" ></div>`;
  if(t.fields==='progress')fields=`<div class="field"><label>今回のメモ / 内容</label><input id="evTitle" value="${titleVal}" placeholder="${esc(t.placeholder||'内容')}"></div><div class="field"><label>この時点の進捗 %</label><input id="evProgress" type="number" min="0" max="100" inputmode="numeric" value="${e?.progress??''}" placeholder="50"></div>`;
  if(t.fields==='complete')fields=`<div class="field"><label>内容</label><input id="evTitle" value="${titleVal}" placeholder="何を達成したか"></div><label class="check-row"><input id="evComplete" type="checkbox" ${e?.complete?'checked':''}><span>完了としてカウントする</span></label>`;
  const html=`<div class="sheet-title"><div><h2>${t.emoji||'＋'} ${editId?'記録を修正':esc(t.label||type)+'を追加'}</h2></div><button class="sheet-close" data-close>×</button></div><div class="card"><div class="field"><label>日付</label><input id="evDate" type="date" value="${date}" min="${YEAR}-01-01" max="${YEAR}-12-31"></div>${fields}<div class="field"><label>メモ（任意）</label><textarea id="evNote" placeholder="ひとこと">${noteVal}</textarea></div><div class="actions"><button class="secondary" id="saveEventBtn">${editId?'更新':'保存'}</button>${editId?'<button class="danger" id="deleteEventBtn">削除</button>':''}</div></div>`;openSheet(html);
  document.getElementById('saveEventBtn').onclick=async()=>{const obj=e||{id:uuid(),type,goalId:t.goalId,createdAt:new Date().toISOString()};obj.date=document.getElementById('evDate').value;obj.note=document.getElementById('evNote').value.trim();if(document.getElementById('evTitle'))obj.title=document.getElementById('evTitle').value.trim();if(document.getElementById('evName'))obj.name=document.getElementById('evName').value.trim();if(document.getElementById('evGroup'))obj.group=document.getElementById('evGroup').value.trim();if(document.getElementById('evResult'))obj.result=document.getElementById('evResult').value;if(document.getElementById('evCounted'))obj.counted=document.getElementById('evCounted').checked;if(document.getElementById('evValue'))obj.value=+document.getElementById('evValue').value;if(document.getElementById('evProgress'))obj.progress=clamp(+document.getElementById('evProgress').value);if(document.getElementById('evComplete'))obj.complete=document.getElementById('evComplete').checked;if(!editId)state.events.push(obj);await saveState(editId?'更新しました':'追加しました');closeSheet();renderAll();};
  if(editId)document.getElementById('deleteEventBtn').onclick=async()=>{if(confirm('この記録を削除しますか？')){state.events=state.events.filter(x=>x.id!==editId);await saveState('削除しました');closeSheet();renderAll();}};
}
function renderMonthly(){
  const sel=document.getElementById('summaryMonth');if(!sel.options.length)sel.innerHTML=Array.from({length:12},(_,i)=>`<option value="${i}">${i+1}月</option>`).join('');if(sel.dataset.init!=='1'){sel.value=nowForYear().getMonth();sel.dataset.init='1';}const mi=+sel.value;
  document.getElementById('monthlyHabits').innerHTML=Object.entries(DAILY).map(([key,x])=>{const a=monthHabitAggregate(key,mi);return `<div class="month-habit"><div class="month-habit-top"><div><b>${x.emoji||'✓'} ${esc(x.label||key)}</b><br><small>${a.source==='legacy'?'既存の月間集計から':'日次ログから'}</small></div><strong>${a.total?Math.round(a.rate):0}%</strong></div><div class="bar" style="margin-top:9px"><i style="width:${Math.min(a.rate,100)}%"></i></div><small>${a.success}/${a.total||0}日</small></div>`;}).join('');
  const counts={};state.events.filter(e=>dateFromIso(e.date).getMonth()===mi).forEach(e=>counts[e.type]=(counts[e.type]||0)+1);const keys=state.config.monthlyEventTypes||QUICK_TYPES;document.getElementById('monthlyEvents').innerHTML=keys.filter(k=>EVENT_TYPES[k]).map(k=>{const t=EVENT_TYPES[k];return `<div class="month-event"><b>${t.emoji||'•'} ${esc(t.label||k)}</b><div class="n">${counts[k]||0}</div><small>今月追加</small></div>`;}).join('');
  document.getElementById('monthMemo').value=state.monthMemos[mi]||'';renderStory();renderBackupNotices();
}
function monthlyText(mi=+document.getElementById('summaryMonth').value){let s=`${YEAR}年 ${mi+1}月 進捗\n\n`;GOALS.forEach(g=>{const m=goalMetric(g);s+=`${String(g.id).padStart(2,'0')} ${g.title}\n  ${m.text} / 進捗 ${Math.round(m.pct)}%\n`;});s+='\n■習慣\n';Object.entries(DAILY).forEach(([key,x])=>{const a=monthHabitAggregate(key,mi);s+=`${x.label}: ${a.success}/${a.total||0} ${a.total?Math.round(a.rate):0}%\n`;});const memo=state.monthMemos[mi];if(memo)s+=`\n■メモ\n${memo}\n`;return s;}
function renderStory(){
  const c=document.getElementById('storyCanvas');if(!c||!hasConfig())return;const ctx=c.getContext('2d'),mi=+document.getElementById('summaryMonth').value;ctx.clearRect(0,0,1080,1920);const grad=ctx.createLinearGradient(0,0,0,1920);grad.addColorStop(0,'#315eea');grad.addColorStop(.52,'#647b9c');grad.addColorStop(1,'#555437');ctx.fillStyle=grad;ctx.fillRect(0,0,1080,1920);let y=120;if(storyImage){cover(ctx,storyImage,70,50,940,560);ctx.fillStyle='rgba(0,0,0,.16)';ctx.fillRect(70,50,940,560);y=650;}ctx.fillStyle='rgba(255,255,255,.96)';rounded(ctx,130,y-20,820,120,50);ctx.fill();ctx.fillStyle='#315eea';ctx.textAlign='center';ctx.font='700 50px -apple-system,sans-serif';ctx.fillText(`${YEAR}.${String(mi+1).padStart(2,'0')} PROGRESS`,540,y+55);ctx.textAlign='left';y+=145;const ids=(state.config.storyGoalIds||state.config.quickGoalIds||GOALS.slice(0,10).map(g=>g.id)).slice(0,10);ids.map(id=>goalById(id)).filter(Boolean).forEach((g,i)=>{const m=goalMetric(g),yy=y+i*77;ctx.fillStyle='rgba(255,255,255,.92)';rounded(ctx,90,yy,900,62,21);ctx.fill();ctx.fillStyle='#27344d';ctx.font='700 25px -apple-system,sans-serif';ctx.fillText(`${String(g.id).padStart(2,'0')} ${shortText(g.shortTitle||g.title,20)}`,120,yy+39);ctx.textAlign='right';ctx.fillStyle=m.pct>=100?'#16855f':'#4e70d9';ctx.fillText(shortText(m.text,18),955,yy+39);ctx.textAlign='left';});const memo=state.monthMemos[mi]||'';if(memo){ctx.fillStyle='rgba(255,249,230,.96)';rounded(ctx,100,1585,880,185,34);ctx.fill();ctx.fillStyle='#343b4c';ctx.font='30px -apple-system,sans-serif';wrapText(ctx,memo,145,1640,790,43,3);}ctx.textAlign='center';ctx.fillStyle='rgba(255,255,255,.96)';ctx.font='25px -apple-system,sans-serif';ctx.fillText(`${state.config.appTitle||'2026 GOALS'} · monthly log`,540,1858);ctx.textAlign='left';
}
function rounded(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function cover(ctx,img,x,y,w,h){const ir=img.width/img.height,br=w/h;let sw,sh,sx,sy;if(ir>br){sh=img.height;sw=sh*br;sx=(img.width-sw)/2;sy=0;}else{sw=img.width;sh=sw/br;sx=0;sy=(img.height-sh)/2;}ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);}
function shortText(s,n){return [...String(s)].length>n?[...String(s)].slice(0,n-1).join('')+'…':String(s);}
function wrapText(ctx,text,x,y,maxWidth,lineHeight,maxLines){let line='',lines=[];for(const ch of [...text]){const test=line+ch;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=ch;}else line=test;}if(line)lines.push(line);lines.slice(0,maxLines).forEach((l,i)=>ctx.fillText(l,x,y+i*lineHeight));}

// ---------- Settings / sheets ----------
function openSettings(){
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone;
  const bs=backupStatusText(),legacy=!!getLegacyV2()&&!settings.legacyV2Migrated;
  openSheet(`<div class="sheet-title"><div><h2>設定・データ</h2><span class="badge">v${APP_VERSION}</span></div><button class="sheet-close" data-close>×</button></div><div class="install-note">${standalone?'ホーム画面PWAとして起動中です。記録ログはこのPWAのIndexedDBに保存されています。':'本番利用は通常SafariでGitHub Pagesを開き、「共有 → ホーム画面に追加」してから始めてください。'}</div><div class="section-head"><div><h2>バックアップ</h2><p>JSONをiCloud Driveへ保存。30日で通知、60日で強めに通知。</p></div></div><div class="card"><div class="backup-meta"><b class="${bs.level==='good'?'status-good':bs.level==='warn'?'status-warn':'status-danger'}">${esc(bs.title)}</b><small>${esc(bs.detail)}</small></div><div class="actions"><button class="secondary" id="exportBtn">バックアップ保存</button><button class="secondary" id="restoreBtn">バックアップ復元</button></div></div><div class="section-head"><div><h2>アプリ更新</h2><p>GitHub Pages更新後もIndexedDBのデータは維持。</p></div></div><div class="card"><div class="backup-meta"><b>アプリ v${APP_VERSION} / DB v${DB_VERSION}</b><small>更新前はバックアップ推奨。新しいService Workerがあれば通知します。</small></div><button class="primary" id="checkUpdateBtn">更新を確認</button></div>${legacy?'<div class="section-head"><div><h2>v0.2移行</h2></div></div><div class="card"><button class="primary" id="migrateV2Btn">v0.2の追加ログをIndexedDBへ移行</button><p class="small-text">同じPWA内に残っている旧Local Storageの日次・イベント・月次メモを追加します。</p></div>':''}<div class="section-head"><div><h2>初期データ / リセット</h2></div></div><div class="card"><button class="primary" id="seedBtn">初期データJSONを読み直す</button><p class="small-text">個人用JSONはGitHubに置かず、iCloud Driveに保管してください。</p><button class="primary" style="background:#b84450" id="resetBtn">このiPhone内のデータを消去</button></div>`);
  document.getElementById('exportBtn').onclick=()=>saveBackupFile();document.getElementById('restoreBtn').onclick=()=>document.getElementById('restoreFile').click();document.getElementById('checkUpdateBtn').onclick=checkForUpdate;document.getElementById('seedBtn').onclick=()=>document.getElementById('setupFile').click();if(document.getElementById('migrateV2Btn'))document.getElementById('migrateV2Btn').onclick=migrateLegacyV2;
  document.getElementById('resetBtn').onclick=async()=>{if(confirm('このiPhone内の2026 GOALSデータをすべて消しますか？\nバックアップがない場合は元に戻せません。')){await wipeDatabase();settings.lastBackupAt=null;settings.lastBackupFile=null;saveSettings();closeSheet();document.getElementById('setupOverlay').classList.add('open');}};
}
function openSheet(html){document.getElementById('sheetContent').innerHTML=html;document.getElementById('sheetBackdrop').classList.add('open');document.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeSheet);}
function closeSheet(){document.getElementById('sheetBackdrop').classList.remove('open');}
function toast(s){const e=document.getElementById('toast');e.textContent=s;e.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove('show'),1800);}
function switchView(v){if(!hasConfig())return;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.getElementById(`${v}View`).classList.add('active');document.querySelectorAll('.nav-btn[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===v));settings.lastView=v;saveSettings();if(v==='calendar')renderCalendar();if(v==='monthly')renderMonthly();window.scrollTo({top:0,behavior:'smooth'});}

// ---------- Service Worker updates ----------
function showUpdateBanner(worker){waitingWorker=worker||waitingWorker;const b=document.getElementById('updateBanner');b.hidden=false;document.getElementById('updateVersionText').textContent='個人データはiPhone内に残ります。念のためバックアップ後の更新がおすすめです。';}
function hideUpdateBanner(){document.getElementById('updateBanner').hidden=true;}
function applyWaitingUpdate(){if(waitingWorker)waitingWorker.postMessage({type:'SKIP_WAITING'});else if(swRegistration?.waiting)swRegistration.waiting.postMessage({type:'SKIP_WAITING'});}
async function backupThenUpdate(){const ok=await saveBackupFile({forUpdate:true});if(ok)applyWaitingUpdate();}
async function checkForUpdate(){if(!swRegistration){toast('Service Worker未起動です');return;}try{toast('更新を確認中…');await swRegistration.update();if(swRegistration.waiting){showUpdateBanner(swRegistration.waiting);closeSheet();}else toast('更新確認が完了しました');}catch(e){console.error(e);toast('更新確認に失敗しました');}}
async function setupServiceWorker(){
  if(!('serviceWorker' in navigator)||!location.protocol.startsWith('http'))return;
  try{
    swRegistration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    if(swRegistration.waiting)showUpdateBanner(swRegistration.waiting);
    swRegistration.addEventListener('updatefound',()=>{const w=swRegistration.installing;if(!w)return;w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)showUpdateBanner(w);});});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(controllerReloading)return;controllerReloading=true;location.reload();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')swRegistration.update().catch(()=>{});});
  }catch(e){console.error('SW',e);}
}

// ---------- Bindings ----------
function bindUi(){
  document.querySelectorAll('.nav-btn[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>switchView(b.dataset.go));
  document.getElementById('navAdd').onclick=()=>openAddChooser(isoLocal(nowForYear()));document.getElementById('todayAddBtn').onclick=()=>openAddChooser(isoLocal(nowForYear()));
  document.getElementById('settingsBtn').onclick=openSettings;document.getElementById('sheetBackdrop').onclick=e=>{if(e.target===document.getElementById('sheetBackdrop'))closeSheet();};
  document.getElementById('touchTodayBtn').onclick=async()=>{const d=isoLocal(nowForYear());state.lastTouched[d]=new Date().toISOString();await saveState('今日の記録を保存しました');renderAll();};
  document.getElementById('prevMonth').onclick=()=>{calCursor=new Date(calCursor.getFullYear(),calCursor.getMonth()-1,1);renderCalendar();};document.getElementById('nextMonth').onclick=()=>{calCursor=new Date(calCursor.getFullYear(),calCursor.getMonth()+1,1);renderCalendar();};
  document.getElementById('summaryMonth').onchange=renderMonthly;document.getElementById('prevSummaryMonth').onclick=()=>{const s=document.getElementById('summaryMonth');s.value=Math.max(0,+s.value-1);renderMonthly();};document.getElementById('nextSummaryMonth').onclick=()=>{const s=document.getElementById('summaryMonth');s.value=Math.min(11,+s.value+1);renderMonthly();};
  document.getElementById('saveMemoBtn').onclick=async()=>{const mi=+document.getElementById('summaryMonth').value;state.monthMemos[mi]=document.getElementById('monthMemo').value;await saveState('月次メモを保存しました');renderStory();};
  document.getElementById('copyMonthlyBtn').onclick=async()=>{const text=monthlyText();try{await navigator.clipboard.writeText(text);toast('月次テキストをコピーしました');}catch(e){prompt('コピーしてください',text);}};
  document.getElementById('refreshStoryBtn').onclick=renderStory;document.getElementById('storyPhoto').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{storyImage=img;renderStory();};img.src=r.result;};r.readAsDataURL(f);};
  document.getElementById('downloadStoryBtn').onclick=()=>{renderStory();const a=document.createElement('a');a.href=document.getElementById('storyCanvas').toDataURL('image/png');a.download=`2026-goals-${String(+document.getElementById('summaryMonth').value+1).padStart(2,'0')}.png`;a.click();};
  document.getElementById('shareStoryBtn').onclick=async()=>{renderStory();const c=document.getElementById('storyCanvas');c.toBlob(async blob=>{const file=new File([blob],'2026-goals.png',{type:'image/png'});if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:'2026 GOALS'});}catch(e){}}else toast('共有非対応です。PNG保存を使ってください');},'image/png');};
  document.getElementById('setupImportBtn').onclick=()=>document.getElementById('setupFile').click();document.getElementById('setupRestoreBtn').onclick=()=>document.getElementById('restoreFile').click();
  document.getElementById('setupFile').onchange=async e=>{const f=e.target.files[0];if(f)await handleImportFile(f,{initial:!hasConfig()});e.target.value='';};
  document.getElementById('restoreFile').onchange=async e=>{const f=e.target.files[0];if(f)await handleImportFile(f,{initial:!hasConfig()});e.target.value='';};
  document.getElementById('updateLaterBtn').onclick=hideUpdateBanner;document.getElementById('updateBackupBtn').onclick=backupThenUpdate;
}

async function init(){
  bindUi();
  try{db=await openDatabase();state=await loadStateFromDb();}
  catch(e){console.error(e);alert(`IndexedDBを開けませんでした。\n通常Safari / ホーム画面PWAで開いてください。\n${e.message||''}`);return;}
  if(hasConfig()){
    applyConfig();renderAll();document.getElementById('setupOverlay').classList.remove('open');
    const v=settings.lastView||'today';if(['today','calendar','goals','monthly'].includes(v))switchView(v);
    await offerLegacyV2Migration();
  }else document.getElementById('setupOverlay').classList.add('open');
  await setupServiceWorker();
}

init();
