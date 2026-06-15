// ============================================================
// GAGE R&R SYSTEM — script.js (v2)
// ============================================================

// ── Google Sheets Apps Script URL ──────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzfXBOoDO6rg1jD0gd_Afu_tvznaeSmPl0LoBzDwP3zf290D8QWkOloOKzlz7FhSazkYw/exec';

// ── Kredensial Verifikasi ───────────────────────────────────
const VERIFY_CREDENTIALS = {
    input:    { username: '1',  password: '1' },
    protected:{ username: 'Q', password: 'Q' }
};

// ── Sub-Department & Line Map ───────────────────────────────
const SUB_DEPT_OPTIONS = [
    'Assembly','CSC','Cutting','DNS','IP',
    'MA','Preparation','Rubber','Stitching','Stockfit'
];

// Line options per sub-department
const LINE_OPTIONS = {
    Assembly:    buildNcvsLines(),
    CSC:         buildNcvsLines(),
    Cutting:     buildNcvsLines(),
    DNS:         buildNcvsLines(),
    IP:          buildNumberedLines('Line', 1, 8),
    MA:          buildNcvsLines(),
    Preparation: buildNcvsLines(),
    Rubber:      buildRubberLines(),
    Stitching:   buildNcvsLines(),
    Stockfit:    buildStockfitLines()
};

// Helper: NCVS 101-116 (kecuali 106) + 201-206
function buildNcvsLines() {
    const lines = [];
    for (let i = 101; i <= 116; i++) {
        if (i === 106) continue;
        lines.push('NCVS ' + i);
    }
    for (let i = 201; i <= 206; i++) {
        lines.push('NCVS ' + i);
    }
    return lines;
}

// Helper: Line 1–N
function buildNumberedLines(prefix, from, to) {
    const lines = [];
    for (let i = from; i <= to; i++) lines.push(prefix + ' ' + i);
    return lines;
}

// Helper: Rubber — Crafted 1–17 + Accessories
function buildRubberLines() {
    const lines = buildNumberedLines('Crafted', 1, 17);
    lines.push('Accessories');
    return lines;
}

// Helper: Stockfit — Line 1–10 + UV + Grinding
function buildStockfitLines() {
    const lines = buildNumberedLines('Line', 1, 10);
    lines.push('UV');
    lines.push('Grinding');
    return lines;
}

// ── Mapping area → baris Google Sheet (Sheet1 kolom D) ─────
const AREA_ROW_MAP = {
    Assembly:    { start: 2,  end: 6  },
    CSC:         { start: 7,  end: 11 },
    Cutting:     { start: 12, end: 16 },
    DNS:         { start: 17, end: 21 },
    IP:          { start: 22, end: 26 },
    MA:          { start: 27, end: 31 },
    Preparation: { start: 32, end: 36 },
    Rubber:      { start: 37, end: 41 },
    Stitching:   { start: 42, end: 46 },
    Stockfit:    { start: 47, end: 51 }
};

// ── State Global ────────────────────────────────────────────
let checkingData     = [];   // array semua item checking
let timerIntervals   = {};
let answerKeys       = {};   // { Assembly: { 1:'Pass-Pass', ... }, ... }
let defectKeys       = {};   // { Assembly: { 1: { left:['wrinkle'], right:['stain'] }, ... } }
let dateRange        = { start: '', end: '' };
let submittedData    = [];
let selectedEmployee = null;
let currentChecking  = 1;
let selectedArea     = null;
let tempAnswerKey    = {};
let tempDefectKey    = {};   // { 1: { left:[], right:[] }, ... } — sementara saat edit Auto List
let currentMode      = 'realtime';
let assessorList     = [];

// Session gate
let inputVerified    = false;
let autoListVerified = false;
let settingsVerified = false;
let verifyCallback   = null;

// ── Pairs Setting Helpers ────────────────────────────────────
function getNumSamplesSetting() {
    const val = localStorage.getItem('gageRnR_totalPairs');
    return val === '10' ? 10 : 5;
}

function setTotalPairs(n) {
    localStorage.setItem('gageRnR_totalPairs', n.toString());
    updatePairsSelectorUI(n);
    initializeCheckingData();
    if (selectedArea) {
        selectArea(selectedArea);
    }
}

function updatePairsSelectorUI(n) {
    const is5 = n === 5;
    
    // Update Input View selectors
    const btnInput5 = document.getElementById('inputPairsBtn5');
    const btnInput10 = document.getElementById('inputPairsBtn10');
    if (btnInput5) btnInput5.classList.toggle('active', is5);
    if (btnInput10) btnInput10.classList.toggle('active', !is5);

    // Update Auto List View selectors
    const btnAuto5 = document.getElementById('autoListPairsBtn5');
    const btnAuto10 = document.getElementById('autoListPairsBtn10');
    if (btnAuto5) btnAuto5.classList.toggle('active', is5);
    if (btnAuto10) btnAuto10.classList.toggle('active', !is5);
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    loadFromStorage();
    updatePairsSelectorUI(getNumSamplesSetting());
    fetchAnswerKeysFromSheet();
    fetchDateRangeFromSheet();
    fetchAssessorsFromSheet();
    initializeCheckingData();
    navigateTo('input');

    document.addEventListener('click', function (e) {
        if (!e.target.closest('#assessorInput') && !e.target.closest('#assessorDropdown')) {
            const dd = document.getElementById('assessorDropdown');
            if (dd) dd.classList.add('hidden');
        }
    });
});

// ============================================================
// LOCAL STORAGE
// ============================================================
function saveToStorage() {
    localStorage.setItem('gageRnR_submittedData', JSON.stringify(submittedData));
    localStorage.setItem('gageRnR_defectKeys', JSON.stringify(defectKeys));
    localStorage.setItem('gageRnR_localAnswerKeys', JSON.stringify(answerKeys));
}

function loadFromStorage() {
    const saved = localStorage.getItem('gageRnR_submittedData');
    if (saved) submittedData = JSON.parse(saved);

    const savedDefects = localStorage.getItem('gageRnR_defectKeys');
    if (savedDefects) defectKeys = JSON.parse(savedDefects);

    const savedLocalKeys = localStorage.getItem('gageRnR_localAnswerKeys');
    if (savedLocalKeys) {
        const parsed = JSON.parse(savedLocalKeys);
        for (const area in parsed) {
            if (!answerKeys[area]) answerKeys[area] = {};
            Object.assign(answerKeys[area], parsed[area]);
        }
    }
}

