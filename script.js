// ============================================================
// GAGE R&R SYSTEM — script.js
// ============================================================

// ── Google Sheets Apps Script URL ──────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwTt1J3BGovZ438jq7saRMMAV_ZzyMH0I4POnbFn822SI7IroZ3SP-m7zKVLFPO3-7AOQ/exec';

// ── Kredensial Verifikasi ───────────────────────────────────
const VERIFY_CREDENTIALS = {
    input:    { username: '1',      password: '1'          },  // gate halaman Input Data
    protected:{ username: 'Q', password: 'Q' }  // Auto List, Settings, Hapus
};

// ── State Global ────────────────────────────────────────────
let checkingData      = [];
let timerIntervals    = {};
let answerKeys        = {};        // { Cutting: { 1:'Pass-Pass', ... }, ... }
let dateRange         = { start: '', end: '' };
let submittedData     = [];
let selectedEmployee  = null;
let currentChecking   = 1;
let selectedArea      = null;
let tempAnswerKey     = {};
let currentMode       = 'realtime'; // 'realtime' | 'postprocess'
let assessorList      = [];         // dari Google Sheets kolom A

// Akses gate (session — reset kalau refresh)
let inputVerified     = false;
let autoListVerified  = false;
let settingsVerified  = false;

// Callback setelah verifikasi berhasil
let verifyCallback    = null;

const SUB_DEPT_OPTIONS = ['Cutting','DNS','Preparation','CSC','Sewing','Lasting','Assy','MA'];

// ── Mapping area → baris Google Sheet ──────────────────────
const AREA_ROW_MAP = {
    Cutting:     { start:2,  end:6  },
    DNS:         { start:7,  end:11 },
    Preparation: { start:12, end:16 },
    CSC:         { start:17, end:21 },
    Sewing:      { start:22, end:26 },
    Lasting:     { start:27, end:31 },
    Assy:        { start:32, end:36 },
    MA:          { start:37, end:41 }
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    loadFromStorage();
    fetchAnswerKeysFromSheet();
    fetchDateRangeFromSheet();
    fetchAssessorsFromSheet();
    initializeCheckingData();
    navigateTo('input');

    // Tutup autocomplete kalau klik di luar
    document.addEventListener('click', function (e) {
        if (!e.target.closest('#assessorInput') && !e.target.closest('#assessorDropdown')) {
            document.getElementById('assessorDropdown').classList.add('hidden');
        }
    });
});

// ============================================================
// LOCAL STORAGE
// ============================================================
function saveToStorage() {
    localStorage.setItem('gageRnR_submittedData', JSON.stringify(submittedData));
}

function loadFromStorage() {
    const saved = localStorage.getItem('gageRnR_submittedData');
    if (saved) submittedData = JSON.parse(saved);
}

// ============================================================
// GOOGLE SHEETS — FETCH & POST
// ============================================================

// Helper GET
async function sheetGet(action) {
    try {
        const res = await fetch(`${APPS_SCRIPT_URL}?action=${action}`);
        return await res.json();
    } catch (e) {
        console.error('GET error:', e);
        return { status: 'error', message: e.toString() };
    }
}

// Helper POST
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

// Ambil daftar penilai dari kolom A
async function fetchAssessorsFromSheet() {
    const res = await sheetGet('getAssessors');
    if (res.status === 'success') {
        assessorList = res.data || [];
    }
}

// Simpan penilai baru ke kolom A (hanya jika belum ada)
async function saveAssessorToSheet(name) {
    await sheetPost({ action: 'saveAssessor', name });
    await fetchAssessorsFromSheet(); // refresh list
}

// Ambil answer keys dari kolom D
async function fetchAnswerKeysFromSheet() {
    const res = await sheetGet('getAnswerKeys');
    if (res.status === 'success') {
        answerKeys = res.data || {};
        updateAutoFillButton();
        renderAreaSelector();
    }
}

// Simpan answer key area tertentu ke kolom D
async function saveAnswerKeyToSheet(area, answers) {
    return await sheetPost({ action: 'saveAnswerKey', area, answers });
}

// Hapus answer key area tertentu (kosongkan baris D yang sesuai)
async function deleteAnswerKeyFromSheet(area) {
    return await sheetPost({ action: 'deleteAnswerKey', area });
}

