// Global Variables
let userRole = null;
let isAuthenticated = false;
let checkingData = [];
let timerIntervals = {};
let answerKeys = {};
let dateRange = {
    start: '2024-11-14',
    end: '2026-12-25'
};
let submittedData = [];
let selectedEmployee = null;
let currentChecking = 1;
let selectedArea = null;
let tempAnswerKey = {};
let selectedAutoFillArea = null;

const SUB_DEPT_OPTIONS = ['Cutting', 'DNS', 'Preparation', 'CSC', 'Sewing', 'Lasting', 'Assy', 'MA'];

// Initialize App
document.addEventListener('DOMContentLoaded', function() {
    initializeCheckingData();
    loadFromStorage();
});

// Storage Functions
function saveToStorage() {
    localStorage.setItem('gageRnR_answerKeys', JSON.stringify(answerKeys));
    localStorage.setItem('gageRnR_dateRange', JSON.stringify(dateRange));
    localStorage.setItem('gageRnR_submittedData', JSON.stringify(submittedData));
}

function loadFromStorage() {
    const savedKeys = localStorage.getItem('gageRnR_answerKeys');
    const savedDates = localStorage.getItem('gageRnR_dateRange');
    const savedData = localStorage.getItem('gageRnR_submittedData');
    
    if (savedKeys) answerKeys = JSON.parse(savedKeys);
    if (savedDates) dateRange = JSON.parse(savedDates);
    if (savedData) submittedData = JSON.parse(savedData);
}

// Initialize Checking Data
function initializeCheckingData() {
    checkingData = [];
    for (let check = 1; check <= 3; check++) {
        for (let sample = 1; sample <= 5; sample++) {
            checkingData.push({
                checking: check,
                sample: sample,
                left: '',
                right: '',
                cycleTime: 0,
                timerStatus: 'stopped'
            });
        }
    }
    renderCheckingData();
    updateNavigationButtons();
}

// Date Range Validation
function isWithinDateRange(dateString) {
    const checkDate = new Date(dateString);
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    return checkDate >= start && checkDate <= end;
}

// Login Handler
function handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!username || !password) {
        alert('Mohon isi username dan password!');
        return;
    }
    
    // Check admin
    if (validateAdminLogin(username, password)) {
        userRole = 'admin';
        isAuthenticated = true;
        showMainApp();
    }
    // Check user
    else if (validateUserLogin(username, password)) {
        userRole = 'user';
        isAuthenticated = true;
        showMainApp();
    }
    else {
        alert('Username atau password salah!');
    }
}

// Show Main App
function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    
    // Update header
    const headerTitle = document.getElementById('headerTitle');
    if (userRole === 'admin') {
        headerTitle.textContent = 'Admin - Gage R&R';
        // Show admin menus
        document.getElementById('menuAutoList').classList.remove('hidden');
        document.getElementById('menuSettings').classList.remove('hidden');
        document.getElementById('colorLegend').classList.remove('hidden');
        document.getElementById('dateStart').value = dateRange.start;
        document.getElementById('dateEnd').value = dateRange.end;
    } else {
        headerTitle.textContent = 'User - Gage R&R';
    }
}

// Logout Handler
function handleLogout() {
    if (confirm('Apakah Anda yakin ingin logout?')) {
        userRole = null;
        isAuthenticated = false;
        document.getElementById('mainApp').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        resetForm();
        navigateTo('input');
    }
}

// Sidebar Toggle
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

// Navigation
function navigateTo(view) {
    // Hide all views
    document.getElementById('inputView').classList.add('hidden');
    document.getElementById('autoListView').classList.add('hidden');
    document.getElementById('dataNilaiView').classList.add('hidden');
    document.getElementById('settingsView').classList.add('hidden');
    
    // Show selected view
    if (view === 'input') {
        document.getElementById('inputView').classList.remove('hidden');
    } else if (view === 'autolist') {
        document.getElementById('autoListView').classList.remove('hidden');
        renderAreaSelector();
    } else if (view === 'datanilai') {
        document.getElementById('dataNilaiView').classList.remove('hidden');
        document.getElementById('employeeList').classList.remove('hidden');
        document.getElementById('employeeDetail').classList.add('hidden');
        document.getElementById('filterContainer').classList.remove('hidden');
        renderEmployeeList();
    } else if (view === 'settings') {
        document.getElementById('settingsView').classList.remove('hidden');
    }
    
    toggleSidebar();
}

