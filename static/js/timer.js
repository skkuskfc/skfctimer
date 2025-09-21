document.addEventListener('DOMContentLoaded', () => {
    const mainTitle = document.getElementById('main-title');
    const contentArea = document.getElementById('content-area');
    let appInterval = null;
    let qrInterval = null;

    const activeMenuItem = document.querySelector('.menu-item.active');
    if (activeMenuItem) {
        mainTitle.textContent = activeMenuItem.textContent;
        loadContentFor(activeMenuItem);
    }

    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
            e.currentTarget.classList.add('active');
            mainTitle.textContent = e.currentTarget.textContent;
            loadContentFor(e.currentTarget);
        });
    });

    function loadContentFor(item) {
        if (appInterval) clearInterval(appInterval);
        if (qrInterval) clearInterval(qrInterval);
        contentArea.innerHTML = '';
        const currentMode = item.dataset.content.replace('-timer', '');
        sessionStorage.setItem('current_mode', currentMode);

        const contentType = item.dataset.content;
        
        if (contentType === 'attendance') {
            contentArea.innerHTML = getAttendanceHTML();
            document.getElementById('load-roster-btn').addEventListener('click', initializeAttendanceWithRoster);
            document.getElementById('set-cutoff-time-btn').addEventListener('click', setCutoffTime);
            fetch('/start_attendance', { method: 'POST' });
            const qrImg = document.getElementById('qr-code-img');
            const updateQRCode = () => { if (qrImg) qrImg.src = `/qrcode?t=${new Date().getTime()}`; };
            updateQRCode();
            qrInterval = setInterval(updateQRCode, 10000);
            fetchTodaysAttendance();
            appInterval = setInterval(fetchTodaysAttendance, 3000);
        } else if (contentType === 'history') {
            contentArea.innerHTML = getHistoryHTML();
            const datePicker = document.getElementById('history-date-picker');
            datePicker.value = new Date().toISOString().split('T')[0];
            fetchHistory(datePicker.value);
            datePicker.addEventListener('change', (e) => fetchHistory(e.target.value));
            document.getElementById('reset-history-btn').addEventListener('click', () => {
                const selectedDate = datePicker.value;
                if (!selectedDate) { alert('날짜를 먼저 선택해주세요.'); return; }
                if (confirm(`${selectedDate}의 출석 기록을 정말로 초기화하시겠습니까?`)) resetHistory(selectedDate);
            });
            document.getElementById('export-excel-btn').addEventListener('click', () => {
                const selectedDate = datePicker.value;
                if (!selectedDate) { alert('날짜를 먼저 선택해주세요.'); return; }
                window.location.href = `/export_excel?date=${selectedDate}`;
            });
        } else if (contentType === 'member-roster') {
            contentArea.innerHTML = getMemberRosterHTML();
            initializeRosterPage();
        } else if (contentType === 'access-management') {
            contentArea.innerHTML = getAccessManagementHTML();
            initializeAccessManagementPage();
        } else if (['ceda-timer', 'free-timer', 'general-timer'].includes(contentType)) {
            let startEndpoint = '';
            if (contentType === 'ceda-timer') startEndpoint = '/start_ceda_timer';
            else if (contentType === 'free-timer') startEndpoint = '/start_free_timer';
            else if (contentType === 'general-timer') startEndpoint = '/start_general_timer';
            contentArea.innerHTML = getTimerHTML();
            fetch(startEndpoint, { method: 'POST' }).then(() => {
                fetchStatus();
                appInterval = setInterval(fetchStatus, 500);
            });
        } else {
            contentArea.innerHTML = `<p style="padding: 20px;">${item.textContent} 콘텐츠가 여기에 표시됩니다.</p>`;
        }
    }
    
    // --- 출석 관리 ---
    function getAttendanceHTML() {
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const dateString = `${month}월 ${day}일`;
        return `
            <div class="attendance-container">
                <div class="qr-panel">
                    <h2>모바일로 QR 코드를 스캔하여<br>출석체크 해주세요.</h2>
                    <img id="qr-code-img" src="" alt="QR Code Loading...">
                </div>
                <div class="attendee-list-panel">
                    <div class="roster-header">
                        <h2 id="attendance-title">${dateString} 출석 현황</h2>
                        <div class="attendance-controls">
                            <label for="cutoff-time-input">출석 인정 마감:</label>
                            <input type="time" id="cutoff-time-input" value="18:00">
                            <button id="set-cutoff-time-btn" class="action-btn">시간 설정</button>
                            <button id="load-roster-btn" class="action-btn">현 기수 불러오기</button>
                        </div>
                    </div>
                    <ul id="attendee-list"></ul>
                    <div class="total-count" id="attendee-total"></div>
                </div>
            </div>`;
    }

    async function setCutoffTime() {
        const cutoffTime = document.getElementById('cutoff-time-input').value;
        if (!cutoffTime) { alert('시간을 선택해주세요.'); return; }
        const today_str = new Date().toISOString().split('T')[0];
        try {
            await fetch('/api/set_cutoff_time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: today_str, cutoff_time: cutoffTime }) });
            alert(`출석 인정 시간이 ${cutoffTime}으로 설정되었습니다.`);
        } catch (error) { alert('시간 설정에 실패했습니다.'); }
    }

    async function initializeAttendanceWithRoster() {
        if (!confirm('현 기수 명단을 불러와 오늘 출석부를 시작합니다. 기존 출석 정보가 있다면 덮어씌워집니다. 계속하시겠습니까?')) return;
        try {
            const response = await fetch('/api/initialize_attendance_with_roster', { method: 'POST' });
            const data = await response.json();
            if (!response.ok) { alert(data.error || '명단 초기화 실패'); return; }
            displayAttendanceList(data.attendees);
        } catch (error) { alert('출석부를 초기화하는 중 오류가 발생했습니다.'); }
    }
    
    async function fetchTodaysAttendance() {
        try {
            const response = await fetch('/api/todays_attendance');
            const data = await response.json();
            if (data.settings && data.settings.cutoff_time) {
                const timeInput = document.getElementById('cutoff-time-input');
                if (timeInput) timeInput.value = data.settings.cutoff_time;
            }
            displayAttendanceList(data.attendees);
        } catch (error) { console.error("오늘 출석 현황 로딩 중 오류:", error); }
    }
    
    function displayAttendanceList(attendees) {
        const listElement = document.getElementById('attendee-list');
        const totalElement = document.getElementById('attendee-total');
        if (!listElement || !totalElement) return;

        const statusIcons = { '출석': '<span class="status-icon present">출석</span>', '결석': '<span class="status-icon absent">결석</span>', '지각': '<span class="status-icon late">지각</span>' };

        if (!attendees || attendees.length === 0) {
            listElement.innerHTML = `<li>'현 기수 불러오기' 버튼을 눌러 출석부를 시작하세요.</li>`;
            totalElement.textContent = `총 인원: 0명`;
        } else {
            listElement.innerHTML = attendees.map(member => `
                <li>
                    <span class="name">${member.name}</span>
                    <span class="type">${member.type}</span>
                    <div class="attendance-info">${statusIcons[member.status] || ''}</div>
                </li>
            `).join('');
            const presentCount = attendees.filter(m => m.status === '출석').length;
            const lateCount = attendees.filter(m => m.status === '지각').length;
            const absentCount = attendees.filter(m => m.status === '결석').length;
            totalElement.textContent = `총원: ${attendees.length}명 (출석: ${presentCount}명, 지각: ${lateCount}명, 결석: ${absentCount}명)`;
        }
    }
    
    // --- 출석 기록 ---
    function getHistoryHTML() {
        return `
            <div class="history-container">
                <div class="date-picker-area">
                    <label for="history-date-picker">날짜 선택:</label>
                    <input type="date" id="history-date-picker">
                    <button id="export-excel-btn" class="export-btn">엑셀 파일로 내보내기</button>
                    <button id="reset-history-btn" class="reset-btn">해당 날짜 기록 초기화</button>
                </div>
                <div id="history-results" class="attendee-list-panel">
                    <h2>출석 기록</h2>
                    <ul id="history-attendee-list"></ul>
                    <div class="total-count" id="history-total"></div>
                </div>
            </div>`;
    }

    async function fetchHistory(date) {
        const listElement = document.getElementById('history-attendee-list');
        const totalElement = document.getElementById('history-total');
        if (!listElement || !totalElement) return;
        listElement.innerHTML = '<li>기록을 불러오는 중...</li>';
        totalElement.textContent = '';
        try {
            const response = await fetch(`/get_history_by_date?date=${date}`);
            const data = await response.json();
            const attendees = data.attendees || [];
            if (attendees.length > 0) {
                listElement.innerHTML = attendees.map(a => `
                    <li>
                        <span class="name">${a.name}</span>
                        <span class="type">${a.type}</span>
                        <div class="attendance-info">
                            <span class="timestamp">${a.timestamp || ''}</span>
                            <select class="status-dropdown" data-name="${a.name}" data-date="${date}">
                                <option value="출석" ${a.status === '출석' ? 'selected' : ''}>출석</option>
                                <option value="지각" ${a.status === '지각' ? 'selected' : ''}>지각</option>
                                <option value="결석" ${a.status === '결석' ? 'selected' : ''}>결석</option>
                            </select>
                        </div>
                    </li>
                `).join('');
                document.querySelectorAll('.status-dropdown').forEach(dropdown => {
                    dropdown.addEventListener('change', updateAttendanceStatus);
                });
            } else {
                listElement.innerHTML = '<li>해당 날짜의 출석 기록이 없습니다.</li>';
            }
            totalElement.textContent = `총 인원: ${attendees.length}명`;
        } catch (error) {
            console.error("출석 기록 조회 중 오류:", error);
            listElement.innerHTML = '<li>기록을 불러오는 데 실패했습니다.</li>';
        }
    }
    
    async function updateAttendanceStatus(event) {
        const dropdown = event.target;
        const name = dropdown.dataset.name;
        const date = dropdown.dataset.date;
        const newStatus = dropdown.value;
        try {
            const response = await fetch('/api/update_attendance_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, name, status: newStatus })
            });
            if (!response.ok) throw new Error('상태 업데이트 실패');
            dropdown.closest('li').style.backgroundColor = '#d4edda';
            setTimeout(() => { 
                dropdown.closest('li').style.backgroundColor = ''; 
                fetchHistory(date);
            }, 1000);
        } catch (error) {
            console.error("출석 상태 업데이트 중 오류:", error);
            alert('출석 상태 업데이트에 실패했습니다.');
            fetchHistory(date);
        }
    }
    
    async function resetHistory(date) {
        try {
            await fetch('/reset_attendance_by_date', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: date })
            });
            fetchHistory(date);
        } catch(error) {
            console.error("출석 기록 초기화 중 오류:", error);
            alert("기록 초기화에 실패했습니다.");
        }
    }

    // --- 부원 명단 관리 ---
    function getMemberRosterHTML() {
        return `
            <div class="roster-container">
                <div class="roster-controls">
                    <select id="cohort-select"></select>
                    <button id="save-roster-btn" class="action-btn">명단 저장</button>
                    <button id="manage-cohort-btn" class="action-btn">기수 관리</button>
                </div>
                <div class="roster-table-container">
                    <table id="roster-table">
                        <thead>
                            <tr><th>이름</th><th>기수</th><th>활동 구분</th><th>비고</th><th>삭제</th></tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
                <button id="add-member-btn" class="action-btn">부원 추가</button>
            </div>
            <div id="cohort-modal" class="modal-overlay" style="display:none;">
                <div class="modal-content">
                    <span id="close-cohort-modal" class="close-btn">&times;</span>
                    <h2>기수 관리</h2>
                    <form id="cohort-form">
                        <input type="text" id="cohort-id" placeholder="기수 (예: 42기)" required>
                        <input type="text" id="cohort-president" placeholder="회장 이름" required>
                        <label>활동 기간</label>
                        <div class="date-range">
                            <input type="date" id="cohort-start-date" required> ~ <input type="date" id="cohort-end-date" required>
                        </div>
                        <button type="submit">기수 등록/수정</button>
                    </form>
                </div>
            </div>`;
    }

    async function initializeRosterPage() {
        document.getElementById('manage-cohort-btn').addEventListener('click', () => {
            document.getElementById('cohort-modal').style.display = 'flex';
        });
        document.getElementById('close-cohort-modal').addEventListener('click', () => {
            document.getElementById('cohort-modal').style.display = 'none';
        });
        document.getElementById('cohort-form').addEventListener('submit', saveCohort);
        document.getElementById('add-member-btn').addEventListener('click', () => addRosterRow());
        document.getElementById('cohort-select').addEventListener('change', loadRosterForSelectedCohort);
        document.getElementById('save-roster-btn').addEventListener('click', saveRoster);
        await loadCohorts();
    }
    
    async function loadCohorts() {
        const response = await fetch('/api/cohorts');
        const cohorts = await response.json();
        const select = document.getElementById('cohort-select');
        const currentSelected = select.value;
        select.innerHTML = '';
        
        const sortedCohorts = Object.keys(cohorts).sort((a, b) => parseInt(b) - parseInt(a));

        sortedCohorts.forEach(id => select.add(new Option(id, id)));
        
        if (currentSelected && sortedCohorts.includes(currentSelected)) {
            select.value = currentSelected;
        } else {
            const today = new Date();
            let currentCohort = null;
            for (const id in cohorts) {
                const start = new Date(cohorts[id].start_date);
                const end = new Date(cohorts[id].end_date);
                if (start <= today && today <= end) {
                    currentCohort = id; break;
                }
            }
            if (currentCohort) select.value = currentCohort;
        }
        await loadRosterForSelectedCohort();
    }

    async function saveCohort(e) {
        e.preventDefault();
        const cohortData = {
            cohort_id: document.getElementById('cohort-id').value,
            president: document.getElementById('cohort-president').value,
            start_date: document.getElementById('cohort-start-date').value,
            end_date: document.getElementById('cohort-end-date').value,
        };
        await fetch('/api/cohorts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cohortData)
        });
        document.getElementById('cohort-modal').style.display = 'none';
        document.getElementById('cohort-form').reset();
        await loadCohorts();
    }

    async function loadRosterForSelectedCohort() {
        const cohortId = document.getElementById('cohort-select').value;
        const tbody = document.querySelector('#roster-table tbody');
        tbody.innerHTML = '';

        if (!cohortId) {
            tbody.innerHTML = '<tr><td colspan="5">표시할 기수를 선택하거나 "기수 관리"에서 새 기수를 추가해주세요.</td></tr>';
            return;
        }
        const response = await fetch(`/api/roster/${cohortId}`);
        const roster = await response.json();
        
        if (roster.length > 0) roster.forEach(member => addRosterRow(member));
        else tbody.innerHTML = '<tr><td colspan="5">등록된 부원이 없습니다. "부원 추가" 버튼으로 명단을 만드세요.</td></tr>';
    }

    function addRosterRow(member = {}) {
        const tbody = document.querySelector('#roster-table tbody');
        const noMemberRow = tbody.querySelector('td[colspan="5"]');
        if (noMemberRow) tbody.innerHTML = '';
        
        const row = tbody.insertRow();
        const activityTypes = ['임원진', '액팅', '신입부원', '연구팀', '기타'];
        
        row.innerHTML = `
            <td><input type="text" class="roster-input" value="${member.name || ''}" placeholder="이름"></td>
            <td><input type="text" class="roster-input" value="${member.cohort || document.getElementById('cohort-select').value}" placeholder="기수"></td>
            <td><select class="roster-select">${activityTypes.map(type => `<option value="${type}" ${member.activity_type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></td>
            <td><input type="text" class="roster-input" value="${member.remarks || ''}" placeholder="비고"></td>
            <td><button class="delete-row-btn">&times;</button></td>`;
        row.querySelector('.delete-row-btn').addEventListener('click', () => {
            if (confirm('해당 부원을 명단에서 삭제하시겠습니까?')) row.remove();
        });
    }
    
    async function saveRoster() {
        const cohortId = document.getElementById('cohort-select').value;
        if (!cohortId) { alert('저장할 기수를 먼저 선택해주세요.'); return; }

        const rosterData = [];
        document.querySelectorAll('#roster-table tbody tr').forEach(row => {
            const inputs = row.querySelectorAll('input, select');
            if (inputs.length > 0 && inputs[0].value.trim()) {
                rosterData.push({
                    name: inputs[0].value, cohort: inputs[1].value,
                    activity_type: inputs[2].value, remarks: inputs[3].value,
                });
            }
        });

        await fetch(`/api/roster/${cohortId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roster: rosterData })
        });
        alert(`${cohortId} 명단이 저장되었습니다.`);
    }

    // --- 웹 권한 관리 기능 ---
    function getAccessManagementHTML() {
        return `
            <div class="access-management-container">
                <div class="permission-panel">
                    <h2>구분별 기능 접근 권한 설정</h2>
                    <div id="permission-table-container"></div>
                    <div class="panel-footer">
                        <button id="manage-users-btn" class="action-btn">전체 계정 관리</button>
                        <button id="save-permissions-btn" class="action-btn">권한 저장</button>
                    </div>
                </div>
                <div id="user-management-modal" class="modal-overlay" style="display:none;">
                    <div class="modal-content large">
                        <span id="close-user-modal" class="close-btn">&times;</span>
                        <h2>전체 계정 관리</h2>
                        <div id="user-list-container"></div>
                    </div>
                </div>
            </div>
        `;
    }

    async function initializeAccessManagementPage() {
        document.getElementById('manage-users-btn').addEventListener('click', openUserManagementModal);
        document.getElementById('save-permissions-btn').addEventListener('click', savePermissions);
        await renderPermissionTable();
    }

    async function renderPermissionTable() {
        const container = document.getElementById('permission-table-container');
        container.innerHTML = '<p>권한 정보를 불러오는 중...</p>';
        try {
            const response = await fetch('/api/access_data');
            if (!response.ok) throw new Error('데이터 로딩 실패');
            const data = await response.json();
            const { member_types, features, permissions } = data;

            let tableHTML = '<table id="permission-table"><thead><tr><th>구분</th>';
            Object.values(features).forEach(name => tableHTML += `<th>${name}</th>`);
            tableHTML += '</tr></thead><tbody>';

            member_types.forEach(type => {
                tableHTML += `<tr><td>${type}</td>`;
                Object.keys(features).forEach(f_id => {
                    const isChecked = permissions[type] && permissions[type].includes(f_id);
                    tableHTML += `<td><input type="checkbox" data-type="${type}" data-feature="${f_id}" ${isChecked ? 'checked' : ''}></td>`;
                });
                tableHTML += '</tr>';
            });
            tableHTML += '</tbody></table>';
            container.innerHTML = tableHTML;
        } catch (error) {
            console.error('권한 정보 로딩 실패:', error);
            container.innerHTML = '<p>권한 정보를 불러오는 데 실패했습니다.</p>';
        }
    }

    async function savePermissions() {
        const newPermissions = {};
        document.querySelectorAll('#permission-table input[type="checkbox"]').forEach(checkbox => {
            const type = checkbox.dataset.type;
            const feature = checkbox.dataset.feature;
            if (!newPermissions[type]) newPermissions[type] = [];
            if (checkbox.checked) newPermissions[type].push(feature);
        });
        try {
            await fetch('/api/permissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPermissions) });
            alert('권한이 성공적으로 저장되었습니다. 변경된 권한은 해당 사용자가 다시 로그인할 때 적용됩니다.');
        } catch (error) {
            alert('권한 저장에 실패했습니다.');
        }
    }

    async function openUserManagementModal() {
        const modal = document.getElementById('user-management-modal');
        modal.style.display = 'flex';
        document.getElementById('close-user-modal').addEventListener('click', () => modal.style.display = 'none');
        const container = document.getElementById('user-list-container');
        container.innerHTML = '<p>계정 목록을 불러오는 중...</p>';
        try {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('계정 로딩 실패');
            const users = await response.json();
            let listHTML = '<ul id="user-list">';
            users.forEach(user => {
                listHTML += `<li>
                    <span class="user-name">${user.name}</span>
                    <span class="user-info-item">구분: ${user.member_type}</span>
                    <span class="user-info-item">아이디: ${user.id}</span>
                    <span class="user-info-item">기수: ${user.cohort}</span>
                    <button class="delete-user-btn" data-userid="${user.id}" ${user.member_type === '회장' ? 'disabled' : ''}>탈퇴</button>
                </li>`;
            });
            listHTML += '</ul>';
            container.innerHTML = listHTML;
            document.querySelectorAll('.delete-user-btn').forEach(btn => btn.addEventListener('click', handleDeleteUser));
        } catch (error) {
            container.innerHTML = '<p>계정 목록을 불러오는 데 실패했습니다.</p>';
        }
    }

    async function handleDeleteUser(event) {
        const userId = event.target.dataset.userid;
        const userName = event.target.closest('li').querySelector('.user-name').textContent;
        if (confirm(`'${userName}'(${userId}) 계정을 정말로 탈퇴시키겠습니까?`)) {
            try {
                const response = await fetch('/api/delete_user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '삭제 실패');
                alert('계정이 성공적으로 삭제되었습니다.');
                openUserManagementModal();
            } catch (error) {
                alert(`계정 삭제에 실패했습니다: ${error.message}`);
            }
        }
    }
    
    // --- 타이머 관련 함수들 ---
    async function fetchStatus() {
        try {
            const response = await fetch('/status');
            if (!response.ok) throw new Error('Server not responding');
            const data = await response.json();
            if (!data.active) {
                if(appInterval) clearInterval(appInterval);
                return;
            }
            updateUI(data);
        } catch (error) { 
            console.error("타이머 상태 업데이트 중 오류:", error);
            if(appInterval) clearInterval(appInterval);
        }
    }
    function updateUI(data) {
        const timerView = document.getElementById('timer-view-container');
        if (!timerView) return;

        updateTimelineUI(data);
        
        // 숙의 시간 모드 UI 처리
        if (data.is_in_deliberation) {
            timerView.className = 'ceda-timer-view sequence-mode deliberation-mode';
            const view = document.getElementById('sequence-timer-display');
            view.querySelector('#timer-title').textContent = data.step_name;
            view.querySelector('#timer-time').textContent = data.deliberation_time_str;
            document.getElementById('deliberation-controls').style.display = 'none'; // 숙의 중에는 컨트롤 숨김
            timerView.classList.toggle('running', data.is_running);
            timerView.classList.toggle('stopped', !data.is_running);
            return; 
        } else {
             timerView.classList.remove('deliberation-mode');
        }

        const customInputArea = document.getElementById('custom-time-input-area');
        if (customInputArea) {
            customInputArea.style.display = (data.mode === 'general' && data.step_name === '직접 입력') ? 'flex' : 'none';
        }
        if (data.type === 'sequence') {
            timerView.className = 'ceda-timer-view sequence-mode';
            updateSequenceUI(data);
        } else if (data.type === 'free_debate') {
            timerView.className = 'ceda-timer-view free-debate-mode';
            updateFreeDebateUI(data);
        }
        
        // 숙의 시간 컨트롤러 UI 업데이트
        const deliberationControls = document.getElementById('deliberation-controls');
        if (deliberationControls) {
            if (data.show_deliberation_controls) {
                deliberationControls.style.display = 'flex';
                // 현재 어떤 팀이 사용할 수 있는지 데이터 속성으로 저장
                deliberationControls.dataset.team = data.deliberation_chance_for;
                
                const teamRemainSec = data.deliberation_remain[data.deliberation_chance_for];
                const remainingMins = Math.floor(teamRemainSec / 60);
                
                const circles = deliberationControls.querySelectorAll('.deliberation-circle');
                circles.forEach(c => c.classList.remove('used', 'selected'));
                
                circles[0].classList.toggle('used', remainingMins < 1);
                circles[1].classList.toggle('used', remainingMins < 2);
                
                document.getElementById('deliberation-select-btn').disabled = false;
            } else {
                deliberationControls.style.display = 'none';
            }
        }
        timerView.classList.toggle('running', data.is_running);
        timerView.classList.toggle('stopped', !data.is_running);
    }
    function updateTimelineUI(data) {
        const timelineList = document.getElementById('timeline-list');
        if (!timelineList) return;
        timelineList.innerHTML = data.timeline.names.map((name, i) => 
            `<div class="timeline-item ${i === data.step ? 'active' : ''}" data-step-index="${i}"><span>${name}</span></div>`
        ).join('');
    }
    function updateSequenceUI(data) {
        const view = document.getElementById('sequence-timer-display');
        if (!view) return;
        const circle = view.querySelector('.timer-progress');
        const r = circle.r.baseVal.value;
        const C = 2 * Math.PI * r;
        const progress = data.runtime > 0 ? data.remain_sec / data.runtime : 0;
        circle.style.strokeDashoffset = C * (1 - progress);
        view.querySelector('#timer-title').textContent = data.step_name;
        view.querySelector('#timer-time').textContent = data.time_str;
    }
    function updateFreeDebateUI(data) {
        document.getElementById('pros-time').textContent = data.pros_time_str;
        document.getElementById('cons-time').textContent = data.cons_time_str;
        document.getElementById('pros-turn-time').textContent = data.turn_time_str;
        document.getElementById('cons-turn-time').textContent = data.turn_time_str;
        
        const prosPanel = document.getElementById('pros-panel');
        const consPanel = document.getElementById('cons-panel');
        prosPanel.classList.toggle('active', data.turn === 'pros');
        consPanel.classList.toggle('active', data.turn === 'cons');
        
        document.getElementById('pros-fill').style.height = `${(data.pros_remain_sec / data.pros_runtime) * 100}%`;
        document.getElementById('cons-fill').style.height = `${(data.cons_remain_sec / data.cons_runtime) * 100}%`;

        const setCircleDash = (circle, progress) => {
            if (circle) {
                const r = circle.r.baseVal.value;
                const C = 2 * Math.PI * r;
                circle.style.strokeDashoffset = C * (1 - progress);
            }
        };
        setCircleDash(document.querySelector('.debate-panel.active .turn-progress'), data.turn_remain_sec / 120);
        setCircleDash(document.querySelector('.debate-panel:not(.active) .turn-progress'), 0);
    }
    function getTimerHTML() {
        return `
            <div id="timer-view-container" class="ceda-timer-view">
                <div class="timeline-panel"><div id="timeline-list" class="timeline-list"></div></div>
                <div class="timer-panel">
                    <button id="fullscreen-btn">전체화면</button>
                    <div id="deliberation-controls" style="display: none;">
                        <div class="deliberation-circles">
                            <div class="deliberation-circle" data-value="1"></div>
                            <div class="deliberation-circle" data-value="2"></div>
                        </div>
                        <button id="deliberation-select-btn">숙의시간 사용</button>
                    </div>
                    <div id="sequence-timer-display">
                        <div class="timer-display-area">
                            <svg class="timer-svg" viewBox="0 0 120 120"><circle class="timer-progress" cx="60" cy="60" r="54" /></svg>
                            <div class="timer-content"><div id="timer-title" class="timer-title"></div><div id="timer-time" class="timer-time"></div></div>
                        </div>
                        <div id="custom-time-input-area">
                            <input type="number" id="custom-minutes" min="0" max="99" placeholder="분"><span>:</span><input type="number" id="custom-seconds" min="0" max="59" placeholder="초"><button id="set-custom-time-btn">설정</button>
                        </div>
                    </div>
                    <div id="free-debate-display">
                        <div id="pros-panel" class="debate-panel pros-panel"><div id="pros-fill" class="color-fill"></div><div class="content"><div class="panel-controls"><button class="panel-time-adjust-btn" data-seconds="-10">10s (-)</button><button class="panel-time-adjust-btn" data-seconds="10">10s (+)</button></div><div class="free-timer-circle"><svg class="timer-svg" viewBox="0 0 120 120"><circle class="turn-progress-track" cx="60" cy="60" r="54" /><circle class="turn-progress" cx="60" cy="60" r="54" /></svg><div class="timer-text-content"><div class="free-timer-title">찬성</div><div id="pros-time" class="free-timer-time">00:00</div></div></div><button class="panel-toggle-btn"></button><div class="turn-timer"><div class="turn-timer-title">1회 발언 시간</div><div id="pros-turn-time" class="turn-timer-time">00:00</div></div></div></div>
                        <div id="cons-panel" class="debate-panel cons-panel"><div id="cons-fill" class="color-fill"></div><div class="content"><div class="panel-controls"><button class="panel-time-adjust-btn" data-seconds="-10">10s (-)</button><button class="panel-time-adjust-btn" data-seconds="10">10s (+)</button></div><div class="free-timer-circle"><svg class="timer-svg" viewBox="0 0 120 120"><circle class="turn-progress-track" cx="60" cy="60" r="54" /><circle class="turn-progress" cx="60" cy="60" r="54" /></svg><div class="timer-text-content"><div class="free-timer-title">반대</div><div id="cons-time" class="free-timer-time">00:00</div></div></div><button class="panel-toggle-btn"></button><div class="turn-timer"><div class="turn-timer-title">1회 발언 시간</div><div id="cons-turn-time" class="turn-timer-time">00:00</div></div></div></div>
                    </div>
                    <div class="timer-controls">
                        <button id="toggle-btn"></button>
                        <div class="step-controls"><button id="prev-btn" class="step-btn">이전</button><button id="next-step-btn" class="step-btn">다음</button></div>
                        <div class="time-adjust-controls"><button id="add-10s-btn" class="time-adjust-btn">10s (+)</button><button id="subtract-10s-btn" class="time-adjust-btn">10s (-)</button></div>
                    </div>
                </div>
            </div>`;
    }

    contentArea.addEventListener('click', (e) => {
        const target = e.target;
        
        const deliberationControls = target.closest('#deliberation-controls');
        if (deliberationControls) {
            const circle = target.closest('.deliberation-circle:not(.used)');
            if (circle) {
                const circles = deliberationControls.querySelectorAll('.deliberation-circle');
                const value = parseInt(circle.dataset.value, 10);
                
                // 현재 선택 상태 확인
                const isSelected = circle.classList.contains('selected');
                const currentlySelectedCount = deliberationControls.querySelectorAll('.deliberation-circle.selected').length;

                circles.forEach(c => c.classList.remove('selected'));

                if (isSelected && currentlySelectedCount === value) {
                    // 같은 버튼을 다시 눌러 선택 취소 (1분만 선택되게)
                    if (value === 2) {
                         circles[0].classList.add('selected');
                    }
                } else {
                    // 새로 선택
                    if (value >= 1) circles[0].classList.add('selected');
                    if (value >= 2 && !circles[1].classList.contains('used')) {
                        circles[1].classList.add('selected');
                    }
                }
            }
            if (target.id === 'deliberation-select-btn') {
                const selectedCircles = deliberationControls.querySelectorAll('.deliberation-circle.selected:not(.used)');
                const timeToUse = selectedCircles.length * 60;
                const teamToUse = deliberationControls.dataset.team; // 어떤 팀이 사용할지 가져옴

                if (timeToUse > 0 && teamToUse) {
                    fetch('/use_deliberation_time', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ seconds: timeToUse, team: teamToUse })
                    }).then(res => res.json()).then(data => {
                        if (data.error) alert(data.error);
                        selectedCircles.forEach(c => c.classList.remove('selected'));
                    });
                }
            }
            return;
        }

        if (target.id === 'set-custom-time-btn') {
            const minutes = document.getElementById('custom-minutes').value || 0;
            const seconds = document.getElementById('custom-seconds').value || 0;
            fetch('/set_custom_time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes, seconds }) });
            return;
        }

        const actionMap = {
            '.timeline-item': (el) => { const stepIndex = parseInt(el.dataset.stepIndex, 10); fetch('/set_step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: stepIndex }) }); },
            '.debate-panel:not(.active)': () => fetch('/switch_turn', { method: 'POST' }),
            '.panel-toggle-btn': () => fetch('/toggle_timer', { method: 'POST' }),
            '#toggle-btn': () => fetch('/toggle_timer', { method: 'POST' }),
            '.panel-time-adjust-btn': (el) => { const seconds = parseInt(el.dataset.seconds, 10); fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: seconds}) }); },
            '#fullscreen-btn': () => { const view = document.getElementById('timer-view-container'); if (view && !document.fullscreenElement) view.requestFullscreen(); else if (document.exitFullscreen) document.exitFullscreen(); },
            '#prev-btn': () => fetch('/previous_step', { method: 'POST' }),
            '#next-step-btn': () => fetch('/next_step', { method: 'POST' }),
            '#add-10s-btn': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: 10}) }),
            '#subtract-10s-btn': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: -10}) })
        };
        for (const selector in actionMap) {
            const closestEl = target.closest(selector);
            if (closestEl) {
                actionMap[selector](closestEl); break;
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, select')) return;
        const mode = sessionStorage.getItem('current_mode');
        if (!mode) return;
        
        const isTimerVisible = document.getElementById('timer-view-container');
        if (!isTimerVisible) return;

        const actionMap = {
            ' ': '/toggle_timer', 'ArrowUp': '/previous_step', 'ArrowDown': '/next_step'
        };
        const timeAdjustMap = {
            'ArrowLeft': -10, 'ArrowRight': 10
        }

        if(mode === 'free_debate' && e.key === 'Tab') {
             e.preventDefault();
             fetch('/switch_turn', { method: 'POST' });
        } else if (actionMap[e.key]) { 
            e.preventDefault();
            fetch(actionMap[e.key], { method: 'POST' });
        } else if (timeAdjustMap[e.key]) {
            e.preventDefault();
            fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: timeAdjustMap[e.key]}) });
        }
    });
});
