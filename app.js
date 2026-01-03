// ============================================================
// app.js - FINAL VERSION (Auto-Add Counterparty + Rial)
// ============================================================

// >>> 1. تنظیمات SUPABASE <<<
const SUPABASE_URL = 'https://ytledwlmnkxswaekavmr.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0bGVkd2xtbmt4c3dhZWthdm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODY0MzQsImV4cCI6MjA4Mjg2MjQzNH0.aIrcPpb1EmRIcitLcsFYajM4yTOhnOU_RLEa33TIcOk';

// >>> 2. لینک گوگل اسکریپت <<<
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxt8Yq0cCeyze6Ow0TT6vSk714Af5o_-h_QjMunDtMkbDUZf1F6oNIF-J89R_caYpbS/exec';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Global Vars ---
let currentType = 'pay';
let selectedCheckId = null;
let editingCheckId = null;
let activeStatusFilters = ['pending', 'passed', 'bounced', 'spent', 'canceled'];
let selectedColor = 'none';
let frontImageBase64 = null;
let backImageBase64 = null;
let cropper = null;
let currentUploadType = null;
let calViewMode = 'days', calSelectedYear, calSelectedMonth, calSelectedDay, calViewingYear, calViewingMonth, activeDateInputId = null;
let isCpEditMode = false;
let sortDescending = false;
let filterState = { minAmount: null, maxAmount: null, startDueDate: null, endDueDate: null, startIssueDate: null, endIssueDate: null, excludedColors: [], payTo: '', bank: '', type: [], status: [] };

// ============================================================
// [SECTION 0] STARTUP
// ============================================================

document.addEventListener("DOMContentLoaded", async function() {
    if (!window.location.href.includes('login.html')) {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) { window.location.href = 'login.html'; return; }
        
        const user = session.user;
        const menuHeader = document.querySelector('.side-menu-header');
        if(menuHeader) {
            const phone = user.email.replace('@checkapp.local', '');
            if(!menuHeader.innerHTML.includes('user-info-box')) {
                menuHeader.innerHTML += `<div class="user-info-box">کاربر: ${toPersianDigits(phone)}</div>`;
            }
        }
    }

    console.log("App Started");
    updateCurrentDate();
    addLogoutButton(); 
    convertAllNumbersToPersian();

    if (document.getElementById('inputAmount')) setupAddCheckPage();
    if (document.querySelector('.buttons-card')) { loadDashboardData(); renderDashboardCalendar(); }
    if (document.getElementById('checkListContainer')) { setupFilterTabs(); renderCheckList(); }
    if (document.getElementById('reportContainer')) setupReportPage();

    window.addEventListener('click', (e)=>{ 
        if(e.target.classList.contains('modal-overlay')) e.target.style.display='none'; 
    });
});

function addLogoutButton() {
    const menu = document.getElementById('sideMenu');
    if (menu && !document.getElementById('logoutBtn')) {
        const div = document.createElement('div');
        div.id = 'logoutBtn';
        div.className = 'side-menu-item';
        div.style.color = '#f44336';
        div.style.marginTop = 'auto';
        div.style.borderTop = '1px solid #eee';
        div.innerHTML = '<i class="fa-solid fa-right-from-bracket" style="color:#f44336"></i> خروج از حساب';
        div.onclick = async () => {
            if(confirm("آیا از حساب خود خارج می‌شوید؟")) {
                await sb.auth.signOut();
                window.location.href = 'login.html';
            }
        };
        menu.appendChild(div);
    }
}

// ============================================================
// [SECTION 1] DATABASE & STORAGE
// ============================================================

function base64ToBlob(base64) {
    try {
        const byteString = atob(base64.split(',')[1]);
        const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        return new Blob([ab], {type: mimeString});
    } catch(e) { return null; }
}

async function uploadImageToStorage(base64, folderName) {
    try {
        const { data: { user } } = await sb.auth.getUser();
        if(!user) throw new Error("User not found");
        const blob = base64ToBlob(base64);
        if(!blob) return null;
        const fileName = `${user.id}/${folderName}/${Date.now()}.jpg`;
        const { error } = await sb.storage.from('check_images').upload(fileName, blob, { upsert: true });
        if (error) throw error;
        const { data: publicData } = sb.storage.from('check_images').getPublicUrl(fileName);
        return publicData.publicUrl;
    } catch (e) { console.error("Upload Error:", e); return null; }
}

async function fetchChecks() {
 
    const { data, error } = await sb
        .from('checks')
        .select('*')
        .order('id', { ascending: false }) 
        .range(0, 99999); 

    if (error) { console.error(error); return []; }
    return data;
}

async function fetchCounterparties() {
    const { data, error } = await sb.from('counterparties').select('*');
    if (error) { console.error(error); return []; }
    return data;
}

async function dbAddCheck(checkData) {
    const { error } = await sb.from('checks').insert([checkData]);
    if (error) throw error;
}

async function dbUpdateCheck(id, checkData) {
    const { error } = await sb.from('checks').update(checkData).eq('id', id);
    if (error) throw error;
}

async function dbDeleteCheck(id) {
    const { error } = await sb.from('checks').delete().eq('id', id);
    if (error) throw error;
}

async function dbAddCounterparty(cpData) {
    const { error } = await sb.from('counterparties').insert([cpData]);
    if (error) throw error;
}

async function dbUpdateCounterparty(id, cpData) {
    const { error } = await sb.from('counterparties').update(cpData).eq('id', id);
    if (error) throw error;
}