// NIK Change Handler
function handleNikChange() {
    const nik = document.getElementById('nikInput').value;
    const name = getEmployeeName(nik);
    document.getElementById('nameInput').value = name;
    
    if (nik && !name) {
        alert('NIK tidak ditemukan dalam database!');
    }
}

// Render Area Selector (Admin)
function renderAreaSelector() {
    const container = document.getElementById('areaSelector');
    container.innerHTML = '';
    
    SUB_DEPT_OPTIONS.forEach(area => {
        const btn = document.createElement('button');
        btn.className = 'area-btn';
        btn.textContent = area;
        
        if (answerKeys[area]) {
            btn.classList.add('has-key');
        }
        
        if (selectedArea === area) {
            btn.classList.add('active');
        }
        
        btn.onclick = () => selectArea(area);
        container.appendChild(btn);
    });
}

// Select Area (Admin)
function selectArea(area) {
    selectedArea = area;
    renderAreaSelector();
    
    // Show answer key form
    document.getElementById('answerKeyForm').classList.remove('hidden');
    
    // Load existing key or create new
    if (answerKeys[area]) {
        tempAnswerKey = JSON.parse(JSON.stringify(answerKeys[area]));
    } else {
        tempAnswerKey = {};
        for (let i = 1; i <= 5; i++) {
            tempAnswerKey[i] = { left: '', right: '' };
        }
    }
    
    renderAnswerKeyForm();
}