// Ambil date range dari E2/F2
async function fetchDateRangeFromSheet() {
    const res = await sheetGet('getDateRange');
    if (res.status === 'success' && res.data) {
        dateRange = res.data;
        const elStart = document.getElementById('dateStart');
        const elEnd   = document.getElementById('dateEnd');
        if (elStart) elStart.value = dateRange.start || '';
        if (elEnd)   elEnd.value   = dateRange.end   || '';
    }
}

// Simpan date range ke E2/F2
async function saveDateRangeToSheet(start, end) {
    return await sheetPost({ action: 'saveDateRange', start, end });
}

// ============================================================
// VERIFIKASI MODAL (Reusable)
// ============================================================

// Tampilkan modal verifikasi
// title     : judul modal
// subtitle  : deskripsi singkat
// type      : 'input' | 'protected'
// callback  : fungsi yang dijalankan setelah verifikasi berhasil
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
        // Simpan callback dulu sebelum closeVerifyModal set verifyCallback = null
        const successCallback = verifyCallback.callback;
        closeVerifyModal();
        successCallback();
    } else {
        document.getElementById('verifyError').classList.remove('hidden');
        document.getElementById('verifyPassword').value = '';
        document.getElementById('verifyPassword').focus();
    }
}

// Enter key di modal verifikasi
document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !document.getElementById('verifyModal').classList.contains('hidden')) {
        submitVerify();
    }
});

// ── Hapus Data ─────────────────────────────────────────────
function requestDeleteData() {
    openVerifyModal(
        'Verifikasi Hapus Data',
        'Masukkan kredensial admin untuk menghapus data ini.',
        'protected',
        function () {
            deleteEmployeeData();
        }
    );
}

// ============================================================
// NAVIGASI
// ============================================================
function navigateTo(view) {
    // Sembunyikan semua view & reset menu active
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
                    document.getElementById('inputContent').classList.remove('hidden');
                }
            );
        } else {
            document.getElementById('inputView').classList.remove('hidden');
            document.getElementById('inputContent').classList.remove('hidden');
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
                    document.getElementById('autoListContent').classList.remove('hidden');
                    renderAreaSelector();
                }
            );
        } else {
            document.getElementById('autoListView').classList.remove('hidden');
            document.getElementById('autoListContent').classList.remove('hidden');
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
                    document.getElementById('settingsContent').classList.remove('hidden');
                    fetchDateRangeFromSheet();
                }
            );
        } else {
            document.getElementById('settingsView').classList.remove('hidden');
            document.getElementById('settingsContent').classList.remove('hidden');
            fetchDateRangeFromSheet();
        }
    }
}

// ============================================================
// SIDEBAR
// ============================================================
function toggleSidebar(force) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
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

    if (!input) {
        dropdown.classList.add('hidden');
        return;
    }

    const matches = assessorList.filter(name => name.toLowerCase().includes(input));

    if (matches.length === 0) {
        dropdown.classList.add('hidden');
        return;
    }

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
    if (nik && !name) {
        alert('NIK tidak ditemukan dalam database!');
    }
}