// ============================================================
// [SECTION 2] HELPER FUNCTIONS
// ============================================================
function toPersianDigits(s) { return !s&&s!==0?'':s.toString().replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]); }
function toEnglishDigits(s) { return !s&&s!==0?'':s.toString().replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }
function getMonthName(i) { return ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"][parseInt(i)-1]||""; }
function getBankNameFA(c) { const n={'meli':'بانک ملی','mellat':'بانک ملت','sepah':'بانک سپه','tejarat':'بانک تجارت','saderat':'بانک صادرات','saman':'بانک سامان','pasargad':'بانک پاسارگاد','refah':'بانک رفاه کارگران','maskan':'بانک مسکن','keshavarzi':'بانک کشاورزی','parsian':'بانک پارسیان','en':'بانک اقتصاد نوین','resalat':'بانک رسالت','shahr':'بانک شهر','ansar':'بانک انصار','dey':'بانک دی','sina':'بانک سینا','post':'پست بانک','tosee':'توسعه تعاون','ayandeh':'بانک آینده'}; return n[c]||'بانک نامشخص'; }
function getBankLogoSrc(c) { return `./logos/${c}.png`; } 
function getDateScore(s) { if(!s)return 9e7; const p=toEnglishDigits(s).split('/'); if(p.length!==3)return 9e7; return parseInt(p[0])*10000+parseInt(p[1])*100+parseInt(p[2]); }

function getStatusInfo(s) {
    switch(s) {
        case 'pending': return { text: 'در انتظار', color: '#ffa000', bg: '#fff8e1' };
        case 'passed': return { text: 'پاس شده', color: '#4caf50', bg: '#e8f5e9' };
        case 'bounced': return { text: 'برگشتی', color: '#f44336', bg: '#ffebee' };
        case 'spent': return { text: 'خرج شده', color: '#2196f3', bg: '#e3f2fd' };
        case 'canceled': return { text: 'ابطال شده', color: '#9e9e9e', bg: '#f5f5f5' };
        default: return { text: 'نامشخص', color: '#333', bg: '#eee' };
    }
}

function updateCurrentDate() {
    const el=document.getElementById('currentDateText'); if(el){
        const [y,m,d]=getTodayJalaali();
        const w=['یک‌شنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه','شنبه']; 
        const [gy,gm,gd]=jalaaliToGregorian(y,m,d); 
        el.innerText=toPersianDigits(`امروز ${w[new Date(gy,gm-1,gd).getDay()]} ${d} ${getMonthName(m)} ${y}`);
    }
}

function convertAllNumbersToPersian() { 
    const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null,false); let n; 
    while(n=w.nextNode()) if(n.nodeValue.trim() && n.parentNode.tagName!=='SCRIPT' && n.parentNode.tagName!=='STYLE') n.nodeValue=toPersianDigits(n.nodeValue); 
}

function showLoading(m) { 
    let l=document.getElementById('loadingModal'); 
    if(!l){document.body.insertAdjacentHTML('beforeend',`<div id="loadingModal" class="modal-overlay" style="z-index:9999;display:flex;flex-direction:column;justify-content:center;align-items:center;background:rgba(255,255,255,0.9)"><i class="fa-solid fa-spinner fa-spin" style="font-size:40px;color:#00bcd4"></i><p id="loadingMsg" style="margin-top:15px">${m}</p></div>`); l=document.getElementById('loadingModal');}
    else document.getElementById('loadingMsg').innerText=m; 
    l.style.display='flex'; 
}
function hideLoading() { const l=document.getElementById('loadingModal'); if(l)l.style.display='none'; }