// Render Answer Key Form
function renderAnswerKeyForm() {
    const container = document.getElementById('sampleKeyContainer');
    container.innerHTML = '';
    
    for (let i = 1; i <= 5; i++) {
        const item = document.createElement('div');
        item.className = 'sample-key-item';
        
        const leftValue = tempAnswerKey[i]?.left || '';
        const rightValue = tempAnswerKey[i]?.right || '';
        
        item.innerHTML = `
            <div class="sample-key-header">Sample ${i}</div>
            <div class="sample-key-options">
                <div class="key-option-group">
                    <span class="key-option-label">Kiri</span>
                    <div class="key-toggle-group">
                        <button class="key-toggle pass ${leftValue === 'Pass' ? 'active' : ''}" onclick="setKeyValue(${i}, 'left', 'Pass')">Pass</button>
                        <button class="key-toggle fail ${leftValue === 'Fail' ? 'active' : ''}" onclick="setKeyValue(${i}, 'left', 'Fail')">Fail</button>
                    </div>
                </div>
                
                <div class="key-option-group">
                    <span class="key-option-label">Kanan</span>
                    <div class="key-toggle-group">
                        <button class="key-toggle pass ${rightValue === 'Pass' ? 'active' : ''}" onclick="setKeyValue(${i}, 'right', 'Pass')">Pass</button>
                        <button class="key-toggle fail ${rightValue === 'Fail' ? 'active' : ''}" onclick="setKeyValue(${i}, 'right', 'Fail')">Fail</button>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(item);
    }
}

// Set Key Value
function setKeyValue(sample, side, value) {
    if (!tempAnswerKey[sample]) {
        tempAnswerKey[sample] = { left: '', right: '' };
    }
    
    tempAnswerKey[sample][side] = value;
    renderAnswerKeyForm();
}

// Save Answer Key
function saveAnswerKey() {
    if (!selectedArea) {
        alert('Pilih area terlebih dahulu!');
        return;
    }
    
    // Validate all samples filled
    let allFilled = true;
    for (let i = 1; i <= 5; i++) {
        if (!tempAnswerKey[i] || !tempAnswerKey[i].left || !tempAnswerKey[i].right) {
            allFilled = false;
            break;
        }
    }
    
    if (!allFilled) {
        alert('Mohon isi semua sample (Pass/Fail) untuk kiri dan kanan!');
        return;
    }
    
    answerKeys[selectedArea] = JSON.parse(JSON.stringify(tempAnswerKey));
    saveToStorage();
    
    alert('Answer key untuk ' + selectedArea + ' berhasil disimpan!');
    renderAreaSelector();
}

// Delete Answer Key
function deleteAnswerKey() {
    if (!selectedArea) {
        alert('Pilih area terlebih dahulu!');
        return;
    }
    
    if (!answerKeys[selectedArea]) {
        alert('Tidak ada answer key untuk area ini!');
        return;
    }
    
    if (confirm('Apakah Anda yakin ingin menghapus answer key untuk ' + selectedArea + '?')) {
        delete answerKeys[selectedArea];
        saveToStorage();
        
        // Reset form
        tempAnswerKey = {};
        for (let i = 1; i <= 5; i++) {
            tempAnswerKey[i] = { left: '', right: '' };
        }
        
        renderAnswerKeyForm();
        renderAreaSelector();
        alert('Answer key berhasil dihapus!');
    }
}

// Show Auto Fill Modal (User)
function showAutoFillModal() {
    const modal = document.getElementById('autoFillModal');
    modal.classList.remove('hidden');
    
    const container = document.getElementById('autoFillAreaSelector');
    container.innerHTML = '';
    
    SUB_DEPT_OPTIONS.forEach(area => {
        if (!answerKeys[area]) return;
        
        const btn = document.createElement('button');
        btn.className = 'area-btn';
        btn.textContent = area;
        btn.classList.add('has-key');
        
        if (selectedAutoFillArea === area) {
            btn.classList.add('active');
        }
        
        btn.onclick = () => {
            selectedAutoFillArea = area;
            showAutoFillModal();
        };
        
        container.appendChild(btn);
    });
    
    if (container.children.length === 0) {
        container.innerHTML = '<p class="empty-state">Belum ada answer key yang tersedia.<br>Silahkan hubungi Admin.</p>';
    }
}

// Close Auto Fill Modal
function closeAutoFillModal() {
    document.getElementById('autoFillModal').classList.add('hidden');
    selectedAutoFillArea = null;
}

// Apply Auto Fill
function applyAutoFill() {
    if (!selectedAutoFillArea) {
        alert('Pilih area terlebih dahulu!');
        return;
    }
    
    const key = answerKeys[selectedAutoFillArea];
    
    checkingData.forEach((item) => {
        const sampleKey = key[item.sample];
        if (sampleKey) {
            item.left = sampleKey.left;
            item.right = sampleKey.right;
        }
    });
    
    renderCheckingData();
    closeAutoFillModal();
    alert('Data berhasil diisi otomatis sesuai answer key ' + selectedAutoFillArea + '!');
}

// Render Checking Data
function renderCheckingData() {
    for (let check = 1; check <= 3; check++) {
        const container = document.getElementById(`checkingContainer${check}`);
        container.innerHTML = '';
        
        const checkData = checkingData.filter(item => item.checking === check);
        
        checkData.forEach((item, idx) => {
            const globalIdx = checkingData.findIndex(d => 
                d.checking === item.checking && d.sample === item.sample
            );
            
            const itemDiv = document.createElement('div');
            itemDiv.className = 'checking-item';
            
            itemDiv.innerHTML = `
                <div class="checking-item-header">
                    <div class="checking-title">Sample ${item.sample}</div>
                    <div class="timer-controls-inline">
                        <button id="timer-btn-${globalIdx}" class="timer-btn-small ${item.timerStatus}" onclick="toggleTimer(${globalIdx})">
                            ${item.timerStatus === 'running' ? '⏸️' : '▶️'}
                        </button>
                        <input type="number" id="time-${globalIdx}" class="timer-input-small" 
                               value="${item.cycleTime}" 
                               onchange="updateCycleTime(${globalIdx}, this.value)"
                               min="0">
                        <span class="timer-label-small">dtk</span>
                    </div>
                </div>
                
                <div class="checking-dropdowns">
                    <div class="dropdown-group">
                        <label>Kiri</label>
                        <select id="left-${globalIdx}" class="input-field ${item.left === 'Pass' ? 'pass-selected' : item.left === 'Fail' ? 'fail-selected' : ''}" onchange="updateCheckingData(${globalIdx}, 'left', this.value)">
                            <option value="">Pilih</option>
                            <option value="Pass" ${item.left === 'Pass' ? 'selected' : ''}>Pass</option>
                            <option value="Fail" ${item.left === 'Fail' ? 'selected' : ''}>Fail</option>
                        </select>
                    </div>
                    
                    <div class="dropdown-group">
                        <label>Kanan</label>
                        <select id="right-${globalIdx}" class="input-field ${item.right === 'Pass' ? 'pass-selected' : item.right === 'Fail' ? 'fail-selected' : ''}" onchange="updateCheckingData(${globalIdx}, 'right', this.value)">
                            <option value="">Pilih</option>
                            <option value="Pass" ${item.right === 'Pass' ? 'selected' : ''}>Pass</option>
                            <option value="Fail" ${item.right === 'Fail' ? 'selected' : ''}>Fail</option>
                        </select>
                    </div>
                </div>
            `;
            
            container.appendChild(itemDiv);
        });
    }
    
    showCheckingPage(currentChecking);
}

// Update Checking Data
function updateCheckingData(index, field, value) {
    checkingData[index][field] = value;
    
    const dropdown = document.getElementById(`${field}-${index}`);
    dropdown.classList.remove('pass-selected', 'fail-selected');
    if (value === 'Pass') {
        dropdown.classList.add('pass-selected');
    } else if (value === 'Fail') {
        dropdown.classList.add('fail-selected');
    }
    
    checkAutoScroll();
}

// Update Cycle Time
function updateCycleTime(index, value) {
    checkingData[index].cycleTime = parseInt(value) || 0;
    checkAutoScroll();
}

// Check Auto Scroll
function checkAutoScroll() {
    const currentCheckData = checkingData.filter(item => item.checking === currentChecking);
    const allFilled = currentCheckData.every(item => 
        item.left && item.right && item.cycleTime > 0
    );
    
    if (allFilled && currentChecking < 3) {
        setTimeout(() => {
            nextChecking();
        }, 500);
    }
}

// Toggle Timer
function toggleTimer(index) {
    const item = checkingData[index];
    const btn = document.getElementById(`timer-btn-${index}`);
    const timeInput = document.getElementById(`time-${index}`);
    
    if (item.timerStatus === 'stopped') {
        item.timerStatus = 'running';
        btn.className = 'timer-btn-small running';
        btn.innerHTML = '⏸️';
        
        timerIntervals[index] = setInterval(() => {
            checkingData[index].cycleTime++;
            if (timeInput) {
                timeInput.value = checkingData[index].cycleTime;
            }
        }, 1000);
        
    } else if (item.timerStatus === 'running') {
        item.timerStatus = 'paused';
        btn.className = 'timer-btn-small paused';
        btn.innerHTML = '⏹️';
        clearInterval(timerIntervals[index]);
        
    } else {
        item.timerStatus = 'stopped';
        btn.className = 'timer-btn-small stopped';
        btn.innerHTML = '▶️';
        clearInterval(timerIntervals[index]);
    }
}

// Show Checking Page
function showCheckingPage(checkNum) {
    for (let i = 1; i <= 3; i++) {
        const page = document.getElementById(`checking-${i}`);
        if (i === checkNum) {
            page.classList.add('active');
        } else {
            page.classList.remove('active');
        }
    }
    
    document.getElementById('checkingIndicator').textContent = `Pemeriksaan ${checkNum} dari 3`;
    updateNavigationButtons();
}

// Navigation Functions
function prevChecking() {
    if (currentChecking > 1) {
        currentChecking--;
        showCheckingPage(currentChecking);
    }
}

function nextChecking() {
    if (currentChecking < 3) {
        currentChecking++;
        showCheckingPage(currentChecking);
    }
}

function updateNavigationButtons() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    prevBtn.disabled = currentChecking === 1;
    nextBtn.disabled = currentChecking === 3;
}

// Format Date
function formatDate(dateString) {
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                   'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const date = new Date(dateString);
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Save Data
function saveData() {
    const assessor = document.getElementById('assessorInput').value;
    const nik = document.getElementById('nikInput').value;
    const name = document.getElementById('nameInput').value;
    const subDept = document.getElementById('subDeptInput').value;
    const line = document.getElementById('lineInput').value;
    
    // Validation
    if (!assessor) {
        alert('Mohon isi nama Penilai!');
        return;
    }
    
    if (!nik || !name) {
        alert('Mohon isi NIK terlebih dahulu!');
        return;
    }
    
    if (!subDept) {
        alert('Mohon pilih Sub-Department Area!');
        return;
    }
    
    if (!line) {
        alert('Mohon pilih Line!');
        return;
    }
    
    // Check if all data filled (MANDATORY)
    const allFilled = checkingData.every(item => 
        item.left && item.right && item.cycleTime > 0
    );
    
    if (!allFilled) {
        alert('Semua data checking wajib diisi!\nPastikan semua Pass/Fail dan Cycle Time telah diisi.');
        return;
    }
    
    // Save data
    const submission = {
        assessor: assessor,
        nik: nik,
        name: name,
        subDept: subDept,
        line: line,
        data: JSON.parse(JSON.stringify(checkingData)),
        timestamp: new Date().toISOString()
    };
    
    submittedData.push(submission);
    saveToStorage();
    
    alert('Data berhasil disimpan!');
    resetForm();
}

// Reset Form
function resetForm() {
    document.getElementById('assessorInput').value = '';
    document.getElementById('nikInput').value = '';
    document.getElementById('nameInput').value = '';
    document.getElementById('subDeptInput').value = '';
    document.getElementById('lineInput').value = '';
    
    Object.values(timerIntervals).forEach(interval => clearInterval(interval));
    timerIntervals = {};
    
    currentChecking = 1;
    initializeCheckingData();
}

// Check for duplicates
function isDuplicate(nik) {
    return submittedData.filter(s => s.nik === nik).length > 1;
}

// Render Employee List
function renderEmployeeList() {
    const employeeList = document.getElementById('employeeList');
    const filterValue = document.getElementById('filterSubDept').value;
    
    employeeList.innerHTML = '';
    
    let filteredData = submittedData.filter(s => isWithinDateRange(s.timestamp));
    
    if (filterValue) {
        filteredData = filteredData.filter(s => s.subDept === filterValue);
    }
    
    if (filteredData.length === 0) {
        employeeList.innerHTML = '<p class="empty-state">Tidak ada data peserta dalam periode ini</p>';
        return;
    }
    
    filteredData.forEach((submission) => {
        const check = checkAnswer(submission);
        const duplicate = isDuplicate(submission.nik);
        const noKey = !answerKeys[submission.subDept];
        
        const itemDiv = document.createElement('button');
        itemDiv.className = 'employee-item';
        
        if (userRole === 'admin') {
            if (duplicate) {
                itemDiv.classList.add('duplicate');
            } else if (noKey) {
                itemDiv.classList.add('no-key');
            } else if (check.correct) {
                itemDiv.classList.add('correct');
            } else {
                itemDiv.classList.add('incorrect');
            }
        } else {
            itemDiv.classList.add('user-view');
        }
        
        itemDiv.onclick = () => showEmployeeDetail(submission);
        itemDiv.textContent = `${submission.name} - ${submission.nik}`;
        
        employeeList.appendChild(itemDiv);
    });
}

// Filter Employee List
function filterEmployeeList() {
    renderEmployeeList();
}

// Check Answer
function checkAnswer(submission) {
    if (!answerKeys[submission.subDept]) {
        return { correct: true, errors: [] };
    }
    
    const key = answerKeys[submission.subDept];
    let correct = true;
    const errors = [];
    
    submission.data.forEach((item) => {
        const sampleKey = key[item.sample];
        if (sampleKey) {
            if (item.left !== sampleKey.left) {
                correct = false;
                errors.push({ checking: item.checking, sample: item.sample, side: 'left' });
            }
            if (item.right !== sampleKey.right) {
                correct = false;
                errors.push({ checking: item.checking, sample: item.sample, side: 'right' });
            }
        }
    });
    
    return { correct, errors };
}

// Show Employee Detail
function showEmployeeDetail(submission) {
    selectedEmployee = submission;
    
    document.getElementById('employeeList').classList.add('hidden');
    document.getElementById('filterContainer').classList.add('hidden');
    document.getElementById('employeeDetail').classList.remove('hidden');
    
    const employeeInfo = document.getElementById('employeeInfo');
    employeeInfo.innerHTML = `
        <p><strong>Tanggal:</strong> ${formatDate(selectedEmployee.timestamp)}</p>
        <p><strong>Penilai:</strong> ${selectedEmployee.assessor}</p>
        <p><strong>Nama:</strong> ${selectedEmployee.name}</p>
        <p><strong>NIK:</strong> ${selectedEmployee.nik}</p>
        <p><strong>Bagian:</strong> ${selectedEmployee.subDept} ${selectedEmployee.line}</p>
    `;
    
    renderGradeTable();
    
    if (userRole === 'admin') {
        document.getElementById('downloadBtn').classList.remove('hidden');
        document.getElementById('deleteDataBtn').classList.remove('hidden');
    }
}

// Back to List
function backToList() {
    selectedEmployee = null;
    document.getElementById('employeeList').classList.remove('hidden');
    document.getElementById('filterContainer').classList.remove('hidden');
    document.getElementById('employeeDetail').classList.add('hidden');
}

// Render Grade Table
function renderGradeTable() {
    const table = document.getElementById('gradeTable');
    const check = checkAnswer(selectedEmployee);
    
    let html = `
        <thead>
            <tr>
                <th>Sepatu</th>
                <th>Pemeriksaan 1</th>
                <th>Pemeriksaan 2</th>
                <th>Pemeriksaan 3</th>
            </tr>
        </thead>
        <tbody>
    `;
    
    for (let num = 1; num <= 10; num++) {
        const sampleNum = Math.ceil(num / 2);
        const isLeft = num % 2 === 1;
        
        html += '<tr>';
        html += `<td><strong>${num}</strong></td>`;
        
        for (let checkNum = 1; checkNum <= 3; checkNum++) {
            const item = selectedEmployee.data.find(d => 
                d.checking === checkNum && d.sample === sampleNum
            );
            
            const value = item ? (isLeft ? item.left : item.right) : '';
            const display = value === 'Pass' ? 'P' : value === 'Fail' ? 'F' : '-';
            
            const isWrong = check.errors.some(e => 
                e.checking === checkNum && 
                e.sample === sampleNum && 
                e.side === (isLeft ? 'left' : 'right')
            );
            
            const cellClass = isWrong ? 'wrong-answer' : '';
            html += `<td class="${cellClass}">${display}</td>`;
        }
        
        html += '</tr>';
    }
    
    html += '</tbody>';
    table.innerHTML = html;
}

// Delete Employee Data
function deleteEmployeeData() {
    if (!selectedEmployee) return;
    
    if (confirm(`Apakah Anda yakin ingin menghapus data ${selectedEmployee.name} (${selectedEmployee.nik})?`)) {
        const index = submittedData.findIndex(s => 
            s.nik === selectedEmployee.nik && 
            s.timestamp === selectedEmployee.timestamp
        );
        
        if (index > -1) {
            submittedData.splice(index, 1);
            saveToStorage();
            alert('Data berhasil dihapus!');
            backToList();
            renderEmployeeList();
        }
    }
}

// Download Excel (Placeholder)
function downloadExcel() {
    alert('Fitur download Excel akan diimplementasikan dengan library export.\nUntuk saat ini, Anda bisa copy tabel secara manual.');
}

// Save Date Settings
function saveDateSettings() {
    const start = document.getElementById('dateStart').value;
    const end = document.getElementById('dateEnd').value;
    
    if (!start || !end) {
        alert('Mohon isi tanggal mulai dan selesai!');
        return;
    }
    
    if (new Date(start) > new Date(end)) {
        alert('Tanggal mulai tidak boleh lebih besar dari tanggal selesai!');
        return;
    }
    
    dateRange.start = start;
    dateRange.end = end;
    saveToStorage();
    
    alert('Pengaturan tanggal berhasil disimpan!\nPeriode: ' + start + ' sampai ' + end);
}