// ============================================================
// GOOGLE SHEETS — FETCH & POST
// ============================================================
async function sheetGet(action) {
    try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=${action}`);
        return await res.json();
    } catch (e) {
        console.error('GET error:', e);
        return { status: 'error', message: e.toString() };
    }
}

async function sheetPost(body) {
    try {
        const res = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        return await res.json();
    } catch (e) {
        console.error('POST error:', e);
        return { status: 'error', message: e.toString() };
    }
}

async function fetchAssessorsFromSheet() {
    const res = await sheetGet('getAssessors');
    if (res.status === 'success') assessorList = res.data || [];
}

async function saveAssessorToSheet(name) {
    await sheetPost({ action: 'saveAssessor', name });
    await fetchAssessorsFromSheet();
}

async function fetchAnswerKeysFromSheet() {
    const res = await sheetGet('getAnswerKeys');
    if (res.status === 'success') {
        answerKeys = res.data || {};
        
        // Merge dengan data local untuk sample > 5
        const savedLocal = localStorage.getItem('gageRnR_localAnswerKeys');
        if (savedLocal) {
            const localKeys = JSON.parse(savedLocal);
            for (const area in localKeys) {
                if (!answerKeys[area]) answerKeys[area] = {};
                for (const sample in localKeys[area]) {
                    if (parseInt(sample) > 5) {
                        answerKeys[area][sample] = localKeys[area][sample];
                    }
                }
            }
        }
        
        updateAutoFillButton();
        renderAreaSelector();
    }
}

async function saveAnswerKeyToSheet(area, answers) {
    return await sheetPost({ action: 'saveAnswerKey', area, answers });
}

async function deleteAnswerKeyFromSheet(area) {
    return await sheetPost({ action: 'deleteAnswerKey', area });
}

async function fetchDateRangeFromSheet() {
    const res = await sheetGet('getDateRange');
    if (res.status === 'success' && res.data) {
        dateRange = res.data;
        const elStart = document.getElementById('dateStart');
        const elEnd   = document.getElementById('dateEnd');
        if (elStart) elStart.value = dateRange.start || '';
        if (elEnd)   elEnd.value   = dateRange.end   || '';
    }
    checkPeriodeBanner();
}

async function saveDateRangeToSheet(start, end) {
    return await sheetPost({ action: 'saveDateRange', start, end });
}

// Kirim submission ke Sheet2
async function sendSubmissionToSheet(submission) {
    return await sheetPost({ action: 'saveSubmission', submission });
}

// ============================================================
// PERIODE BANNER — cek apakah hari ini dalam rentang periode
// ============================================================
function checkPeriodeBanner() {
    const banner   = document.getElementById('periodeBanner');
    const inputView = document.getElementById('inputView');
    if (!banner) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let isOutside = false;

    if (dateRange.start && dateRange.end) {
        const start = new Date(dateRange.start);
        const end   = new Date(dateRange.end);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        isOutside = today < start || today > end;
    }

    if (isOutside) {
        banner.classList.remove('hidden');
        if (inputView) inputView.classList.add('periode-active');
    } else {
        banner.classList.add('hidden');
        if (inputView) inputView.classList.remove('periode-active');
    }
}

// ============================================================
// VERIFIKASI MODAL
// ============================================================
function openVerifyModal(title, subtitle, type, callback) {
    verifyCallback = { type, callback };
    document.getElementById('verifyModalTitle').textContent    = title;
    document.getElementById('verifyModalSubtitle').textContent = subtitle;
    document.getElementById('verifyUsername').value = '';
    document.getElementById('verifyPassword').value = '';
    document.getElementById('verifyError').classList.add('hidden');
    document.getElementById('verifyModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('verifyUsername').focus(), 100);
}

function closeVerifyModal() {
    document.getElementById('verifyModal').classList.add('hidden');
    verifyCallback = null;
}

function submitVerify() {
    if (!verifyCallback) return;
    const username = document.getElementById('verifyUsername').value.trim();
    const password = document.getElementById('verifyPassword').value;
    const cred     = VERIFY_CREDENTIALS[verifyCallback.type];

    if (username === cred.username && password === cred.password) {
        const successCallback = verifyCallback.callback;
        closeVerifyModal();
        successCallback();
    } else {
        document.getElementById('verifyError').classList.remove('hidden');
        document.getElementById('verifyPassword').value = '';
        document.getElementById('verifyPassword').focus();
    }
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !document.getElementById('verifyModal').classList.contains('hidden')) {
        submitVerify();
    }
});

function requestDeleteData() {
    openVerifyModal(
        'Verifikasi Hapus Data',
        'Masukkan kredensial admin untuk menghapus data ini.',
        'protected',
        function () { deleteEmployeeData(); }
    );
}

// ============================================================
// NAVIGASI
// ============================================================
function navigateTo(view) {
    ['inputView','autoListView','dataNilaiView','settingsView'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
    toggleSidebar(false);

    if (view === 'input') {
        document.getElementById('menuInput').classList.add('active');
        document.getElementById('headerTitle').textContent = 'Input Data';

        if (!inputVerified) {
            openVerifyModal(
                'Verifikasi Input Data',
                'Masukkan kredensial untuk mengakses halaman Input Data.',
                'input',
                function () {
                    inputVerified = true;
                    document.getElementById('inputView').classList.remove('hidden');
                    checkPeriodeBanner();
                }
            );
        } else {
            document.getElementById('inputView').classList.remove('hidden');
            checkPeriodeBanner();
        }

    } else if (view === 'autolist') {
        document.getElementById('menuAutoList').classList.add('active');
        document.getElementById('headerTitle').textContent = 'Auto List Sample';

        if (!autoListVerified) {
            openVerifyModal(
                'Verifikasi Auto List Sample',
                'Masukkan kredensial admin untuk mengatur Answer Keys.',
                'protected',
                function () {
                    autoListVerified = true;
                    document.getElementById('autoListView').classList.remove('hidden');
                    renderAreaSelector();
                }
            );
        } else {
            document.getElementById('autoListView').classList.remove('hidden');
            renderAreaSelector();
        }

    } else if (view === 'datanilai') {
        document.getElementById('dataNilaiView').classList.remove('hidden');
        document.getElementById('menuDataNilai').classList.add('active');
        document.getElementById('headerTitle').textContent = 'Data Nilai';
        document.getElementById('employeeList').classList.remove('hidden');
        document.getElementById('employeeDetail').classList.add('hidden');
        document.getElementById('filterContainer').classList.remove('hidden');
        renderEmployeeList();

    } else if (view === 'settings') {
        document.getElementById('menuSettings').classList.add('active');
        document.getElementById('headerTitle').textContent = 'Pengaturan Periode';

        if (!settingsVerified) {
            openVerifyModal(
                'Verifikasi Pengaturan',
                'Masukkan kredensial admin untuk mengubah periode.',
                'protected',
                function () {
                    settingsVerified = true;
                    document.getElementById('settingsView').classList.remove('hidden');
                    fetchDateRangeFromSheet();
                }
            );
        } else {
            document.getElementById('settingsView').classList.remove('hidden');
            fetchDateRangeFromSheet();
        }
    }
}

// ============================================================
// SIDEBAR
// ============================================================
function toggleSidebar(force) {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('overlay');
    const isActive = sidebar.classList.contains('active');

    if (force === false || isActive) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.add('active');
        overlay.classList.add('active');
    }
}

// ============================================================
// AUTOCOMPLETE PENILAI
// ============================================================
function filterAssessorSuggestions() {
    const input    = document.getElementById('assessorInput').value.trim().toLowerCase();
    const dropdown = document.getElementById('assessorDropdown');
    if (!input) { dropdown.classList.add('hidden'); return; }

    const matches = assessorList.filter(name => name.toLowerCase().includes(input));
    if (matches.length === 0) { dropdown.classList.add('hidden'); return; }

    dropdown.innerHTML = matches.map(name =>
        `<div class="autocomplete-item" onclick="selectAssessor('${name}')">${highlightMatch(name, input)}</div>`
    ).join('');
    dropdown.classList.remove('hidden');
}

function highlightMatch(name, query) {
    const idx = name.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return name;
    return name.substring(0, idx)
        + `<mark>${name.substring(idx, idx + query.length)}</mark>`
        + name.substring(idx + query.length);
}

function selectAssessor(name) {
    document.getElementById('assessorInput').value = name;
    document.getElementById('assessorDropdown').classList.add('hidden');
}

// ============================================================
// NIK HANDLER
// ============================================================
function handleNikChange() {
    const nik  = document.getElementById('nikInput').value.trim();
    const name = getEmployeeName(nik);
    document.getElementById('nameInput').value = name || '';
    if (nik && !name) alert('NIK tidak ditemukan dalam database!');
}

// ============================================================
// LINE — Conditional berdasarkan Sub-Department
// ============================================================
function renderLineOptions(subDept) {
    const select = document.getElementById('lineInput');
    select.innerHTML = '<option value="">Pilih Line</option>';

    if (!subDept || !LINE_OPTIONS[subDept]) {
        select.innerHTML = '<option value="">Pilih Sub-Department terlebih dahulu</option>';
        return;
    }

    LINE_OPTIONS[subDept].forEach(line => {
        const opt = document.createElement('option');
        opt.value = line;
        opt.textContent = line;
        select.appendChild(opt);
    });
}

// ============================================================
// SUB-DEPARTMENT CHANGE
// ============================================================
function handleSubDeptChange() {
    const area  = document.getElementById('subDeptInput').value;
    const notif = document.getElementById('subDeptKeyNotif');
    const sel   = document.getElementById('subDeptInput');

    // Render line options sesuai area
    renderLineOptions(area);

    if (area && answerKeys[area]) {
        notif.classList.remove('hidden');
        sel.classList.add('has-answer-key');
    } else {
        notif.classList.add('hidden');
        sel.classList.remove('has-answer-key');
    }

    updateAutoFillButton();
}

// ============================================================
// AUTO FILL — Mode & Button
// ============================================================
function updateAutoFillButton() {
    const area = document.getElementById('subDeptInput')?.value;
    const btn  = document.getElementById('autoFillBtn');
    if (!btn) return;

    if (area && answerKeys[area]) {
        btn.disabled = false;
        btn.classList.remove('btn-disabled');
    } else {
        btn.disabled = true;
        btn.classList.add('btn-disabled');
    }
}

function toggleModePanel() {
    document.getElementById('modePanel').classList.toggle('hidden');
}

function setMode(mode) {
    currentMode = mode;
    document.getElementById('modeRealtime').classList.toggle('active', mode === 'realtime');
    document.getElementById('modePostProcess').classList.toggle('active', mode === 'postprocess');

    const desc = document.getElementById('modeDescription');
    const dateGroup = document.getElementById('dateInspectionGroup');

    if (mode === 'realtime') {
        desc.textContent = '⚡ Digunakan untuk kondisi ketika data diinput langsung selama proses audit berlangsung.';
        document.getElementById('randomTimerPanel').classList.add('hidden');
        if (dateGroup) dateGroup.style.display = 'none';
    } else {
        desc.textContent = '📋 Digunakan untuk kondisi ketika data baru diinput setelah proses audit selesai.';
        document.getElementById('randomTimerPanel').classList.remove('hidden');
        if (dateGroup) dateGroup.style.display = '';
    }

    renderCheckingData();
}

function applyAutoFill() {
    const area = document.getElementById('subDeptInput').value;
    if (!area || !answerKeys[area]) {
        alert('Pilih Sub-Department yang memiliki answer key terlebih dahulu!');
        return;
    }

    const key        = answerKeys[area];
    const defectKey  = defectKeys[area] || {};

    if (currentMode === 'realtime') {
        checkingData.forEach(item => {
            if (item.checking === currentChecking) {
                const sampleKey = key[item.sample];
                if (sampleKey) {
                    applyAnswerToItem(item, sampleKey);
                    applyDefectsFromKey(item, defectKey[item.sample]);
                }
            }
        });
    } else {
        checkingData.forEach(item => {
            const sampleKey = key[item.sample];
            if (sampleKey) {
                applyAnswerToItem(item, sampleKey);
                applyDefectsFromKey(item, defectKey[item.sample]);
            }
        });

        const min = parseInt(document.getElementById('randomTimerMin').value) || 30;
        const max = parseInt(document.getElementById('randomTimerMax').value) || 60;
        checkingData.forEach((item, idx) => {
            checkingData[idx].cycleTime = Math.floor(Math.random() * (max - min + 1)) + min;
        });
    }

    renderCheckingData();
}

function applyAnswerToItem(item, keyString) {
    const parts = keyString.split('-');
    item.left  = parts[0] ? parts[0].trim() : '';
    item.right = parts[1] ? parts[1].trim() : '';
}

// Terapkan defect dari answer key ke item checking
// defectSample = { left: ['wrinkle'], right: ['stain'] }
function applyDefectsFromKey(item, defectSample) {
    if (!defectSample) {
        item.defectLeft  = [];
        item.defectRight = [];
        return;
    }
    // Hanya aktifkan defect jika side tersebut fail
    item.defectLeft  = item.left  === 'Fail' ? (defectSample.left  || []).slice() : [];
    item.defectRight = item.right === 'Fail' ? (defectSample.right || []).slice() : [];
}

// ============================================================
// CHECKING DATA — Initialize
// ============================================================
function initializeCheckingData() {
    Object.values(timerIntervals).forEach(clearInterval);
    timerIntervals = {};

    const totalSamples = getNumSamplesSetting();
    checkingData = [];
    for (let check = 1; check <= 3; check++) {
        for (let sample = 1; sample <= totalSamples; sample++) {
            checkingData.push({
                checking:     check,
                sample:       sample,
                left:         '',
                right:        '',
                cycleTime:    0,
                timerStatus:  'stopped',
                defectLeft:   [],    // defect terpilih sisi kiri
                defectRight:  [],    // defect terpilih sisi kanan
                defectLeftCustom:  [],   // defect manual (non-preset) kiri
                defectRightCustom: []    // defect manual (non-preset) kanan
            });
        }
    }
    currentChecking = 1;
    renderCheckingData();
    updateNavigationButtons();
}

// ============================================================
// CHECKING DATA — Render
// ============================================================
function renderCheckingData() {
    for (let check = 1; check <= 3; check++) {
        const container = document.getElementById(`checking-${check}`);
        if (!container) continue;
        container.innerHTML = '';

        const checkData = checkingData.filter(item => item.checking === check);
        const wrapper   = document.createElement('div');
        wrapper.className = 'checking-container';

        checkData.forEach(item => {
            const globalIdx = checkingData.findIndex(
                d => d.checking === item.checking && d.sample === item.sample
            );
            wrapper.appendChild(buildCheckingItem(item, globalIdx));
        });

        container.appendChild(wrapper);
    }
    showCheckingPage(currentChecking);
}

// ── Build satu checking item DOM ────────────────────────────
function buildCheckingItem(item, idx) {
    const div = document.createElement('div');
    div.className = 'checking-item';
    div.id = `checkItem-${idx}`;

    // Timer
    let timerHTML = '';
    if (currentMode === 'realtime') {
        const icon = item.timerStatus === 'running' ? '⏸️' : '▶️';
        timerHTML = `
            <div class="timer-controls-inline">
                <button id="timer-btn-${idx}" class="timer-btn-small ${item.timerStatus}" onclick="toggleTimer(${idx})">${icon}</button>
                <input type="number" id="time-${idx}" class="timer-input-small"
                    value="${item.cycleTime}" oninput="manualSetTime(${idx}, this.value)" min="0">
                <span class="timer-label-small">dtk</span>
            </div>`;
    } else {
        timerHTML = `
            <div class="timer-controls-inline">
                <input type="number" id="time-${idx}" class="timer-input-small"
                    value="${item.cycleTime}" oninput="manualSetTime(${idx}, this.value)" min="0">
                <span class="timer-label-small">dtk</span>
            </div>`;
    }

    const selected = item.left && item.right ? `${item.left}-${item.right}` : '';

    div.innerHTML = `
        <div class="checking-item-header">
            <div class="checking-title">Sample ${item.sample}</div>
            ${timerHTML}
        </div>
        <div class="pf-combo-group" id="combo-${idx}">
            ${buildComboButtons(idx, selected)}
        </div>
        <div id="defect-section-${idx}"></div>`;

    // Render defect section setelah DOM tersedia
    setTimeout(() => renderDefectSection(idx), 0);

    return div;
}

// ── Build tombol kombinasi Pass/Fail ────────────────────────
function buildComboButtons(idx, selected) {
    const combos = ['Pass-Pass', 'Fail-Fail', 'Pass-Fail', 'Fail-Pass'];
    return combos.map(combo => {
        const isSelected = selected === combo;
        const isHidden   = selected && !isSelected;
        const [left, right] = combo.split('-');
        const lc = left  === 'Pass' ? 'combo-pass' : 'combo-fail';
        const rc = right === 'Pass' ? 'combo-pass' : 'combo-fail';
        return `
            <button class="combo-btn ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-combo' : ''}"
                onclick="selectCombo(${idx}, '${combo}')">
                <span class="combo-side ${lc}">${left}</span>
                <span class="combo-sep">—</span>
                <span class="combo-side ${rc}">${right}</span>
            </button>`;
    }).join('');
}

// ── Pilih kombinasi Pass/Fail ───────────────────────────────
function selectCombo(idx, combo) {
    const item    = checkingData[idx];
    const current = item.left && item.right ? `${item.left}-${item.right}` : '';

    if (current === combo) {
        // Deselect
        checkingData[idx].left  = '';
        checkingData[idx].right = '';
    } else {
        const [left, right] = combo.split('-');
        checkingData[idx].left  = left;
        checkingData[idx].right = right;
    }

    // Reset defect saat combo berubah
    checkingData[idx].defectLeft         = [];
    checkingData[idx].defectRight        = [];
    checkingData[idx].defectLeftCustom   = [];
    checkingData[idx].defectRightCustom  = [];

    // Re-render combo
    const comboGroup   = document.getElementById(`combo-${idx}`);
    const newSelected  = checkingData[idx].left && checkingData[idx].right
        ? `${checkingData[idx].left}-${checkingData[idx].right}` : '';
    if (comboGroup) comboGroup.innerHTML = buildComboButtons(idx, newSelected);

    // Re-render defect section
    renderDefectSection(idx);
    checkAutoScroll();
}

// ── Auto scroll ke checking berikutnya ─────────────────────
function checkAutoScroll() {
    const currentCheckData = checkingData.filter(item => item.checking === currentChecking);
    const allFilled = currentCheckData.every(item =>
        item.left && item.right && item.cycleTime > 0
    );
    if (allFilled && currentChecking < 3) setTimeout(() => nextChecking(), 500);
}

// ============================================================
// DEFECT SECTION — Input Data
// ============================================================
// Render kotak defect di bawah combo P/F pada input data
function renderDefectSection(idx) {
    const container = document.getElementById(`defect-section-${idx}`);
    if (!container) return;

    const item      = checkingData[idx];
    const leftFail  = item.left  === 'Fail';
    const rightFail = item.right === 'Fail';

    // Jika belum ada pilihan combo, sembunyikan section
    if (!item.left && !item.right) {
        container.innerHTML = '';
        return;
    }
    // Pass-Pass: tidak tampilkan
    if (!leftFail && !rightFail) {
        container.innerHTML = '';
        return;
    }

    const area       = document.getElementById('subDeptInput')?.value || '';
    const sampleNum  = item.sample;
    const presetData = (defectKeys[area] || {})[sampleNum] || { left: [], right: [] };

    container.innerHTML = `<div class="defect-divider"></div>
        <div class="defect-sides-wrapper" id="defect-sides-${idx}"></div>`;

    const sidesWrapper = document.getElementById(`defect-sides-${idx}`);

    // Kiri
    if (leftFail) {
        sidesWrapper.appendChild(
            buildDefectSideBlock(idx, 'left', presetData.left || [], item.defectLeft, item.defectLeftCustom)
        );
    }
    // Kanan
    if (rightFail) {
        sidesWrapper.appendChild(
            buildDefectSideBlock(idx, 'right', presetData.right || [], item.defectRight, item.defectRightCustom)
        );
    }
}

// Bangun satu blok defect (kiri atau kanan) untuk input data
function buildDefectSideBlock(idx, side, presets, selectedPresets, customTags) {
    const block = document.createElement('div');
    block.className = 'defect-side-block';
    block.id = `defect-block-${idx}-${side}`;

    const label = document.createElement('span');
    label.className = `defect-side-label label-fail`;
    label.textContent = side === 'left' ? '← Kiri' : 'Kanan →';
    block.appendChild(label);

    // Preset tags dari answer key
    if (presets.length > 0) {
        const presetContainer = document.createElement('div');
        presetContainer.className = 'defect-preset-container';

        presets.forEach(defectName => {
            const btn = document.createElement('button');
            btn.className = 'defect-tag-preset' + (selectedPresets.includes(defectName) ? ' active' : '');
            btn.textContent = defectName;
            btn.onclick = () => togglePresetDefect(idx, side, defectName);
            presetContainer.appendChild(btn);
        });
        block.appendChild(presetContainer);
    }

    // Custom tags yang sudah dienter
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'defect-tags-container';
    tagsContainer.id = `custom-tags-${idx}-${side}`;
    customTags.forEach(tag => {
        tagsContainer.appendChild(buildCustomTag(idx, side, tag));
    });
    block.appendChild(tagsContainer);

    // Input box manual
    const inputWrap = document.createElement('div');
    inputWrap.className = 'defect-input-wrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'defect-input-box';
    input.placeholder = 'Tulis defect, tekan Enter...';
    input.id = `defect-input-${idx}-${side}`;
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomDefect(idx, side, this.value.trim());
            this.value = '';
        }
    });
    inputWrap.appendChild(input);
    block.appendChild(inputWrap);

    return block;
}

// Toggle preset defect aktif/nonaktif
function togglePresetDefect(idx, side, defectName) {
    const arr = side === 'left' ? checkingData[idx].defectLeft : checkingData[idx].defectRight;
    const pos = arr.indexOf(defectName);
    if (pos > -1) {
        arr.splice(pos, 1);
    } else {
        arr.push(defectName);
    }
    // Update tampilan tombol tanpa re-render penuh
    const block = document.getElementById(`defect-block-${idx}-${side}`);
    if (block) {
        block.querySelectorAll('.defect-tag-preset').forEach(btn => {
            btn.classList.toggle('active', arr.includes(btn.textContent));
        });
    }
}

// Tambah custom defect dari input box
function addCustomDefect(idx, side, value) {
    if (!value) return;
    const arr = side === 'left'
        ? checkingData[idx].defectLeftCustom
        : checkingData[idx].defectRightCustom;
    arr.push(value);

    const container = document.getElementById(`custom-tags-${idx}-${side}`);
    if (container) container.appendChild(buildCustomTag(idx, side, value));
}

// Hapus custom defect
function removeCustomDefect(idx, side, value) {
    const arr = side === 'left'
        ? checkingData[idx].defectLeftCustom
        : checkingData[idx].defectRightCustom;
    const pos = arr.indexOf(value);
    if (pos > -1) arr.splice(pos, 1);

    const container = document.getElementById(`custom-tags-${idx}-${side}`);
    if (container) {
        Array.from(container.querySelectorAll('.defect-tag')).forEach(el => {
            if (el.dataset.value === value) el.remove();
        });
    }
}

// Build tag custom
function buildCustomTag(idx, side, value) {
    const tag = document.createElement('span');
    tag.className   = 'defect-tag';
    tag.dataset.value = value;

    const text = document.createElement('span');
    text.textContent = value;

    const del = document.createElement('button');
    del.className   = 'defect-tag-delete';
    del.textContent = '×';
    del.title       = 'Hapus';
    del.onclick     = () => removeCustomDefect(idx, side, value);

    tag.appendChild(text);
    tag.appendChild(del);
    return tag;
}

// Kumpulkan semua defect (preset + custom) untuk satu item & side
function collectDefects(idx, side) {
    const item   = checkingData[idx];
    const preset = side === 'left' ? item.defectLeft  : item.defectRight;
    const custom = side === 'left' ? item.defectLeftCustom : item.defectRightCustom;
    return [...preset, ...custom];
}

// ============================================================
// TIMER
// ============================================================
function toggleTimer(idx) {
    const item = checkingData[idx];
    const btn  = document.getElementById(`timer-btn-${idx}`);

    if (item.timerStatus === 'stopped' || item.timerStatus === 'paused') {
        item.timerStatus = 'running';
        if (btn) { btn.className = 'timer-btn-small running'; btn.innerHTML = '⏸️'; }
        timerIntervals[idx] = setInterval(() => {
            checkingData[idx].cycleTime++;
            const inp = document.getElementById(`time-${idx}`);
            if (inp) inp.value = checkingData[idx].cycleTime;
        }, 1000);
    } else {
        item.timerStatus = 'paused';
        clearInterval(timerIntervals[idx]);
        if (btn) { btn.className = 'timer-btn-small paused'; btn.innerHTML = '▶️'; }
    }
}

function manualSetTime(idx, value) {
    const parsed = parseInt(value);
    checkingData[idx].cycleTime = isNaN(parsed) ? 0 : parsed;
}

// ============================================================
// NAVIGASI CHECKING
// ============================================================
function showCheckingPage(checkNum) {
    for (let i = 1; i <= 3; i++) {
        const page = document.getElementById(`checking-${i}`);
        if (!page) continue;
        page.classList.toggle('active', i === checkNum);
    }
    document.getElementById('checkingIndicator').textContent = `Pemeriksaan ${checkNum} dari 3`;
    updateNavigationButtons();
}

function prevChecking() {
    if (currentChecking > 1) { currentChecking--; showCheckingPage(currentChecking); }
}

function nextChecking() {
    if (currentChecking < 3) { currentChecking++; showCheckingPage(currentChecking); }
}

function updateNavigationButtons() {
    const prev = document.getElementById('prevBtn');
    const next = document.getElementById('nextBtn');
    if (prev) prev.disabled = currentChecking === 1;
    if (next) next.disabled = currentChecking === 3;
}

// ============================================================
// SAVE DATA
// ============================================================
async function saveData() {
    // Cek periode
    const inputView = document.getElementById('inputView');
    if (inputView && inputView.classList.contains('periode-active')) {
        alert('Periode Gage R&R telah berakhir. Data tidak dapat disimpan.');
        return;
    }

    const assessor = document.getElementById('assessorInput').value.trim();
    const nik      = document.getElementById('nikInput').value.trim();
    const name     = document.getElementById('nameInput').value.trim();
    const subDept  = document.getElementById('subDeptInput').value;
    const line     = document.getElementById('lineInput').value;

    if (!assessor) { alert('Mohon isi nama Penilai!'); return; }
    if (!nik || !name) { alert('Mohon isi NIK terlebih dahulu!'); return; }
    if (!subDept)  { alert('Mohon pilih Sub-Department Area!'); return; }
    if (!line)     { alert('Mohon pilih Line!'); return; }

    // Tanggal inspection
    let inspectionDate = '';
    if (currentMode === 'postprocess') {
        const dateInput = document.getElementById('dateInspectionInput').value;
        if (!dateInput) { alert('Mohon isi Tanggal Inspection!'); return; }
        inspectionDate = dateInput; // format YYYY-MM-DD
    } else {
        // Realtime: tanggal inspection = hari ini
        inspectionDate = getTodayISO();
    }

    const allFilled = checkingData.every(item => item.left && item.right && item.cycleTime > 0);
    if (!allFilled) {
        alert('Semua data checking wajib diisi!\nPastikan semua Pass/Fail dan Cycle Time telah diisi.');
        return;
    }

    const now = new Date();
    const submission = {
        assessor,
        nik,
        name,
        subDept,
        line,
        inspectionDate,               // tanggal inspection (acuan periode & tampilan)
        timestamp: now.toISOString(), // waktu input data (added time)
        mode: currentMode,
        data: JSON.parse(JSON.stringify(checkingData))
    };

    submittedData.push(submission);
    saveToStorage();

    // Kirim ke Sheet2
    const addedTime = formatDateTimeFull(now);
    const dateDisp  = formatDateOnlyDisplay(new Date(inspectionDate));
    await saveAssessorToSheet(assessor);
    await sendSubmissionToSheet({
        addedTime,
        date:       dateDisp,
        name,
        nik,
        department: subDept,
        line,
        assessor,
        data:       submission.data
    });

    alert('Data berhasil disimpan!');
    resetForm();
}

// ============================================================
// RESET FORM
// ============================================================
function resetForm() {
    document.getElementById('assessorInput').value = '';
    document.getElementById('nikInput').value      = '';
    document.getElementById('nameInput').value     = '';
    document.getElementById('subDeptInput').value  = '';
    document.getElementById('lineInput').innerHTML = '<option value="">Pilih Sub-Department terlebih dahulu</option>';
    document.getElementById('subDeptKeyNotif').classList.add('hidden');
    document.getElementById('subDeptInput').classList.remove('has-answer-key');

    const dateGroup = document.getElementById('dateInspectionGroup');
    if (dateGroup) {
        const di = document.getElementById('dateInspectionInput');
        if (di) di.value = '';
    }

    Object.values(timerIntervals).forEach(clearInterval);
    timerIntervals = {};
    initializeCheckingData();
    updateAutoFillButton();
}

// ============================================================
// ANSWER KEY + DEFECT KEY — Auto List Sample
// ============================================================
function renderAreaSelector() {
    const container = document.getElementById('areaSelector');
    if (!container) return;
    container.innerHTML = '';

    SUB_DEPT_OPTIONS.forEach(area => {
        const btn = document.createElement('button');
        btn.className = 'area-btn';
        btn.textContent = area;
        if (answerKeys[area]) btn.classList.add('has-key');
        if (selectedArea === area) btn.classList.add('active');
        btn.onclick = () => selectArea(area);
        container.appendChild(btn);
    });
}

function selectArea(area) {
    selectedArea = area;
    renderAreaSelector();

    document.getElementById('answerKeyForm').classList.remove('hidden');

    const totalSamples = getNumSamplesSetting();

    // Init tempAnswerKey
    tempAnswerKey = answerKeys[area] ? JSON.parse(JSON.stringify(answerKeys[area])) : {};
    for (let i = 1; i <= totalSamples; i++) {
        if (tempAnswerKey[i] === undefined) tempAnswerKey[i] = '';
    }

    // Init tempDefectKey
    tempDefectKey = defectKeys[area] ? JSON.parse(JSON.stringify(defectKeys[area])) : {};
    for (let i = 1; i <= totalSamples; i++) {
        if (!tempDefectKey[i]) tempDefectKey[i] = { left: [], right: [] };
    }

    renderAnswerKeyForm();
}

function renderAnswerKeyForm() {
    const container = document.getElementById('sampleKeyContainer');
    if (!container) return;
    container.innerHTML = '';

    const combos = ['Pass-Pass', 'Fail-Fail', 'Pass-Fail', 'Fail-Pass'];
    const totalSamples = getNumSamplesSetting();

    for (let i = 1; i <= totalSamples; i++) {
        const selected = tempAnswerKey[i] || '';

        const item = document.createElement('div');
        item.className = 'sample-key-item';
        item.id = `sample-key-item-${i}`;

        item.innerHTML = `
            <div class="sample-key-header">Sample ${i}</div>
            <div class="key-combo-group" id="keyCombo-${i}">
                ${combos.map(combo => {
                    const isSel    = selected === combo;
                    const isHidden = selected && !isSel;
                    const [l, r]   = combo.split('-');
                    const lc = l === 'Pass' ? 'combo-pass' : 'combo-fail';
                    const rc = r === 'Pass' ? 'combo-pass' : 'combo-fail';
                    return `<button class="combo-btn ${isSel ? 'selected' : ''} ${isHidden ? 'hidden-combo' : ''}"
                        onclick="setKeyCombo(${i}, '${combo}')">
                        <span class="combo-side ${lc}">${l}</span>
                        <span class="combo-sep">—</span>
                        <span class="combo-side ${rc}">${r}</span>
                    </button>`;
                }).join('')}
            </div>
            <div id="key-defect-section-${i}"></div>`;

        container.appendChild(item);
        renderKeyDefectSection(i);
    }
}

// Set combo di Auto List Sample
function setKeyCombo(sample, combo) {
    const current = tempAnswerKey[sample] || '';
    if (current === combo) {
        tempAnswerKey[sample] = '';
    } else {
        tempAnswerKey[sample] = combo;
    }

    // Reset defect saat combo berubah
    if (!tempDefectKey[sample]) tempDefectKey[sample] = { left: [], right: [] };
    tempDefectKey[sample].left  = [];
    tempDefectKey[sample].right = [];

    // Re-render combo buttons
    const group  = document.getElementById(`keyCombo-${sample}`);
    const combos = ['Pass-Pass', 'Fail-Fail', 'Pass-Fail', 'Fail-Pass'];
    const newSel = tempAnswerKey[sample] || '';

    if (group) {
        group.innerHTML = combos.map(c => {
            const isSel    = newSel === c;
            const isHidden = newSel && !isSel;
            const [l, r]   = c.split('-');
            const lc = l === 'Pass' ? 'combo-pass' : 'combo-fail';
            const rc = r === 'Pass' ? 'combo-pass' : 'combo-fail';
            return `<button class="combo-btn ${isSel ? 'selected' : ''} ${isHidden ? 'hidden-combo' : ''}"
                onclick="setKeyCombo(${sample}, '${c}')">
                <span class="combo-side ${lc}">${l}</span>
                <span class="combo-sep">—</span>
                <span class="combo-side ${rc}">${r}</span>
            </button>`;
        }).join('');
    }

    renderKeyDefectSection(sample);
}

// ── Render defect section di Auto List Sample ───────────────
function renderKeyDefectSection(sample) {
    const container = document.getElementById(`key-defect-section-${sample}`);
    if (!container) return;

    const combo    = tempAnswerKey[sample] || '';
    const [l, r]   = combo ? combo.split('-') : ['', ''];
    const leftFail = l === 'Fail';
    const rightFail= r === 'Fail';

    if (!leftFail && !rightFail) {
        container.innerHTML = '';
        return;
    }

    if (!tempDefectKey[sample]) tempDefectKey[sample] = { left: [], right: [] };

    container.innerHTML = `<div class="defect-divider"></div>
        <div class="defect-sides-wrapper" id="key-defect-sides-${sample}"></div>`;

    const sidesWrapper = document.getElementById(`key-defect-sides-${sample}`);

    if (leftFail) {
        sidesWrapper.appendChild(
            buildKeyDefectSideBlock(sample, 'left', tempDefectKey[sample].left || [])
        );
    }
    if (rightFail) {
        sidesWrapper.appendChild(
            buildKeyDefectSideBlock(sample, 'right', tempDefectKey[sample].right || [])
        );
    }
}

// Bangun blok defect untuk Auto List Sample
function buildKeyDefectSideBlock(sample, side, tags) {
    const block = document.createElement('div');
    block.className = 'defect-side-block';
    block.id = `key-defect-block-${sample}-${side}`;

    const label = document.createElement('span');
    label.className = 'defect-side-label label-fail';
    label.textContent = side === 'left' ? '← Kiri (Fail)' : 'Kanan (Fail) →';
    block.appendChild(label);

    // Tags yang sudah ada
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'defect-tags-container';
    tagsContainer.id = `key-tags-${sample}-${side}`;
    tags.forEach(tag => tagsContainer.appendChild(buildKeyDefectTag(sample, side, tag)));
    block.appendChild(tagsContainer);

    // Input box
    const inputWrap = document.createElement('div');
    inputWrap.className = 'defect-input-wrap';
    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'defect-input-box';
    input.id          = `key-defect-input-${sample}-${side}`;
    const isFirst     = tags.length === 0;
    input.placeholder = isFirst
        ? 'Wajib: tulis nama defect, tekan Enter...'
        : 'Opsional: tambah defect lain...';
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addKeyDefect(sample, side, this.value.trim());
            this.value = '';
        }
    });
    inputWrap.appendChild(input);
    block.appendChild(inputWrap);

    return block;
}

// Tambah defect ke answer key
function addKeyDefect(sample, side, value) {
    if (!value) return;
    if (!tempDefectKey[sample]) tempDefectKey[sample] = { left: [], right: [] };

    const arr = tempDefectKey[sample][side];
    if (arr.includes(value)) return; // hindari duplikat

    arr.push(value);

    const container = document.getElementById(`key-tags-${sample}-${side}`);
    if (container) container.appendChild(buildKeyDefectTag(sample, side, value));

    // Update placeholder input box jadi opsional
    const inp = document.getElementById(`key-defect-input-${sample}-${side}`);
    if (inp) inp.placeholder = 'Opsional: tambah defect lain...';
}

// Hapus defect dari answer key
function removeKeyDefect(sample, side, value) {
    if (!tempDefectKey[sample]) return;
    const arr = tempDefectKey[sample][side];
    const pos = arr.indexOf(value);
    if (pos > -1) arr.splice(pos, 1);

    const container = document.getElementById(`key-tags-${sample}-${side}`);
    if (container) {
        Array.from(container.querySelectorAll('.defect-tag')).forEach(el => {
            if (el.dataset.value === value) el.remove();
        });
        // Update placeholder jika tidak ada tag lagi
        if (arr.length === 0) {
            const inp = document.getElementById(`key-defect-input-${sample}-${side}`);
            if (inp) inp.placeholder = 'Wajib: tulis nama defect, tekan Enter...';
        }
    }
}

// Build tag defect di Auto List Sample
function buildKeyDefectTag(sample, side, value) {
    const tag = document.createElement('span');
    tag.className     = 'defect-tag';
    tag.dataset.value = value;

    const text = document.createElement('span');
    text.textContent = value;

    const del = document.createElement('button');
    del.className   = 'defect-tag-delete';
    del.textContent = '×';
    del.title       = 'Hapus';
    del.onclick     = () => removeKeyDefect(sample, side, value);

    tag.appendChild(text);
    tag.appendChild(del);
    return tag;
}

// ── Simpan Answer Key + Defect Key ─────────────────────────
async function saveAnswerKey() {
    if (!selectedArea) { alert('Pilih area terlebih dahulu!'); return; }

    const totalSamples = getNumSamplesSetting();

    for (let i = 1; i <= totalSamples; i++) {
        if (!tempAnswerKey[i] || tempAnswerKey[i] === '') {
            alert(`Sample ${i} belum dipilih!`); return;
        }
        // Validasi defect: jika ada sisi Fail, minimal 1 defect wajib diisi
        const [l, r] = tempAnswerKey[i].split('-');
        if (l === 'Fail') {
            const leftDefects = (tempDefectKey[i] || { left: [] }).left;
            if (!leftDefects || leftDefects.length === 0) {
                alert(`Sample ${i} — Sisi Kiri (Fail) belum memiliki list defect!`); return;
            }
        }
        if (r === 'Fail') {
            const rightDefects = (tempDefectKey[i] || { right: [] }).right;
            if (!rightDefects || rightDefects.length === 0) {
                alert(`Sample ${i} — Sisi Kanan (Fail) belum memiliki list defect!`); return;
            }
        }
    }

    // Google Sheets hanya disinkronisasi untuk sampel 1-5 guna menjaga integritas baris spreadsheet
    const answers = {};
    for (let i = 1; i <= Math.min(totalSamples, 5); i++) {
        answers[i] = tempAnswerKey[i];
    }

    const res = await saveAnswerKeyToSheet(selectedArea, answers);
    if (res.status === 'success') {
        // Simpan seluruh 1-10 ke local answerKeys dan defectKeys
        if (!answerKeys[selectedArea]) answerKeys[selectedArea] = {};
        for (let i = 1; i <= totalSamples; i++) {
            answerKeys[selectedArea][i] = tempAnswerKey[i];
        }

        defectKeys[selectedArea] = JSON.parse(JSON.stringify(tempDefectKey));
        saveToStorage();

        await fetchAnswerKeysFromSheet();
        renderAreaSelector();
        handleSubDeptChange();
        alert(`Answer key & list defect untuk ${selectedArea} berhasil disimpan!`);
    } else {
        alert('Gagal menyimpan: ' + res.message);
    }
}

async function deleteAnswerKey() {
    if (!selectedArea) { alert('Pilih area terlebih dahulu!'); return; }
    if (!answerKeys[selectedArea]) { alert('Tidak ada answer key untuk area ini!'); return; }
    if (!confirm(`Hapus answer key & list defect untuk ${selectedArea}?`)) return;

    const res = await deleteAnswerKeyFromSheet(selectedArea);
    if (res.status === 'success') {
        // Hapus defect key juga
        delete defectKeys[selectedArea];
        // Hapus local answer key
        delete answerKeys[selectedArea];
        saveToStorage();

        await fetchAnswerKeysFromSheet();
        tempAnswerKey = {};
        tempDefectKey = {};
        const totalSamples = getNumSamplesSetting();
        for (let i = 1; i <= totalSamples; i++) {
            tempAnswerKey[i] = '';
            tempDefectKey[i] = { left: [], right: [] };
        }
        renderAnswerKeyForm();
        renderAreaSelector();
        handleSubDeptChange();
        alert(`Answer key & list defect ${selectedArea} berhasil dihapus!`);
    } else {
        alert('Gagal menghapus: ' + res.message);
    }
}

// ============================================================
// DATE RANGE & SETTINGS
// ============================================================
function isWithinDateRange(dateString) {
    if (!dateRange.start || !dateRange.end) return true;
    const checkDate = new Date(dateString);
    const start     = new Date(dateRange.start);
    const end       = new Date(dateRange.end);
    end.setHours(23, 59, 59, 999);
    return checkDate >= start && checkDate <= end;
}

async function saveDateSettings() {
    const start = document.getElementById('dateStart').value;
    const end   = document.getElementById('dateEnd').value;

    if (!start || !end) { alert('Mohon isi tanggal mulai dan selesai!'); return; }
    if (new Date(start) > new Date(end)) {
        alert('Tanggal mulai tidak boleh lebih besar dari tanggal selesai!'); return;
    }

    const res = await saveDateRangeToSheet(start, end);
    if (res.status === 'success') {
        dateRange = { start, end };
        checkPeriodeBanner();
        alert(`Pengaturan periode berhasil disimpan!\n${start} s/d ${end}`);
    } else {
        alert('Gagal menyimpan: ' + res.message);
    }
}

// ============================================================
// DATA NILAI — Employee List
// ============================================================
function renderEmployeeList() {
    const employeeList = document.getElementById('employeeList');
    const filterValue  = document.getElementById('filterSubDept').value;
    employeeList.innerHTML = '';

    // Filter berdasarkan tanggal inspection, bukan timestamp input
    let filtered = submittedData.filter(s => isWithinDateRange(s.inspectionDate || s.timestamp));
    if (filterValue) filtered = filtered.filter(s => s.subDept === filterValue);

    if (filtered.length === 0) {
        employeeList.innerHTML = '<p class="empty-state">Tidak ada data peserta dalam periode ini</p>';
        return;
    }

    filtered.forEach(submission => {
        const check     = checkAnswer(submission);
        const duplicate = isDuplicate(submission.nik);
        const noKey     = !answerKeys[submission.subDept];

        const btn = document.createElement('button');
        btn.className = 'employee-item';
        if (duplicate)        btn.classList.add('duplicate');
        else if (noKey)       btn.classList.add('no-key');
        else if (check.correct) btn.classList.add('correct');
        else                  btn.classList.add('incorrect');

        btn.onclick     = () => showEmployeeDetail(submission);
        btn.textContent = `${submission.name} — ${submission.nik}`;
        employeeList.appendChild(btn);
    });
}

function filterEmployeeList() { renderEmployeeList(); }

function isDuplicate(nik) {
    return submittedData.filter(s => s.nik === nik).length > 1;
}

function checkAnswer(submission) {
    if (!answerKeys[submission.subDept]) return { correct: true, errors: [] };
    const key = answerKeys[submission.subDept];
    let correct  = true;
    const errors = [];

    submission.data.forEach(item => {
        const sampleKey = key[item.sample];
        if (!sampleKey) return;
        const [keyLeft, keyRight] = sampleKey.split('-').map(s => s.trim());
        if (item.left  !== keyLeft)  { correct = false; errors.push({ checking: item.checking, sample: item.sample, side: 'left'  }); }
        if (item.right !== keyRight) { correct = false; errors.push({ checking: item.checking, sample: item.sample, side: 'right' }); }
    });

    return { correct, errors };
}

function showEmployeeDetail(submission) {
    selectedEmployee = submission;
    document.getElementById('employeeList').classList.add('hidden');
    document.getElementById('filterContainer').classList.add('hidden');
    document.getElementById('employeeDetail').classList.remove('hidden');

    // Tanggal tampilan: gunakan inspectionDate, fallback ke timestamp
    const displayDate = submission.inspectionDate
        ? formatDateFromISO(submission.inspectionDate)
        : formatDate(submission.timestamp);

    const info = document.getElementById('employeeInfo');
    info.innerHTML = `
        <p><strong>Tanggal:</strong> ${displayDate}</p>
        <p><strong>Penilai:</strong> ${submission.assessor}</p>
        <p><strong>Nama:</strong> ${submission.name}</p>
        <p><strong>NIK:</strong> ${submission.nik}</p>
        <p><strong>Bagian:</strong> ${submission.subDept} — ${submission.line}</p>`;

    renderGradeTable();
}

function backToList() {
    selectedEmployee = null;
    document.getElementById('employeeList').classList.remove('hidden');
    document.getElementById('filterContainer').classList.remove('hidden');
    document.getElementById('employeeDetail').classList.add('hidden');
}

// ============================================================
// GRADE TABLE — 10 Kolom
// Kolom: [Sepatu][Pem1 P/F][Ket1][CT1][Pem2 P/F][Ket2][CT2][Pem3 P/F][Ket3][CT3]
// CT di-merge tiap 2 baris (1 pasang = 1 cycle time)
// ============================================================
function renderGradeTable() {
    const table = document.getElementById('gradeTable');
    const check = checkAnswer(selectedEmployee);

    // Hitung jumlah pasang secara dinamis berdasarkan data
    const totalPairs = selectedEmployee.data ? (selectedEmployee.data.length / 3) : 5;
    const totalShoes = totalPairs * 2;

    // Header baris 1: grup
    let html = `<thead>
        <tr>
            <th rowspan="2">Sepatu</th>
            <th colspan="3" class="th-group">Pemeriksaan 1</th>
            <th colspan="3" class="th-group">Pemeriksaan 2</th>
            <th colspan="3" class="th-group">Pemeriksaan 3</th>
        </tr>
        <tr class="sub-header">`;
    for (let c = 1; c <= 3; c++) {
        html += `<th>P/F</th><th>Ket</th><th>CT (dtk)</th>`;
    }
    html += `</tr></thead><tbody>`;

    // Data rows: CT di-merge tiap 2 baris
    for (let num = 1; num <= totalShoes; num++) {
        const sampleNum = Math.ceil(num / 2);
        const isLeft    = num % 2 === 1;  // ganjil = kiri
        const isFirstOfPair = isLeft;     // baris ganjil = mulai pasangan

        html += '<tr>';
        html += `<td><strong>${num}</strong></td>`;

        for (let checkNum = 1; checkNum <= 3; checkNum++) {
            const item  = selectedEmployee.data.find(d => d.checking === checkNum && d.sample === sampleNum);
            const value = item ? (isLeft ? item.left : item.right) : '';
            const display = value === 'Pass' ? 'P' : value === 'Fail' ? 'F' : '-';

            const isWrong = check.errors.some(e =>
                e.checking === checkNum && e.sample === sampleNum && e.side === (isLeft ? 'left' : 'right')
            );

            // P/F cell
            html += `<td class="cell-pf ${isWrong ? 'wrong-answer' : ''}">${display}</td>`;

            // Keterangan defect
            const defectList = getDefectsForDisplay(item, isLeft ? 'left' : 'right');
            if (defectList.length > 0) {
                html += `<td class="cell-ket">
                    <div class="defect-tag-list">
                        ${defectList.map(d => `<span class="defect-chip">${d}</span>`).join('')}
                    </div>
                </td>`;
            } else {
                html += `<td class="cell-ket cell-ket-empty">—</td>`;
            }

            // Cycle Time: hanya tampil 1x per pasang (merge 2 baris)
            if (isFirstOfPair) {
                const ct = item ? (item.cycleTime || 0) : 0;
                html += `<td class="cell-ct" rowspan="2">${ct}s</td>`;
            }
            // Baris kedua dari pasangan tidak perlu tambah CT (sudah di-rowspan)
        }

        html += '</tr>';
    }

    html += '</tbody>';
    table.innerHTML = html;
}

// Ambil defect untuk tampilan di tabel (preset + custom)
function getDefectsForDisplay(item, side) {
    if (!item) return [];
    const preset = side === 'left' ? (item.defectLeft  || []) : (item.defectRight  || []);
    const custom = side === 'left' ? (item.defectLeftCustom || []) : (item.defectRightCustom || []);
    return [...preset, ...custom];
}

// ============================================================
// DELETE DATA
// ============================================================
function deleteEmployeeData() {
    if (!selectedEmployee) return;
    const idx = submittedData.findIndex(s =>
        s.nik === selectedEmployee.nik && s.timestamp === selectedEmployee.timestamp
    );
    if (idx > -1) {
        submittedData.splice(idx, 1);
        saveToStorage();
        alert(`Data ${selectedEmployee.name} berhasil dihapus!`);
        backToList();
        renderEmployeeList();
    }
}

// ============================================================
// DOWNLOAD EXCEL — SheetJS (.xlsx)
// ============================================================
// Layout (meniru tampilan Data Nilai):
//   Baris 1  : "GAGE R&R"  (bold, font besar, merge A1:J1)
//   Baris 2  : "GAGE RNR Assessment - Form manual" (merge A2:J2)
//   Baris 3  : kosong
//   Baris 4  : label "Tanggal"   | nilai
//   Baris 5  : label "Penilai"   | nilai
//   Baris 6  : label "Nama"      | nilai
//   Baris 7  : label "NIK"       | nilai
//   Baris 8  : label "Bagian"    | nilai
//   Baris 9  : kosong
//   Baris 10 : header grup  — [Sepatu] [Pem1 P/F Ket CT] [Pem2 P/F Ket CT] [Pem3 P/F Ket CT]
//   Baris 11 : sub-header   — [       ] [P/F Ket CT] ×3
//   Baris 12–21: data 10 sepatu (CT merge 2 baris per pasang)
// Total kolom: 10 (A–J)
// ============================================================

function downloadExcel() {
    if (!selectedEmployee) return;

    // Muat SheetJS dari CDN jika belum ada
    if (typeof XLSX === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        script.onload  = () => _buildAndDownloadExcel();
        script.onerror = () => alert('Gagal memuat library Excel. Periksa koneksi internet.');
        document.head.appendChild(script);
    } else {
        _buildAndDownloadExcel();
    }
}

function _buildAndDownloadExcel() {
    const s   = selectedEmployee;
    const chk = checkAnswer(s);

    // ── Tanggal tampilan ──────────────────────────────────
    const displayDate = s.inspectionDate
        ? formatDateFromISO(s.inspectionDate)
        : formatDate(s.timestamp);

    // ── Workbook & Worksheet ──────────────────────────────
    const wb = XLSX.utils.book_new();
    const ws = {};

    // Helper tulis cell
    const C = (r, c, v, t) => {
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = { v, t: t || 's' };
    };

    // ── Baris 0 (R0): Header utama "GAGE R&R" ────────────
    C(0, 0, 'GAGE R&R');

    // ── Baris 1 (R1): Sub-header ─────────────────────────
    C(1, 0, 'GAGE RNR Assessment - Form manual');

    // ── Baris 2 (R2): kosong ─────────────────────────────

    // ── Baris 3–7 (R3–R7): Info peserta ──────────────────
    const infoRows = [
        ['Tanggal',  displayDate],
        ['Penilai',  s.assessor],
        ['Nama',     s.name],
        ['NIK',      s.nik],
        ['Bagian',   `${s.subDept} — ${s.line}`]
    ];
    infoRows.forEach((row, i) => {
        C(3 + i, 0, row[0]);
        C(3 + i, 1, row[1]);
    });

    // ── Baris 8 (R8): kosong ─────────────────────────────

    // ── Baris 9 (R9): Header grup tabel ──────────────────
    // Kolom: A=Sepatu, B=P/F1, C=Ket1, D=CT1, E=P/F2, F=Ket2, G=CT2, H=P/F3, I=Ket3, J=CT3
    C(9, 0, 'Sepatu');
    C(9, 1, 'Pemeriksaan 1');
    C(9, 4, 'Pemeriksaan 2');
    C(9, 7, 'Pemeriksaan 3');

    // ── Baris 10 (R10): Sub-header tabel ─────────────────
    C(10, 0, 'Sepatu');
    [1, 4, 7].forEach(col => {
        C(10, col,     'P/F');
        C(10, col + 1, 'Ket');
        C(10, col + 2, 'CT (dtk)');
    });

    // ── Baris 11–20+: Data sepatu ────────────
    const totalPairs = s.data ? (s.data.length / 3) : 5;
    const totalShoes = totalPairs * 2;

    for (let num = 1; num <= totalShoes; num++) {
        const row       = 10 + num;
        const sampleNum = Math.ceil(num / 2);
        const isLeft    = num % 2 === 1;
        const side      = isLeft ? 'left' : 'right';

        C(row, 0, num, 'n');

        for (let checkNum = 1; checkNum <= 3; checkNum++) {
            const item    = s.data.find(d => d.checking === checkNum && d.sample === sampleNum);
            const value   = item ? (isLeft ? item.left : item.right) : '';
            const display = value === 'Pass' ? 'P' : value === 'Fail' ? 'F' : '-';
            const defects = getDefectsForDisplay(item, side);
            const ct      = item ? (item.cycleTime || 0) : 0;

            const baseCol = (checkNum - 1) * 3 + 1; // 1, 4, 7
            C(row, baseCol,     display);
            C(row, baseCol + 1, defects.length > 0 ? defects.join(', ') : '—');

            // CT: hanya tulis di baris ganjil (isLeft), baris genap dibiarkan kosong
            // Merge akan menyatukan keduanya
            if (isLeft) {
                C(row, baseCol + 2, ct, 'n');
            }
        }
    }

    // ── Worksheet range ───────────────────────────────────
    ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: 10 + totalShoes, c: 9 });

    // ── Merge cells ───────────────────────────────────────
    ws['!merges'] = [
        // Header utama: A1 merge A–J
        { s: { r:0, c:0 }, e: { r:0, c:9 } },
        // Sub-header: A2 merge A–J
        { s: { r:1, c:0 }, e: { r:1, c:9 } },
        // Info peserta: kolom B–J di-merge (label kolom A, nilai B–J)
        { s: { r:3, c:1 }, e: { r:3, c:9 } },
        { s: { r:4, c:1 }, e: { r:4, c:9 } },
        { s: { r:5, c:1 }, e: { r:5, c:9 } },
        { s: { r:6, c:1 }, e: { r:6, c:9 } },
        { s: { r:7, c:1 }, e: { r:7, c:9 } },
        // Header grup pemeriksaan (R9)
        { s: { r:9, c:0 }, e: { r:10, c:0 } },  // "Sepatu" rowspan 2
        { s: { r:9, c:1 }, e: { r:9, c:3  } },  // Pemeriksaan 1
        { s: { r:9, c:4 }, e: { r:9, c:6  } },  // Pemeriksaan 2
        { s: { r:9, c:7 }, e: { r:9, c:9  } },  // Pemeriksaan 3
        // CT merge per pasang sepatu
        ...buildCtMerges(totalPairs)
    ];

    // ── Column widths ─────────────────────────────────────
    ws['!cols'] = [
        { wch: 8  },  // A Sepatu
        { wch: 6  },  // B P/F 1
        { wch: 22 },  // C Ket 1
        { wch: 10 },  // D CT 1
        { wch: 6  },  // E P/F 2
        { wch: 22 },  // F Ket 2
        { wch: 10 },  // G CT 2
        { wch: 6  },  // H P/F 3
        { wch: 22 },  // I Ket 3
        { wch: 10 },  // J CT 3
    ];

    // ── Styles via cell metadata (SheetJS community = terbatas) ──
    // Bold header utama
    const r0a = XLSX.utils.encode_cell({ r:0, c:0 });
    if (ws[r0a]) ws[r0a].s = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center' } };

    // Bold sub-header
    const r1a = XLSX.utils.encode_cell({ r:1, c:0 });
    if (ws[r1a]) ws[r1a].s = { alignment: { horizontal: 'center' } };

    // Bold label info peserta (kolom A, R3–R7)
    for (let i = 3; i <= 7; i++) {
        const addr = XLSX.utils.encode_cell({ r:i, c:0 });
        if (ws[addr]) ws[addr].s = { font: { bold: true } };
    }

    // Bold header tabel (R9–R10)
    for (let r = 9; r <= 10; r++) {
        for (let c = 0; c <= 9; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            if (ws[addr]) ws[addr].s = {
                font: { bold: true },
                fill: { fgColor: { rgb: 'EEF2FF' } },
                alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                border: _border()
            };
        }
    }

    // Border & alignment untuk data tabel
    const check = checkAnswer(s);
    for (let num = 1; num <= totalShoes; num++) {
        const row       = 10 + num;
        const sampleNum = Math.ceil(num / 2);
        const isLeft    = num % 2 === 1;

        for (let c = 0; c <= 9; c++) {
            const addr = XLSX.utils.encode_cell({ r: row, c });
            if (!ws[addr]) ws[addr] = { v: '', t: 's' };

            const checkNum = c <= 3 ? 1 : c <= 6 ? 2 : 3;
            const baseCol  = (checkNum - 1) * 3 + 1;
            const isPfCol  = c === baseCol;
            const side     = isLeft ? 'left' : 'right';

            const isWrong = isPfCol && check.errors.some(e =>
                e.checking === checkNum && e.sample === sampleNum && e.side === side
            );

            ws[addr].s = {
                font:      { bold: c === 0, color: isWrong ? { rgb: '92400E' } : {} },
                fill:      isWrong ? { fgColor: { rgb: 'FEF3C7' } } : {},
                alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                border:    _border()
            };
        }
    }

    // ── Append & download ─────────────────────────────────
    XLSX.utils.book_append_sheet(wb, ws, 'Gage RnR');

    const safeName = s.name.replace(/[^a-zA-Z0-9_\- ]/g, '');
    const fileName = `GageRnR_${safeName}_${s.nik}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

// Helper: bangun merge CT (setiap pasang sepatu ganjil-genap, 3 pemeriksaan)
function buildCtMerges(totalPairs) {
    const merges = [];
    for (let pair = 0; pair < totalPairs; pair++) {
        const rowOdd  = 11 + pair * 2;     // baris ganjil (kiri)
        const rowEven = rowOdd + 1;         // baris genap (kanan)
        [3, 6, 9].forEach(col => {          // kolom CT per pemeriksaan
            merges.push({ s: { r: rowOdd - 1, c: col }, e: { r: rowEven - 1, c: col } });
        });
    }
    return merges;
}

// Helper: border tipis semua sisi
function _border() {
    const thin = { style: 'thin', color: { rgb: 'E5E7EB' } };
    return { top: thin, bottom: thin, left: thin, right: thin };
}

// ============================================================
// UTILS — Tanggal
// ============================================================

// Hari ini format YYYY-MM-DD
function getTodayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

// Format Date object → DD/MM/YYYY HH:mm:ss
function formatDateTimeFull(d) {
    const dd  = String(d.getDate()).padStart(2, '0');
    const mm  = String(d.getMonth() + 1).padStart(2, '0');
    const yy  = d.getFullYear();
    const hh  = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss  = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${min}:${ss}`;
}

// Format Date object → DD/MM/YYYY
function formatDateOnlyDisplay(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
}

// Format ISO string (YYYY-MM-DD) → "22 Mei 2026"
function formatDateFromISO(isoDate) {
    const months = ['Januari','Februari','Maret','April','Mei','Juni',
                    'Juli','Agustus','September','Oktober','November','Desember'];
    const d = new Date(isoDate + 'T00:00:00');
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Format ISO timestamp → "22 Mei 2026" (lama, masih dipakai fallback)
function formatDate(dateString) {
    const months = ['Januari','Februari','Maret','April','Mei','Juni',
                    'Juli','Agustus','September','Oktober','November','Desember'];
    const d = new Date(dateString);
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