// --- Date Algo ---
function gregorianToJalaali(gy,gm,gd){var g_d_m=[0,31,59,90,120,151,181,212,243,273,304,334];var gy2=(gm>2)?(gy+1):gy;var days=355666+(365*gy)+parseInt((gy2+3)/4)-parseInt((gy2+99)/100)+parseInt((gy2+399)/400)+gd+g_d_m[gm-1];var jy=-1595+(33*parseInt(days/12053));days%=12053;jy+=4*parseInt(days/1461);days%=1461;if(days>365){jy+=parseInt((days-1)/365);days=(days-1)%365;}var jm,jd;if(days<186){jm=1+parseInt(days/31);jd=1+(days%31);}else{jm=7+parseInt((days-186)/30);jd=1+((days-186)%30);}return[jy,jm,jd];}
function jalaaliToGregorian(jy,jm,jd){jy+=1595;var days=-355668+(365*jy)+(parseInt(jy/33)*8)+parseInt(((jy%33)+3)/4)+jd+((jm<7)?(jm-1)*31:((jm-7)*30)+186);var gy=400*parseInt(days/146097);days%=146097;if(days>36524){gy+=100*parseInt(--days/36524);days%=36524;if(days>=365)days++;}gy+=4*parseInt(days/1461);days%=1461;if(days>365){gy+=parseInt((days-1)/365);days=(days-1)%365;}var gd=days+1;var sal_a=[0,31,((gy%4==0&&gy%100!=0)||(gy%400==0))?29:28,31,30,31,30,31,31,30,31,30,31];var gm;for(gm=0;gm<13;gm++){var v=sal_a[gm];if(gd<=v)break;gd-=v;}return[gy,gm,gd];}
function getTodayJalaali(){const n=new Date();return gregorianToJalaali(n.getFullYear(),n.getMonth()+1,n.getDate());}
function openCustomCalendar(id) { activeDateInputId=id; document.getElementById('customCalendarModal').style.display='flex'; const [y,m,d]=getTodayJalaali(); const v=document.getElementById(id).value; if(v&&v.split('/').length===3){const p=toEnglishDigits(v).split('/');calSelectedYear=parseInt(p[0]);calSelectedMonth=parseInt(p[1]);calSelectedDay=parseInt(p[2]);calViewingYear=calSelectedYear;calViewingMonth=calSelectedMonth;}else{calViewingYear=y;calViewingMonth=m;calSelectedYear=y;calSelectedMonth=m;calSelectedDay=d;} calViewMode='days'; updateCalendarView(); updatePickerDisplay(); }
function closeCalendarModal() { document.getElementById('customCalendarModal').style.display='none'; }
function confirmDateSelection() { if(calSelectedYear){const m=calSelectedMonth<10?'0'+calSelectedMonth:calSelectedMonth; const d=calSelectedDay<10?'0'+calSelectedDay:calSelectedDay; document.getElementById(activeDateInputId).value=toPersianDigits(`${calSelectedYear}/${m}/${d}`); closeCalendarModal();} }
function goToToday(){const [y,m,d]=getTodayJalaali();calSelectedYear=y;calSelectedMonth=m;calSelectedDay=d;calViewingYear=y;calViewingMonth=m;calViewMode='days';updateCalendarView();updatePickerDisplay();}
function calPrev(){if(calViewMode==='days'){calViewingMonth--;if(calViewingMonth<1){calViewingMonth=12;calViewingYear--;}}else if(calViewMode==='years')calViewingYear-=12;updateCalendarView();}
function calNext(){if(calViewMode==='days'){calViewingMonth++;if(calViewingMonth>12){calViewingMonth=1;calViewingYear++;}}else if(calViewMode==='years')calViewingYear+=12;updateCalendarView();}
function calSwitchView(){calViewMode=calViewMode==='days'?'months':'years';updateCalendarView();}
function updatePickerDisplay(){const y=calSelectedYear||calViewingYear;const m=calSelectedMonth||calViewingMonth;const d=calSelectedDay||1;const [gy,gm,gd]=jalaaliToGregorian(y,m,d);const w=['شنبه','یک‌شنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه'];document.getElementById('pickerSelectedDayName').innerText=w[new Date(gy,gm-1,gd).getDay()+1>6?0:new Date(gy,gm-1,gd).getDay()+1];document.getElementById('pickerSelectedFullDate').innerText=toPersianDigits(`${d} ${getMonthName(m)} ${y}`);}
function updateCalendarView(){document.getElementById('calViewDays').style.display=calViewMode==='days'?'block':'none';document.getElementById('calViewMonths').style.display=calViewMode==='months'?'block':'none';document.getElementById('calViewYears').style.display=calViewMode==='years'?'block':'none';const t=document.getElementById('calendarTitle');if(calViewMode==='days'){t.innerText=toPersianDigits(`${getMonthName(calViewingMonth)} ${calViewingYear}`);renderDays();}else if(calViewMode==='months'){t.innerText=toPersianDigits(calViewingYear);renderMonths();}else{const s=calViewingYear-(calViewingYear%12);t.innerText=toPersianDigits(`${s} - ${s+11}`);renderYears(s);}}
function renderDays(){const g=document.getElementById('calendarDaysGrid');g.innerHTML='';const [gy,gm,gd]=jalaaliToGregorian(calViewingYear,calViewingMonth,1);const f=new Date(gy,gm-1,gd).getDay();const mp=(f+1)%7;let dim=(calViewingMonth<=6)?31:(calViewingMonth<=11)?30:29;if(calViewingMonth===12){const [ny,nm,nd]=gregorianToJalaali(...jalaaliToGregorian(calViewingYear,12,30));if(ny===calViewingYear&&nm===12&&nd===30)dim=30;}for(let i=0;i<mp;i++){const d=document.createElement('div');d.className='c-day';g.appendChild(d);}for(let i=1;i<=dim;i++){const d=document.createElement('div');d.className='c-day';d.innerText=toPersianDigits(i);const [ty,tm,td]=getTodayJalaali();if(calViewingYear===ty&&calViewingMonth===tm&&i===td)d.classList.add('today');if(calSelectedYear===calViewingYear&&calSelectedMonth===calViewingMonth&&calSelectedDay===i)d.classList.add('selected');d.onclick=()=>{calSelectedYear=calViewingYear;calSelectedMonth=calViewingMonth;calSelectedDay=i;updatePickerDisplay();renderDays();};g.appendChild(d);}}
function renderMonths(){const g=document.getElementById('calendarMonthsGrid');g.innerHTML='';["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"].forEach((m,i)=>{const d=document.createElement('div');d.className='c-month';d.innerText=m;d.onclick=()=>{calViewingMonth=i+1;calViewMode='days';updateCalendarView();};g.appendChild(d);});}
function renderYears(s){const g=document.getElementById('calendarYearsGrid');g.innerHTML='';for(let i=0;i<12;i++){const y=s+i;const d=document.createElement('div');d.className='c-year';d.innerText=toPersianDigits(y);d.onclick=()=>{calViewingYear=y;calViewMode='months';updateCalendarView();};g.appendChild(d);}}

// --- Menu & Excel ---
function openSideMenu() { document.getElementById('sideMenuOverlay').style.display='block'; setTimeout(()=>{document.getElementById('sideMenuOverlay').style.opacity='1'; document.getElementById('sideMenu').classList.add('open');},10); }
function closeSideMenu() { document.getElementById('sideMenu').classList.remove('open'); document.getElementById('sideMenuOverlay').style.opacity='0'; setTimeout(()=>{document.getElementById('sideMenuOverlay').style.display='none';},300); }
function openCounterpartyListMode() { closeSideMenu(); openCounterpartyModal(true); }