// ============================================================
// SUB-DEPARTMENT — notifikasi answer key
// ============================================================
function handleSubDeptChange() {
    const area  = document.getElementById('subDeptInput').value;
    const notif = document.getElementById('subDeptKeyNotif');
    const sel   = document.getElementById('subDeptInput');

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

// Toggle panel mode (gear)
function toggleModePanel() {
    document.getElementById('modePanel').classList.toggle('hidden');
}

// Set mode: 'realtime' atau 'postprocess'
function setMode(mode) {
    currentMode = mode;

    document.getElementById('modeRealtime').classList.toggle('active', mode === 'realtime');
    document.getElementById('modePostProcess').classList.toggle('active', mode === 'postprocess');

    const desc = document.getElementById('modeDescription');
    if (mode === 'realtime') {
        desc.textContent = '⚡ Digunakan untuk kondisi ketika data diinput langsung selama proses audit berlangsung.';
        document.getElementById('randomTimerPanel').classList.add('hidden');
        // Kembalikan timer ke mode manual (play/stop)
        renderCheckingData();
    } else {
        desc.textContent = '📋 Digunakan untuk kondisi ketika data baru diinput setelah proses audit selesai.';
        document.getElementById('randomTimerPanel').classList.remove('hidden');
        // Re-render tanpa timer play/stop
        renderCheckingData();
    }
}

// Apply auto fill berdasarkan area yang dipilih di dropdown
function applyAutoFill() {
    const area = document.getElementById('subDeptInput').value;
    if (!area || !answerKeys[area]) {
        alert('Pilih Sub-Department yang memiliki answer key terlebih dahulu!');
        return;
    }

    const key = answerKeys[area];

    if (currentMode === 'realtime') {
        // Hanya isi pemeriksaan yang sedang aktif
        checkingData.forEach(item => {
            if (item.checking === currentChecking) {
                const sampleKey = key[item.sample];
                if (sampleKey) applyAnswerToItem(item, sampleKey);
            }
        });
    } else {
        // Post-Process: isi semua pemeriksaan
        checkingData.forEach(item => {
            const sampleKey = key[item.sample];
            if (sampleKey) applyAnswerToItem(item, sampleKey);
        });

        // Random timer untuk semua
        const min = parseInt(document.getElementById('randomTimerMin').value) || 30;
        const max = parseInt(document.getElementById('randomTimerMax').value) || 60;
        checkingData.forEach((item, idx) => {
            const randomSec = Math.floor(Math.random() * (max - min + 1)) + min;
            checkingData[idx].cycleTime = randomSec;
        });
    }

    renderCheckingData();
}

// Helper: apply jawaban dari key string 'Pass-Pass' ke item
function applyAnswerToItem(item, keyString) {
    const parts = keyString.split('-');
    item.left  = parts[0] ? parts[0].trim() : '';
    item.right = parts[1] ? parts[1].trim() : '';
}

// ============================================================
// CHECKING DATA
// ============================================================
function initializeCheckingData() {
    // Stop semua timer dulu
    Object.values(timerIntervals).forEach(clearInterval);
    timerIntervals = {};

    checkingData = [];
    for (let check = 1; check <= 3; check++) {
        for (let sample = 1; sample <= 5; sample++) {
            checkingData.push({
                checking:    check,
                sample:      sample,
                left:        '',
                right:       '',
                cycleTime:   0,
                timerStatus: 'stopped'
            });
        }
    }
    currentChecking = 1;
    renderCheckingData();
    updateNavigationButtons();
}

// Render semua checking page
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

// Build satu checking item DOM
function buildCheckingItem(item, idx) {
    const div = document.createElement('div');
    div.className = 'checking-item';
    div.id = `checkItem-${idx}`;

    // Timer section
    let timerHTML = '';
    if (currentMode === 'realtime') {
        const statusClass = item.timerStatus;
        const icon = item.timerStatus === 'running' ? '⏸️' : '▶️';
        timerHTML = `
            <div class="timer-controls-inline">
                <button id="timer-btn-${idx}" class="timer-btn-small ${statusClass}" onclick="toggleTimer(${idx})">${icon}</button>
                <input type="number" id="time-${idx}" class="timer-input-small"
                    value="${item.cycleTime}"
                    oninput="manualSetTime(${idx}, this.value)"
                    min="0">
                <span class="timer-label-small">dtk</span>
            </div>`;
    } else {
        // Post-Process: hanya input angka, tanpa play/stop
        timerHTML = `
            <div class="timer-controls-inline">
                <input type="number" id="time-${idx}" class="timer-input-small"
                    value="${item.cycleTime}"
                    oninput="manualSetTime(${idx}, this.value)"
                    min="0">
                <span class="timer-label-small">dtk</span>
            </div>`;
    }

    // Kombinasi pass/fail yang dipilih
    const selected = item.left && item.right ? `${item.left}-${item.right}` : '';

    div.innerHTML = `
        <div class="checking-item-header">
            <div class="checking-title">Sample ${item.sample}</div>
            ${timerHTML}
        </div>
        <div class="pf-combo-group" id="combo-${idx}">
            ${buildComboButtons(idx, selected)}
        </div>`;

    return div;
}

// Build 4 tombol kombinasi Pass/Fail
function buildComboButtons(idx, selected) {
    const combos = ['Pass-Pass', 'Fail-Fail', 'Pass-Fail', 'Fail-Pass'];
    return combos.map(combo => {
        const isSelected = selected === combo;
        const isHidden   = selected && !isSelected;
        const [left, right] = combo.split('-');
        const leftClass  = left  === 'Pass' ? 'combo-pass' : 'combo-fail';
        const rightClass = right === 'Pass' ? 'combo-pass' : 'combo-fail';

        return `
            <button class="combo-btn ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-combo' : ''}"
                onclick="selectCombo(${idx}, '${combo}')">
                <span class="combo-side ${leftClass}">${left}</span>
                <span class="combo-sep">—</span>
                <span class="combo-side ${rightClass}">${right}</span>
            </button>`;
    }).join('');
}

// Pilih kombinasi Pass/Fail
function selectCombo(idx, combo) {
    const current = checkingData[idx];
    const currentSelected = current.left && current.right
        ? `${current.left}-${current.right}` : '';

    if (currentSelected === combo) {
        // Klik ulang → deselect
        checkingData[idx].left  = '';
        checkingData[idx].right = '';
    } else {
        const [left, right] = combo.split('-');
        checkingData[idx].left  = left;
        checkingData[idx].right = right;
    }

    // Re-render hanya combo group
    const comboGroup = document.getElementById(`combo-${idx}`);
    if (comboGroup) {
        const newSelected = checkingData[idx].left && checkingData[idx].right
            ? `${checkingData[idx].left}-${checkingData[idx].right}` : '';
        comboGroup.innerHTML = buildComboButtons(idx, newSelected);
    }

    checkAutoScroll();
}

// Auto scroll ke checking berikutnya jika semua terisi
function checkAutoScroll() {
    const currentCheckData = checkingData.filter(item => item.checking === currentChecking);
    const allFilled = currentCheckData.every(item =>
        item.left && item.right && item.cycleTime > 0
    );
    if (allFilled && currentChecking < 3) {
        setTimeout(() => nextChecking(), 500);
    }
}

// ============================================================
// TIMER
// ============================================================
function toggleTimer(idx) {
    const item = checkingData[idx];
    const btn  = document.getElementById(`timer-btn-${idx}`);

    if (item.timerStatus === 'stopped' || item.timerStatus === 'paused') {
        // Start / Resume
        item.timerStatus = 'running';
        if (btn) { btn.className = 'timer-btn-small running'; btn.innerHTML = '⏸️'; }

        timerIntervals[idx] = setInterval(() => {
            checkingData[idx].cycleTime++;
            const inp = document.getElementById(`time-${idx}`);
            if (inp) inp.value = checkingData[idx].cycleTime;
        }, 1000);

    } else {
        // Pause
        item.timerStatus = 'paused';
        clearInterval(timerIntervals[idx]);
        if (btn) { btn.className = 'timer-btn-small paused'; btn.innerHTML = '▶️'; }
    }
}

// Input manual timer — langsung ganti nilai tanpa "0" menempel
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
    const assessor = document.getElementById('assessorInput').value.trim();
    const nik      = document.getElementById('nikInput').value.trim();
    const name     = document.getElementById('nameInput').value.trim();
    const subDept  = document.getElementById('subDeptInput').value;
    const line     = document.getElementById('lineInput').value;

    if (!assessor) { alert('Mohon isi nama Penilai!'); return; }
    if (!nik || !name) { alert('Mohon isi NIK terlebih dahulu!'); return; }
    if (!subDept)  { alert('Mohon pilih Sub-Department Area!'); return; }
    if (!line)     { alert('Mohon pilih Line!'); return; }

    const allFilled = checkingData.every(item => item.left && item.right && item.cycleTime > 0);
    if (!allFilled) {
        alert('Semua data checking wajib diisi!\nPastikan semua Pass/Fail dan Cycle Time telah diisi.');
        return;
    }

    const submission = {
        assessor,
        nik,
        name,
        subDept,
        line,
        data:      JSON.parse(JSON.stringify(checkingData)),
        timestamp: new Date().toISOString()
    };

    submittedData.push(submission);
    saveToStorage();

    // Simpan penilai ke Google Sheets jika belum ada
    await saveAssessorToSheet(assessor);

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
    document.getElementById('lineInput').value     = '';
    document.getElementById('subDeptKeyNotif').classList.add('hidden');
    document.getElementById('subDeptInput').classList.remove('has-answer-key');

    Object.values(timerIntervals).forEach(clearInterval);
    timerIntervals = {};

    initializeCheckingData();
    updateAutoFillButton();
}