async function exportToExcel() {
    closeSideMenu(); showLoading("ایجاد فایل اکسل...");
    try {
        const allChecksList = await fetchChecks();
        if (allChecksList.length === 0) { alert("داده‌ای نیست"); hideLoading(); return; }
        
        const excelRows = allChecksList.map(check => ({
            "مبلغ (ریال)": check.amount, // تغییر به ریال
            "تاریخ سررسید": check.date,
            "نوع چک": check.type === 'pay' ? 'پرداختی' : 'دریافتی',
            "طرف حساب": check.payTo,
            "نام بانک": getBankNameFA(check.bank),
            "وضعیت": getStatusInfo(check.status).text,
            "شماره چک": check.checkNum,
            "شناسه صیاد": check.sayadNum,
            "توضیحات": check.desc
        }));

        const ws = XLSX.utils.json_to_sheet(excelRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Checks");
        const [currY, currM, currD] = getTodayJalaali();
        XLSX.writeFile(wb, `CheckList_${currY}-${currM}-${currD}.xlsx`);
        
    } catch (e) { alert(e.message); } finally { hideLoading(); }
}

// --- IMPORTANT: Excel Import with Auto-Add Counterparty ---
async function processExcelFile(inp) { 
    const file = inp.files[0];
    if (!file) return;

    showLoading("در حال آنالیز هوشمند فایل...");
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
            
            if (jsonData.length === 0) throw new Error("فایل اکسل خالی است");

            let checksToAdd = [];
            let newCounterparties = new Set(); // لیستی برای نام‌های جدید

            // دریافت لیست فعلی طرف حساب‌ها برای مقایسه
            const existingCPs = await fetchCounterparties();
            const existingNames = existingCPs.map(cp => cp.name.trim());

            for (let row of jsonData) {
                const keys = Object.keys(row);
                const keyAmount = keys.find(k => k.trim().includes('مبلغ') || k.includes('قیمت') || k.toLowerCase().includes('amount') || k.includes('ریال') || k.includes('تومان'));
                const keyDate = keys.find(k => k.trim().includes('تاریخ') || k.toLowerCase().includes('date') || k.includes('سررسید') || k.includes('زمان'));
                const keyName = keys.find(k => k.trim().includes('وجه') || k.trim().includes('نام') || k.toLowerCase().includes('name') || k.includes('گیرنده'));
                const keyType = keys.find(k => k.trim().includes('نوع') || k.toLowerCase().includes('type'));
                const keyNum = keys.find(k => k.trim().includes('شماره') || k.toLowerCase().includes('no') || k.toLowerCase().includes('num'));
                const keySayad = keys.find(k => k.trim().includes('صیاد') || k.toLowerCase().includes('sayad'));
                const keyDesc = keys.find(k => k.trim().includes('توضیح') || k.toLowerCase().includes('desc') || k.includes('بابت'));

                let rawAmount = keyAmount ? row[keyAmount] : 0;
                let amount = 0;
                if(rawAmount) {
                    let s = rawAmount.toString().replace(/,/g, '').trim();
                    s = toEnglishDigits(s);
                    amount = parseInt(s);
                }

                let rawDate = keyDate ? row[keyDate] : '';
                let dateStr = '';
                if(rawDate) {
                    dateStr = toEnglishDigits(rawDate.toString().trim());
                    if(dateStr.includes('-')) dateStr = dateStr.replace(/-/g, '/');
                }

                if (amount > 0 && dateStr.length >= 6) {
                    let type = 'pay';
                    if (keyType) {
                        let tVal = row[keyType].toString();
                        if(tVal.includes('دریافت') || tVal.toLowerCase().includes('rec')) type = 'receive';
                    }

                    const payToName = keyName ? row[keyName].toString().trim() : '';

                    // اگر نام طرف حساب وجود داشت و قبلاً در دیتابیس نبود، به لیست افزودن اضافه کن
                    if (payToName && !existingNames.includes(payToName)) {
                        newCounterparties.add(payToName);
                    }

                    checksToAdd.push({
                        amount: amount,
                        date: dateStr,
                        type: type,
                        payTo: payToName,
                        desc: keyDesc ? row[keyDesc].toString().trim() : '',
                        checkNum: keyNum ? toEnglishDigits(row[keyNum].toString().trim()) : '',
                        sayadNum: keySayad ? toEnglishDigits(row[keySayad].toString().trim()) : '',
                        status: 'pending',
                        bank: 'meli',
                        colorTag: 'none'
                    });
                }
            }

            // 1. اول طرف حساب‌های جدید را اضافه کن
            if (newCounterparties.size > 0) {
                const cpArray = Array.from(newCounterparties).map(name => ({ name: name, nationalId: '', phone: '' }));
                const { error: cpError } = await sb.from('counterparties').insert(cpArray);
                if (cpError) console.error("CP Import Error", cpError);
            }

            // 2. بعد چک‌ها را اضافه کن
            if (checksToAdd.length > 0) {
                const { error } = await sb.from('checks').insert(checksToAdd);
                if (error) throw error;
                alert(`${checksToAdd.length} فقره چک و طرف حساب‌های جدید وارد شدند.`);
                location.reload();
            } else {
                alert("هیچ چک معتبری یافت نشد. ستون مبلغ و تاریخ الزامی است.");
            }

        } catch (err) {
            console.error(err);
            alert("خطا: " + err.message);
        } finally {
            hideLoading();
            inp.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}


// --- Dashboard ---
async function loadDashboardData() {
    let list = await fetchChecks();
    const todayScore = getDateScore(toPersianDigits(getTodayJalaali().join('/')));
    const total = list.length;
    const overdue = list.filter(c => c.status === 'pending' && getDateScore(c.date) <= todayScore).length;
    document.getElementById('countAll').innerText = toPersianDigits(total) + " فقره";
    document.getElementById('countPay').innerText = toPersianDigits(list.filter(c=>c.type==='pay').length) + " فقره";
    document.getElementById('countRec').innerText = toPersianDigits(list.filter(c=>c.type==='receive').length) + " فقره";
    document.getElementById('overdueCount').innerText = toPersianDigits(overdue) + " فقره سررسید";
    const lastBackup = localStorage.getItem('lastBackupDate');
    document.getElementById('lastBackupText').innerText = "همگام‌سازی آنلاین";
}
async function renderDashboardCalendar() {
    const container = document.getElementById('dashboardCalendarGrid'); if(!container) return;
    let list = await fetchChecks(); let pending = list.filter(c=>c.status==='pending');
    const [cy] = getTodayJalaali();
    let monthlyData = {}; let maxVol = 0;
    pending.forEach(c => { if(c.type==='pay'){ const [y,m]=toEnglishDigits(c.date).split('/'); const k=`${parseInt(y)}-${parseInt(m)}`; monthlyData[k]=(monthlyData[k]||0)+parseInt(c.amount); if(monthlyData[k]>maxVol) maxVol=monthlyData[k]; } });
    let html = '';
    for(let y=cy; y<=cy+1; y++) {
        html += `<div class="year-wrapper"><div class="year-label">${toPersianDigits(y)}</div><div class="year-block">`;
        for(let m=1; m<=12; m++) {
            const k = `${y}-${m}`; const sum = monthlyData[k]||0;
            let cls = 'd0'; if(sum>0) { const p = (sum/maxVol)*100; cls = p<33 ? 'd1' : p<66 ? 'd2' : 'd3'; }
            html += `<div class="cal-cell ${cls}" onclick="openMonthDetails(${y}, ${m})">${getMonthName(m)}</div>`;
        }
        html += '</div></div>';
    }
    container.innerHTML = html;
}
async function openMonthDetails(year, month) {
    let list = await fetchChecks();
    const monthChecks = list.filter(c => { const p = toEnglishDigits(c.date).split('/'); return parseInt(p[0]) === year && parseInt(p[1]) === month; });
    let count = monthChecks.length; let sumPay = 0; let sumRec = 0; let weeks = [0, 0, 0, 0, 0];
    monthChecks.forEach(c => { const amt = parseInt(c.amount); const day = parseInt(toEnglishDigits(c.date).split('/')[2]); const weekIdx = Math.min(Math.floor((day - 1) / 7), 4); if (c.type === 'pay') { sumPay += amt; weeks[weekIdx] -= amt; } else { sumRec += amt; weeks[weekIdx] += amt; } });
    const balance = sumRec - sumPay;
    document.getElementById('mdMonthName').innerText = getMonthName(month);
    document.getElementById('mdYear').innerText = toPersianDigits(year);
    document.getElementById('mdCount').innerText = `${toPersianDigits(count)} فقره`;
    document.getElementById('mdRec').innerText = `${toPersianDigits(sumRec.toLocaleString())} ریال`; // ریال
    document.getElementById('mdPay').innerText = `${toPersianDigits(sumPay.toLocaleString())} ریال`; // ریال
    const balEl = document.getElementById('mdBalance');
    balEl.innerText = `${toPersianDigits(Math.abs(balance).toLocaleString())} ریال ${balance<0?'(بدهکار)':'(تراز)'}`;
    balEl.className = balance < 0 ? 'dc-val text-danger' : 'dc-val';
    const wContainer = document.getElementById('mdWeeksContainer'); wContainer.innerHTML = '';
    const wNames = ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم'];
    weeks.forEach((wBal, i) => { if (wBal !== 0) { const wSign = wBal < 0 ? '-' : '+'; const wColor = wBal < 0 ? '#d32f2f' : '#388e3c'; wContainer.innerHTML += `<div class="wk-row"><span>هفته ${wNames[i]}</span><span style="color:${wColor}; direction:ltr;">${wSign} ${toPersianDigits(Math.abs(wBal).toLocaleString())}</span></div>`; } });
    if (wContainer.innerHTML === '') wContainer.innerHTML = '<div style="text-align:center;font-size:10px;color:#999">گردشی ثبت نشده</div>';
    document.getElementById('btnViewMonthList').onclick = () => window.location.href = `check-list.html?year=${year}&month=${month}`;
    document.getElementById('monthDetailsModal').style.display = 'flex';
}
function closeMonthModal() { document.getElementById('monthDetailsModal').style.display = 'none'; }

// --- Lists ---
function setupFilterTabs() { document.querySelectorAll('.filter-tab').forEach(t=>{ t.addEventListener('click', ()=>{ const s=t.getAttribute('data-status'); if(s==='all'){activeStatusFilters=['pending','passed','bounced','spent','canceled']; document.querySelectorAll('.filter-tab').forEach(x=>x.classList.remove('filter-off'));}else{if(activeStatusFilters.includes(s)){activeStatusFilters=activeStatusFilters.filter(x=>x!==s); t.classList.add('filter-off');}else{activeStatusFilters.push(s); t.classList.remove('filter-off');}} renderCheckList(); }); }); }
function openFilterModal(){document.getElementById('filterModal').style.display='flex';} function closeFilterModal(){document.getElementById('filterModal').style.display='none';}
function applyAdvancedFilter(){ const min=document.getElementById('filterMinAmount').value.replace(/,/g,''); const max=document.getElementById('filterMaxAmount').value.replace(/,/g,''); filterState.minAmount=min?parseInt(toEnglishDigits(min)):null; filterState.maxAmount=max?parseInt(toEnglishDigits(max)):null; filterState.startDueDate=document.getElementById('filterStartDueDate').value; filterState.endDueDate=document.getElementById('filterEndDueDate').value; filterState.startIssueDate=document.getElementById('filterStartIssueDate').value; filterState.endIssueDate=document.getElementById('filterEndIssueDate').value; filterState.payTo=document.getElementById('filterPayTo').value; closeFilterModal(); renderCheckList(); }
function toggleSortOrder(){sortDescending=!sortDescending; document.getElementById('sortIcon').className=sortDescending?'fa-solid fa-arrow-up-wide-short':'fa-solid fa-arrow-down-wide-short'; renderCheckList();}
function toggleFilterColor(c,e){if(filterState.excludedColors.includes(c)){filterState.excludedColors=filterState.excludedColors.filter(x=>x!==c); e.classList.remove('disabled');}else{filterState.excludedColors.push(c); e.classList.add('disabled');}}
async function renderCheckList() {
    let l = await fetchChecks();
    const u=new URLSearchParams(window.location.search); const yf=u.get('year'), mf=u.get('month'), tf=u.get('filter');
    if(tf==='pay') l=l.filter(x=>x.type==='pay'); else if(tf==='receive') l=l.filter(x=>x.type==='receive');
    if(yf&&mf) { l=l.filter(x=>{const p=toEnglishDigits(x.date).split('/'); return parseInt(p[0])==yf && parseInt(p[1])==mf;}); document.querySelector('.filter-tabs-container').style.display='none'; document.querySelector('.header-center h1').innerText=`${getMonthName(mf)} ${toPersianDigits(yf)}`; }
    else l=l.filter(x=>activeStatusFilters.includes(x.status));
    if(filterState.minAmount) l=l.filter(x=>x.amount>=filterState.minAmount); if(filterState.maxAmount) l=l.filter(x=>x.amount<=filterState.maxAmount);
    if(filterState.startDueDate) l=l.filter(x=>getDateScore(x.date)>=getDateScore(filterState.startDueDate)); if(filterState.endDueDate) l=l.filter(x=>getDateScore(x.date)<=getDateScore(filterState.endDueDate));
    if(filterState.startIssueDate) l=l.filter(x=>getDateScore(x.issueDate)>=getDateScore(filterState.startIssueDate)); if(filterState.endIssueDate) l=l.filter(x=>getDateScore(x.issueDate)<=getDateScore(filterState.endIssueDate));
    if(filterState.payTo) l=l.filter(x=>x.payTo.includes(filterState.payTo));
    l=l.filter(x=>!filterState.excludedColors.includes(x.colorTag||'none'));
    const con=document.getElementById('checkListContainer'); con.innerHTML='';
    document.getElementById('totalCountHeader').innerText=`${toPersianDigits(l.length)} فقره`;
    if(l.length===0){con.innerHTML='<div style="text-align:center;padding-top:60px;color:#ccc">موردی نیست</div>'; return;}
    l.sort((a,b)=>getDateScore(a.date)-getDateScore(b.date));
    const g={}; l.forEach(x=>{const k=toEnglishDigits(x.date).split('/').slice(0,2).join('-'); if(!g[k])g[k]=[]; g[k].push(x);});
    let keys=Object.keys(g).sort((a,b)=>parseInt(a.replace('-',''))-parseInt(b.replace('-','')));
    if(sortDescending){keys.reverse(); keys.forEach(k=>g[k].reverse());}
    keys.forEach(k=>{
        const [gy,gm]=k.split('-'); const gn=`group-${k}`;
        let h=`<div class="month-group"><div class="month-header-dynamic" onclick="toggleMonthGroup('${gn}')"><i id="arrow-${gn}" class="fa-solid fa-chevron-down arrow-icon"></i><span class="month-title">${getMonthName(gm)} ${toPersianDigits(gy)}</span></div><div id="${gn}" class="month-content">`;
        g[k].forEach(x=>{
            const s=getStatusInfo(x.status); const ex=`${x.colorTag&&x.colorTag!=='none'?`<span class="chk-color-tag-inline" style="background:${x.colorTag}"></span>`:''} ${x.frontImage||x.backImage?'<i class="fa-solid fa-image chk-img-icon"></i>':''}`;
            // استفاده از لوگوی لوکال
            h+=`<div class="check-item-card" onclick="window.location.href='add-check.html?id=${x.id}'"><div class="chk-right"><div class="logo-wrapper"><img src="${getBankLogoSrc(x.bank)}" class="bank-logo-img"></div><div class="chk-details"><div class="chk-date"><span>${toPersianDigits(x.date)}</span><span class="type-badge ${x.type==='pay'?'t-pay':'t-rec'}">(${x.type==='pay'?'پرداختی':'دریافتی'})</span>${ex}</div><div class="chk-desc">${x.payTo}</div></div></div><div class="chk-left"><div class="status-clickable" style="color:${s.color};background:${s.bg}" onclick="openStatusModal('${x.id}', event)">${s.text}</div><div class="amount-text">${toPersianDigits(parseInt(x.amount).toLocaleString())} <span class="currency">ریال</span></div></div></div>`;
        });
        h+='</div></div>'; con.innerHTML+=h;
    });
}
function toggleMonthGroup(id){const c=document.getElementById(id); const a=document.getElementById('arrow-'+id); if(c.classList.contains('month-collapsed')){c.classList.remove('month-collapsed');a.classList.remove('arrow-rotated');}else{c.classList.add('month-collapsed');a.classList.add('arrow-rotated');}}
function openStatusModal(id,e){if(e)e.stopPropagation(); selectedCheckId=id; document.getElementById('statusModal').style.display='flex';} function closeStatusModal(){document.getElementById('statusModal').style.display='none';}
async function changeStatus(s){if(selectedCheckId){await dbUpdateCheck(selectedCheckId,{status:s}); closeStatusModal(); renderCheckList();}}

// --- Add/Edit Check ---
function setupAddCheckPage() {
    document.querySelectorAll('.date-input-trigger').forEach(i=>i.addEventListener('click',function(){openCustomCalendar(this.id)}));
    document.getElementById('inputAmount').addEventListener('input',function(e){let v=toEnglishDigits(e.target.value).replace(/,/g,'').replace(/[^\d]/g,''); if(v)e.target.value=toPersianDigits(parseInt(v).toLocaleString()); else e.target.value='';});
    document.querySelectorAll('.color-circle').forEach(c=>c.addEventListener('click',function(){document.querySelectorAll('.color-circle').forEach(x=>x.classList.remove('selected-color')); this.classList.add('selected-color'); selectedColor=this.getAttribute('data-color');}));
    setupImageUploader('fileFront','areaFront','front'); setupImageUploader('fileBack','areaBack','back');
    const p=new URLSearchParams(window.location.search); const [ty,tm,td]=getTodayJalaali();
    if(p.get('id')){
        editingCheckId=p.get('id'); document.getElementById('pageTitle').innerText="ویرایش چک"; document.getElementById('deleteCheckBtn').style.display='flex'; loadCheckDataForEdit(editingCheckId);
    } else {
        const d=document.getElementById('inputStatusDisplay'); d.value='در انتظار'; d.style.color='#ffa000'; d.style.fontWeight='bold'; document.getElementById('inputStatusValue').value='pending';
        if(document.getElementById('inputIssueDate')) document.getElementById('inputIssueDate').value=toPersianDigits(`${ty}/${tm<10?'0'+tm:tm}/${td<10?'0'+td:td}`); selectedColor='none';
        if(p.get('mode')==='scan'){
            const s=JSON.parse(localStorage.getItem('scannedCheckData')||'{}'); if(s.sayad)document.getElementById('sayadNum').value=toPersianDigits(s.sayad); if(s.date)document.getElementById('inputDate').value=toPersianDigits(s.date); if(s.amount)document.getElementById('inputAmount').value=toPersianDigits(parseInt(s.amount).toLocaleString()); if(s.image){frontImageBase64=s.image; updateImageBox('areaFront',s.image);} localStorage.removeItem('scannedCheckData'); document.getElementById('pageTitle').innerText="چک اسکن شده";
        }
    }
    document.getElementById('typePay').addEventListener('click',()=>{currentType='pay';updateTypeUI('typePay','typeReceive');}); document.getElementById('typeReceive').addEventListener('click',()=>{currentType='receive';updateTypeUI('typeReceive','typePay');});
    const sf=saveCheck; if(document.getElementById('saveBtn'))document.getElementById('saveBtn').onclick=sf; if(document.querySelector('.save-fab-btn'))document.querySelector('.save-fab-btn').onclick=sf; if(document.getElementById('deleteCheckBtn'))document.getElementById('deleteCheckBtn').onclick=()=>{if(confirm('حذف؟'))deleteCheck(editingCheckId);};
}
async function saveCheck() {
    const a=toEnglishDigits(document.getElementById('inputAmount').value.replace(/,/g,'')); const d=toEnglishDigits(document.getElementById('inputDate').value); if(!a||!d){alert("مبلغ و تاریخ الزامی");return;}
    showLoading("در حال ذخیره...");
    let fUrl = frontImageBase64; let bUrl = backImageBase64;
    if (fUrl && fUrl.startsWith('data:')) fUrl = await uploadImageToStorage(fUrl, 'front');
    if (bUrl && bUrl.startsWith('data:')) bUrl = await uploadImageToStorage(bUrl, 'back');

    const c={type:currentType, amount:parseInt(a), date:d, issueDate:toEnglishDigits(document.getElementById('inputIssueDate').value), payTo:document.getElementById('inputPayTo').value, bank:document.getElementById('inputBankValue').value, status:document.getElementById('inputStatusValue').value, colorTag:selectedColor, frontImage:fUrl, backImage:bUrl, checkNum:toEnglishDigits(document.getElementById('checkNum').value), sayadNum:toEnglishDigits(document.getElementById('sayadNum').value), desc:document.getElementById('inputDesc').value};
    try {
        if(editingCheckId){await dbUpdateCheck(editingCheckId,c); alert('ویرایش شد');}else{await dbAddCheck(c); alert('ثبت شد');}
        window.location.href='check-list.html?filter=all';
    } catch(e) { alert("خطا: " + e.message); } finally { hideLoading(); }
}
async function loadCheckDataForEdit(id) {
    const checks = await fetchChecks();
    const c = checks.find(x => x.id == id); if(!c) return;
    document.getElementById('inputAmount').value=toPersianDigits(parseInt(c.amount).toLocaleString()); document.getElementById('inputDate').value=toPersianDigits(c.date); document.getElementById('inputIssueDate').value=toPersianDigits(c.issueDate||''); document.getElementById('inputPayTo').value=c.payTo; document.getElementById('inputBankValue').value=c.bank; document.getElementById('inputBankDisplay').value=getBankNameFA(c.bank); document.getElementById('inputStatusValue').value=c.status;
    const i=getStatusInfo(c.status); const d=document.getElementById('inputStatusDisplay'); d.value=i.text; d.style.color=i.color; d.style.fontWeight='bold';
    document.getElementById('checkNum').value=toPersianDigits(c.checkNum||''); document.getElementById('sayadNum').value=toPersianDigits(c.sayadNum||''); document.getElementById('inputDesc').value=c.desc||''; selectedColor=c.colorTag||'none'; document.querySelectorAll('.color-circle').forEach(x=>{x.classList.remove('selected-color'); if(x.getAttribute('data-color')===selectedColor)x.classList.add('selected-color');});
    if(c.frontImage){frontImageBase64=c.frontImage; updateImageBox('areaFront',c.frontImage);}else updateImageBox('areaFront',null); if(c.backImage){backImageBase64=c.backImage; updateImageBox('areaBack',c.backImage);}else updateImageBox('areaBack',null);
    currentType=c.type; if(c.type==='pay')updateTypeUI('typePay','typeReceive'); else updateTypeUI('typeReceive','typePay');
}
async function deleteCheck(id) { await dbDeleteCheck(id); alert('حذف شد'); window.location.href='check-list.html?filter=all'; }
function updateTypeUI(a,i) { document.getElementById(a).classList.add('active-type'); document.getElementById(i).classList.remove('active-type'); document.getElementById(a).style.color='#333'; document.getElementById(i).style.color='#bbb'; }
function openBankModal(){document.getElementById('bankModal').style.display='flex'; const c=document.getElementById('bankListContainer'); c.innerHTML=''; 
    const bks=[{code:'meli',name:'بانک ملی'},{code:'mellat',name:'بانک ملت'},{code:'sepah',name:'بانک سپه'},{code:'tejarat',name:'بانک تجارت'},{code:'saderat',name:'بانک صادرات'},{code:'saman',name:'بانک سامان'},{code:'pasargad',name:'بانک پاسارگاد'},{code:'refah',name:'بانک رفاه'},{code:'maskan',name:'بانک مسکن'},{code:'keshavarzi',name:'بانک کشاورزی'},{code:'parsian',name:'بانک پارسیان'},{code:'en',name:'اقتصاد نوین'},{code:'resalat',name:'قرض‌الحسنه رسالت'},{code:'shahr',name:'بانک شهر'},{code:'ansar',name:'بانک انصار'},{code:'dey',name:'بانک دی'},{code:'sina',name:'بانک سینا'},{code:'post',name:'پست بانک'},{code:'tosee',name:'توسعه تعاون'},{code:'ayandeh',name:'بانک آینده'}];
    bks.forEach(b=>{c.innerHTML+=`<div class="bank-option" onclick="selectBank('${b.code}')"><img src="${getBankLogoSrc(b.code)}" onerror="this.src='./logos/default.png'"><span>${b.name}</span></div>`});
}
function selectBank(b){document.getElementById('inputBankValue').value=b; document.getElementById('inputBankDisplay').value=getBankNameFA(b); document.getElementById('bankModal').style.display='none';}
function openStatusSelectionModal(){document.getElementById('statusSelectionModal').style.display='flex';}
function selectStatus(v,t,c){document.getElementById('inputStatusValue').value=v; const d=document.getElementById('inputStatusDisplay'); d.value=t; d.style.color=c; d.style.fontWeight='bold'; document.getElementById('statusSelectionModal').style.display='none';}
function openCounterpartyModal(e=false){isCpEditMode=e; document.getElementById('counterpartyModal').style.display='flex'; renderCounterpartyList();}
async function renderCounterpartyList() {
    const l=await fetchCounterparties(); const c=document.getElementById('counterpartyList'); c.innerHTML=''; 
    const searchVal = document.getElementById('cpSearchInput') ? document.getElementById('cpSearchInput').value : '';
    const fl = l.filter(p => p.name.includes(searchVal));
    if(fl.length===0){c.innerHTML='<div style="text-align:center;padding:30px;color:#999">لیست خالی است</div>';return;}
    fl.forEach(p=>{
        const act=isCpEditMode?`editCp('${p.id}','${p.name}','${p.phone}')`:`selectCp('${p.name}')`;
        c.innerHTML+=`<div class="cp-item" onclick="${act}"><div class="cp-avatar"><i class="fa-regular fa-user"></i></div><div class="cp-info"><span class="cp-name">${p.name}</span><span class="cp-phone">${p.phone?toPersianDigits(p.phone):'بدون شماره'}</span></div>${isCpEditMode?'<i class="fa-solid fa-pen" style="color:#ccc"></i>':''}</div>`;
    });
}
function searchCounterparty() { renderCounterpartyList(); }
async function saveNewCounterparty() { const n=document.getElementById('newCpName').value; const i=document.getElementById('newCpNationalId').value; const p=document.getElementById('newCpPhone').value; if(n){await dbAddCounterparty({name:n,nationalId:i,phone:p}); renderCounterpartyList(); document.getElementById('addCounterpartyModal').style.display='none'; document.getElementById('newCpName').value='';document.getElementById('newCpNationalId').value='';document.getElementById('newCpPhone').value='';}else alert('نام الزامی'); }
async function editCp(id,n,p) { const nn=prompt('نام:',n); if(nn){const pp=prompt('شماره:',p); await dbUpdateCounterparty(id,{name:nn,phone:pp}); renderCounterpartyList();} }
function selectCp(n) { document.getElementById('inputPayTo').value=n; document.getElementById('counterpartyModal').style.display='none'; }

// --- Image ---
function setupImageUploader(i,a,t) {
    const ar=document.getElementById(a), inP=document.getElementById(i);
    ar.onclick=()=>{currentUploadType=t; const img=t==='front'?frontImageBase64:backImageBase64; if(img){const m=document.getElementById('menuPreviewImg'); if(m){m.src=img; document.getElementById('imageMenuModal').style.display='flex';}}else inP.click();};
    inP.onchange=(e)=>{const f=e.target.files[0]; if(f){const r=new FileReader(); r.onload=(ev)=>openCropModal(ev.target.result,t); r.readAsDataURL(f); e.target.value='';}};
}
function updateImageBox(id,b) { const a=document.getElementById(id); if(b)a.innerHTML=`<img src="${b}" class="preview-img">`; else a.innerHTML=`<div class="img-placeholder"><i class="fa-solid fa-camera"></i></div><span class="upload-label">برای افزودن کلیک کنید</span>`; }
function openCropModal(s,t) { currentUploadType=t; document.getElementById('imageToCrop').src=s; document.getElementById('cropModal').style.display='flex'; if(cropper)cropper.destroy(); cropper=new Cropper(document.getElementById('imageToCrop'),{viewMode:1,autoCropArea:1}); }
function performCrop() { if(!cropper)return; const b=cropper.getCroppedCanvas({width:1000}).toDataURL('image/jpeg',0.7); if(currentUploadType==='front'){frontImageBase64=b;updateImageBox('areaFront',b);}else{backImageBase64=b;updateImageBox('areaBack',b);} document.getElementById('cropModal').style.display='none'; cropper.destroy(); cropper=null; }
function deleteCurrentImage() { if(!confirm('حذف؟'))return; if(currentUploadType==='front'){frontImageBase64=null;updateImageBox('areaFront',null);}else{backImageBase64=null;updateImageBox('areaBack',null);} document.getElementById('imageMenuModal').style.display='none'; }
function replaceCurrentImage() { document.getElementById('imageMenuModal').style.display='none'; document.getElementById(currentUploadType==='front'?'fileFront':'fileBack').click(); }
async function shareCurrentImage() { const b=currentUploadType==='front'?frontImageBase64:backImageBase64; try{const x=await(await fetch(b)).blob(); await navigator.share({files:[new File([x],'check.jpg',{type:'image/jpeg'})]});}catch(e){} document.getElementById('imageMenuModal').style.display='none'; }

// --- Cloud & Scan ---
async function handleSmartScan(inp) { const f=inp.files[0]; if(!f)return; showLoading("آنالیز..."); const r=new FileReader(); r.onload=async(e)=>{const i=new Image(); i.src=e.target.result; i.onload=async()=>{const c=document.createElement('canvas'); const s=1000/i.width; c.width=1000; c.height=i.height*s; c.getContext('2d').drawImage(i,0,0,c.width,c.height); try{const rs=await fetch(GOOGLE_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'scan_check_ocr',image:c.toDataURL('image/jpeg',0.6)})}); const j=await rs.json(); if(j.result==='success'){localStorage.setItem('scannedCheckData',JSON.stringify({sayad:j.data.sayad,date:j.data.date,amount:j.data.amount,image:e.target.result})); window.location.href='add-check.html?mode=scan';}else throw new Error(j.error);}catch(er){alert(er.message);}finally{hideLoading(); inp.value='';}}}; r.readAsDataURL(f); }
async function backupToGoogle() { exportToExcel(); alert('فایل اکسل دانلود شد. لطفا در گوگل درایو آپلود کنید.'); }
async function restoreFromGoogle() { alert('سیستم آنلاین است. نیازی به بازیابی نیست.'); }

// --- Report ---
async function setupReportPage() { let l=await fetchChecks(); const p=l.filter(x=>x.status==='pending'); let s=0; p.forEach(x=>{if(x.type==='pay')s-=parseInt(x.amount);else s+=parseInt(x.amount);}); const c=s<0?'#f44336':s>0?'#4caf50':'#333'; document.getElementById('reportTotalSum').innerHTML=`<span style="color:${c}">${s<0?'-':s>0?'+':''} ${toPersianDigits(Math.abs(s).toLocaleString())}</span> ریال`; const g={}; p.forEach(x=>{const k=toEnglishDigits(x.date).slice(0,7).replace('/','-'); if(!g[k])g[k]=[]; g[k].push(x);}); const ks=Object.keys(g).sort((a,b)=>parseInt(a.replace('-',''))-parseInt(b.replace('-',''))); const sc=document.getElementById('reportScrollContainer'); sc.innerHTML=''; if(ks.length===0){sc.innerHTML='<div style="text-align:center;width:100%">موردی نیست</div>';return;} ks.forEach(k=>{const [y,m]=k.split('-'); const gp=g[k]; let ms=0,mx=0,mn=Infinity; gp.forEach(x=>{const a=parseInt(x.amount); if(x.type==='pay')ms-=a;else ms+=a; if(a>mx)mx=a; if(a<mn)mn=a;}); sc.innerHTML+=`<div class="report-month-card"><div class="rm-header"><span class="rm-title">${getMonthName(m)} ${toPersianDigits(y)}</span><span class="rm-val" style="color:${ms<0?'#f44336':'#4caf50'}">${ms<0?'-':'+'} ${toPersianDigits(Math.abs(ms).toLocaleString())}</span></div><div class="rm-row"><span>تعداد:</span><span class="rm-val">${toPersianDigits(gp.length)}</span></div><div class="rm-row"><span>بیشترین:</span><span class="rm-val">${toPersianDigits(mx.toLocaleString())}</span></div><div class="rm-row"><span>کمترین:</span><span class="rm-val">${toPersianDigits(mn===Infinity?0:mn.toLocaleString())}</span></div></div>`;}); }