// ============================================================
// ANSWER KEY — Auto List Sample
// ============================================================

// Render tombol area di halaman Auto List Sample
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

    if (answerKeys[area]) {
        tempAnswerKey = JSON.parse(JSON.stringify(answerKeys[area]));
    } else {
        tempAnswerKey = {};
        for (let i = 1; i <= 5; i++) tempAnswerKey[i] = '';
    }

    renderAnswerKeyForm();
}

function renderAnswerKeyForm() {
    const container = document.getElementById('sampleKeyContainer');
    if (!container) return;
    container.innerHTML = '';

    const combos = ['Pass-Pass', 'Fail-Fail', 'Pass-Fail', 'Fail-Pass'];

    for (let i = 1; i <= 5; i++) {
        const selected = tempAnswerKey[i] || '';

        const item = document.createElement('div');
        item.className = 'sample-key-item';
        item.innerHTML = `<div class="sample-key-header">Sample ${i}</div>
            <div class="key-combo-group" id="keyCombo-${i}">
                ${combos.map(combo => {
                    const isSelected = selected === combo;
                    const isHidden   = selected && !isSelected;
                    const [left, right] = combo.split('-');
                    const lc = left  === 'Pass' ? 'combo-pass' : 'combo-fail';
                    const rc = right === 'Pass' ? 'combo-pass' : 'combo-fail';
                    return `<button class="combo-btn ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-combo' : ''}"
                        onclick="setKeyCombo(${i}, '${combo}')">
                        <span class="combo-side ${lc}">${left}</span>
                        <span class="combo-sep">—</span>
                        <span class="combo-side ${rc}">${right}</span>
                    </button>`;
                }).join('')}
            </div>`;
        container.appendChild(item);
    }
}

function setKeyCombo(sample, combo) {
    const current = tempAnswerKey[sample] || '';
    if (current === combo) {
        tempAnswerKey[sample] = '';
    } else {
        tempAnswerKey[sample] = combo;
    }

    const group = document.getElementById(`keyCombo-${sample}`);
    if (!group) return;

    const combos = ['Pass-Pass', 'Fail-Fail', 'Pass-Fail', 'Fail-Pass'];
    const newSelected = tempAnswerKey[sample] || '';
    group.innerHTML = combos.map(c => {
        const isSelected = newSelected === c;
        const isHidden   = newSelected && !isSelected;
        const [left, right] = c.split('-');
        const lc = left  === 'Pass' ? 'combo-pass' : 'combo-fail';
        const rc = right === 'Pass' ? 'combo-pass' : 'combo-fail';
        return `<button class="combo-btn ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-combo' : ''}"
            onclick="setKeyCombo(${sample}, '${c}')">
            <span class="combo-side ${lc}">${left}</span>
            <span class="combo-sep">—</span>
            <span class="combo-side ${rc}">${right}</span>
        </button>`;
    }).join('');
}

async function saveAnswerKey() {
    if (!selectedArea) { alert('Pilih area terlebih dahulu!'); return; }

    for (let i = 1; i <= 5; i++) {
        if (!tempAnswerKey[i] || tempAnswerKey[i] === '') {
            alert(`Sample ${i} belum dipilih!`); return;
        }
    }

    // Konversi format untuk Apps Script: { 1: 'Pass-Pass', ... }
    const answers = {};
    for (let i = 1; i <= 5; i++) answers[i] = tempAnswerKey[i];

    const res = await saveAnswerKeyToSheet(selectedArea, answers);
    if (res.status === 'success') {
        await fetchAnswerKeysFromSheet();
        renderAreaSelector();
        handleSubDeptChange();
        alert(`Answer key untuk ${selectedArea} berhasil disimpan!`);
    } else {
        alert('Gagal menyimpan: ' + res.message);
    }
}

async function deleteAnswerKey() {
    if (!selectedArea) { alert('Pilih area terlebih dahulu!'); return; }
    if (!answerKeys[selectedArea]) { alert('Tidak ada answer key untuk area ini!'); return; }

    if (!confirm(`Hapus answer key untuk ${selectedArea}?`)) return;

    const res = await deleteAnswerKeyFromSheet(selectedArea);
    if (res.status === 'success') {
        await fetchAnswerKeysFromSheet();

        tempAnswerKey = {};
        for (let i = 1; i <= 5; i++) tempAnswerKey[i] = '';

        renderAnswerKeyForm();
        renderAreaSelector();
        handleSubDeptChange();
        alert(`Answer key ${selectedArea} berhasil dihapus!`);
    } else {
        alert('Gagal menghapus: ' + res.message);
    }
}

// ============================================================
// DATE RANGE
// ============================================================
function isWithinDateRange(dateString) {
    if (!dateRange.start || !dateRange.end) return true;
    const checkDate = new Date(dateString);
    const start     = new Date(dateRange.start);
    const end       = new Date(dateRange.end);
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

    let filtered = submittedData.filter(s => isWithinDateRange(s.timestamp));
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

        if (duplicate)    btn.classList.add('duplicate');
        else if (noKey)   btn.classList.add('no-key');
        else if (check.correct) btn.classList.add('correct');
        else              btn.classList.add('incorrect');

        btn.onclick    = () => showEmployeeDetail(submission);
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

    const key    = answerKeys[submission.subDept];
    let correct  = true;
    const errors = [];

    submission.data.forEach(item => {
        const sampleKey = key[item.sample];
        if (!sampleKey) return;
        const [keyLeft, keyRight] = sampleKey.split('-').map(s => s.trim());
        if (item.left !== keyLeft) {
            correct = false;
            errors.push({ checking: item.checking, sample: item.sample, side: 'left' });
        }
        if (item.right !== keyRight) {
            correct = false;
            errors.push({ checking: item.checking, sample: item.sample, side: 'right' });
        }
    });

    return { correct, errors };
}

function showEmployeeDetail(submission) {
    selectedEmployee = submission;
    document.getElementById('employeeList').classList.add('hidden');
    document.getElementById('filterContainer').classList.add('hidden');
    document.getElementById('employeeDetail').classList.remove('hidden');

    const info = document.getElementById('employeeInfo');
    info.innerHTML = `
        <p><strong>Tanggal:</strong> ${formatDate(submission.timestamp)}</p>
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

function renderGradeTable() {
    const table = document.getElementById('gradeTable');
    const check = checkAnswer(selectedEmployee);

    let html = `<thead><tr>
        <th>Sepatu</th>
        <th>Pemeriksaan 1</th>
        <th>Pemeriksaan 2</th>
        <th>Pemeriksaan 3</th>
    </tr></thead><tbody>`;

    for (let num = 1; num <= 10; num++) {
        const sampleNum = Math.ceil(num / 2);
        const isLeft    = num % 2 === 1;
        html += '<tr>';
        html += `<td><strong>${num}</strong></td>`;

        for (let checkNum = 1; checkNum <= 3; checkNum++) {
            const item    = selectedEmployee.data.find(d => d.checking === checkNum && d.sample === sampleNum);
            const value   = item ? (isLeft ? item.left : item.right) : '';
            const display = value === 'Pass' ? 'P' : value === 'Fail' ? 'F' : '-';
            const isWrong = check.errors.some(e =>
                e.checking === checkNum && e.sample === sampleNum && e.side === (isLeft ? 'left' : 'right')
            );
            html += `<td class="${isWrong ? 'wrong-answer' : ''}">${display}</td>`;
        }
        html += '</tr>';
    }

    html += '</tbody>';
    table.innerHTML = html;
}

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

function downloadExcel() {
    alert('Fitur download Excel akan segera tersedia.');
}

// ============================================================
// UTILS
// ============================================================
function formatDate(dateString) {
    const months = ['Januari','Februari','Maret','April','Mei','Juni',
                    'Juli','Agustus','September','Oktober','November','Desember'];
    const d = new Date(dateString);
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
