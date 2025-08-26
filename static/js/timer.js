document.addEventListener('DOMContentLoaded', () => {
    const mainTitle = document.getElementById('main-title');
    const contentArea = document.getElementById('content-area');
    let appInterval = null;

    const activeMenuItem = document.querySelector('.menu-item.active');
    if (activeMenuItem) {
        loadContentFor(activeMenuItem);
    }

    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
            item.classList.add('active');
            mainTitle.textContent = item.textContent;
            loadContentFor(item);
        });
    });

    function loadContentFor(item) {
        if (appInterval) clearInterval(appInterval);
        contentArea.innerHTML = '';
        sessionStorage.removeItem('current_mode');

        const contentType = item.dataset.content;
        
        if (contentType === 'attendance') {
            contentArea.innerHTML = getAttendanceHTML();
            fetch('/start_attendance', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    const qrImg = document.getElementById('qr-code-img');
                    if(qrImg) qrImg.src = `/qrcode?url=${encodeURIComponent(data.check_in_url)}`;
                });
            fetchAttendees();
            appInterval = setInterval(fetchAttendees, 2000);
        
        } else if (contentType === 'history') {
            contentArea.innerHTML = getHistoryHTML();
            const datePicker = document.getElementById('history-date-picker');
            const resetButton = document.getElementById('reset-history-btn');
            const exportButton = document.getElementById('export-excel-btn');

            if(datePicker) {
                // 오늘 날짜를 기본값으로 설정 (YYYY-MM-DD 형식)
                datePicker.value = new Date().toISOString().split('T')[0];
                // 페이지 로드 시 오늘 날짜 기록 바로 조회
                fetchHistory(datePicker.value);
                // 날짜 변경 시 기록 조회
                datePicker.addEventListener('change', (e) => fetchHistory(e.target.value));
            }
            if(resetButton) {
                resetButton.addEventListener('click', () => {
                    const selectedDate = datePicker.value;
                    if (!selectedDate) { alert('날짜를 먼저 선택해주세요.'); return; }
                    if (confirm(`${selectedDate}의 출석 기록을 정말로 초기화하시겠습니까?`)) {
                        resetHistory(selectedDate);
                    }
                });
            }
            if(exportButton) {
                exportButton.addEventListener('click', () => {
                    const selectedDate = datePicker.value;
                    if (!selectedDate) { alert('날짜를 먼저 선택해주세요.'); return; }
                    window.location.href = `/export_excel?date=${selectedDate}`;
                });
            }

        } else if (['ceda-timer', 'free-timer', 'general-timer'].includes(contentType)) {
            let startEndpoint = '';
            if (contentType === 'ceda-timer') {
                startEndpoint = '/start_ceda_timer'; sessionStorage.setItem('current_mode', 'ceda');
            } else if (contentType === 'free-timer') {
                startEndpoint = '/start_free_timer'; sessionStorage.setItem('current_mode', 'free_debate');
            } else if (contentType === 'general-timer') {
                startEndpoint = '/start_general_timer'; sessionStorage.setItem('current_mode', 'general');
            }
            contentArea.innerHTML = getTimerHTML();
            fetch(startEndpoint, { method: 'POST' })
                .then(() => {
                    fetchStatus();
                    appInterval = setInterval(fetchStatus, 500);
                });
        } else {
            contentArea.innerHTML = `<p style="padding: 20px;">${item.textContent} 콘텐츠가 여기에 표시됩니다.</p>`;
        }
    }
    
    // (이하 모든 JS 함수는 이전 답변과 동일)
    function getAttendanceHTML() {
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const dateString = `${month}.${day}`;
        return `
            <div class="attendance-container">
                <div class="qr-panel">
                    <h2>모바일로 QR 코드를 스캔하여<br>출석체크 해주세요.</h2>
                    <img id="qr-code-img" src="" alt="QR Code Loading...">
                </div>
                <div class="attendee-list-panel">
                    <h2 id="attendance-title">${dateString} 출석 현황</h2>
                    <ul id="attendee-list"></ul>
                    <div class="total-count" id="attendee-total"></div>
                </div>
            </div>`;
    }
    async function fetchAttendees() {
        try {
            const response = await fetch('/get_attendees');
            const data = await response.json();
            const listElement = document.getElementById('attendee-list');
            const totalElement = document.getElementById('attendee-total');
            if (listElement && totalElement) {
                const attendees = data.attendees || [];
                if (attendees.length > 0) {
                    listElement.innerHTML = attendees.map(
                        a => `<li><span class="name">${a.name}</span><span class="type">${a.type}</span></li>`
                    ).join('');
                } else { listElement.innerHTML = ''; }
                totalElement.textContent = `총 인원: ${attendees.length}명`;
            }
        } catch (error) { console.error("출석자 명단 업데이트 중 오류:", error); }
    }
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
                listElement.innerHTML = attendees.map(
                    a => `<li><span class="name">${a.name}</span><span class="type">${a.type}</span></li>`
                ).join('');
            } else {
                listElement.innerHTML = '<li>해당 날짜의 출석 기록이 없습니다.</li>';
            }
            totalElement.textContent = `총 인원: ${attendees.length}명`;
        } catch (error) {
            console.error("출석 기록 조회 중 오류:", error);
            listElement.innerHTML = '<li>기록을 불러오는 데 실패했습니다.</li>';
            totalElement.textContent = '오류 발생';
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
    async function fetchStatus() {
        try {
            const response = await fetch('/status');
            if (!response.ok) throw new Error('Server not responding');
            const data = await response.json();
            if (!data.active) {
                if(appInterval) clearInterval(appInterval);
                sessionStorage.removeItem('current_mode');
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
        const customInputArea = document.getElementById('custom-time-input-area');
        if (customInputArea) {
            const isCustomInputStep = data.mode === 'general' && data.step_name === '직접 입력';
            customInputArea.style.display = isCustomInputStep ? 'flex' : 'none';
        }
        if (data.type === 'sequence') {
            timerView.classList.remove('free-debate-mode');
            timerView.classList.add('sequence-mode');
            updateSequenceUI(data);
        } else if (data.type === 'free_debate') {
            timerView.classList.remove('sequence-mode');
            timerView.classList.add('free-debate-mode');
            updateFreeDebateUI(data);
        }
        timerView.classList.toggle('running', data.is_running);
        timerView.classList.toggle('stopped', !data.is_running);
    }
    function updateTimelineUI(data) {
        const timelineList = document.getElementById('timeline-list');
        if (!timelineList) return;
        let timelineHtml = '';
        data.timeline.names.forEach((name, i) => {
            const activeClass = (i === data.step) ? 'active' : '';
            timelineHtml += `<div class="timeline-item ${activeClass}" data-step-index="${i}"><span>${name}</span></div>`;
        });
        timelineList.innerHTML = timelineHtml;
    }
    function updateSequenceUI(data) {
        const view = document.getElementById('sequence-timer-display');
        if (!view) return;
        const timerProgressCircle = view.querySelector('.timer-progress');
        const circleRadius = timerProgressCircle.r.baseVal.value;
        const circumference = 2 * Math.PI * circleRadius;
        const progress = data.runtime > 0 ? data.remain_sec / data.runtime : 0;
        timerProgressCircle.style.strokeDashoffset = circumference * (1 - progress);
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
        const prosFill = document.getElementById('pros-fill');
        const consFill = document.getElementById('cons-fill');
        if(data.pros_runtime > 0) prosFill.style.height = `${(data.pros_remain_sec / data.pros_runtime) * 100}%`;
        if(data.cons_runtime > 0) consFill.style.height = `${(data.cons_remain_sec / data.cons_runtime) * 100}%`;
        const turnProgress = data.turn_remain_sec / 120;
        const activeCircle = document.querySelector('.debate-panel.active .turn-progress');
        const inactiveCircle = document.querySelector('.debate-panel:not(.active) .turn-progress');
        const setCircleDash = (circle, progress) => {
            if (circle) {
                const radius = circle.r.baseVal.value;
                const circumference = 2 * Math.PI * radius;
                circle.style.strokeDashoffset = circumference * (1 - progress);
            }
        };
        setCircleDash(activeCircle, turnProgress);
        setCircleDash(inactiveCircle, 0);
    }
    function getTimerHTML() {
        return `
            <div id="timer-view-container" class="ceda-timer-view">
                <div class="timeline-panel"><div id="timeline-list" class="timeline-list"></div></div>
                <div class="timer-panel">
                    <button id="fullscreen-btn">전체화면</button>
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
                        <div id="pros-panel" class="debate-panel pros-panel"><div id="pros-fill" class="color-fill"></div><div class="content"><div class="panel-controls"><button class="panel-time-adjust-btn" data-seconds="-10">10s (-)</button><button class="panel-time-adjust-btn" data-seconds="10">10s (+)</button></div><div class="free-timer-circle"><svg class="timer-svg" viewBox="0 0 120 120"><circle class="turn-progress-track" cx="60" cy="60" r="54" /><circle class="turn-progress" cx="60" cy="60" r="54" /></svg><div class="timer-text-content"><div class="free-timer-title">찬성</div><div id="pros-time" class="free-timer-time">00:00</div></div></div><button class="panel-toggle-btn"></button><div class="turn-timer"><div class="turn-timer-title">1회 발언 시간</div><div id="cons-turn-time" class="turn-timer-time">00:00</div></div></div></div>
                        <div id="cons-panel" class="debate-panel cons-panel"><div id="cons-fill" class="color-fill"></div><div class="content"><div class="panel-controls"><button class="panel-time-adjust-btn" data-seconds="-10">10s (-)</button><button class="panel-time-adjust-btn" data-seconds="10">10s (+)</button></div><div class="free-timer-circle"><svg class="timer-svg" viewBox="0 0 120 120"><circle class="turn-progress-track" cx="60" cy="60" r="54" /><circle class="turn-progress" cx="60" cy="60" r="54" /></svg><div class="timer-text-content"><div class="free-timer-title">반대</div><div id="cons-time" class="free-timer-time">00:00</div></div></div><button class="panel-toggle-btn"></button><div class="turn-timer"><div class="turn-timer-title">1회 발언 시간</div><div id="pros-turn-time" class="turn-timer-time">00:00</div></div></div></div>
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
        if (target.id === 'set-custom-time-btn') {
            const minutes = document.getElementById('custom-minutes').value || 0;
            const seconds = document.getElementById('custom-seconds').value || 0;
            fetch('/set_custom_time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes, seconds }) });
            return;
        }
        const actionMap = {
            '.timeline-item': () => { const stepIndex = parseInt(target.closest('.timeline-item').dataset.stepIndex, 10); fetch('/set_step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: stepIndex }) }); },
            '.debate-panel:not(.active)': () => fetch('/switch_turn', { method: 'POST' }),
            '.panel-toggle-btn': () => fetch('/toggle_timer', { method: 'POST' }),
            '#toggle-btn': () => fetch('/toggle_timer', { method: 'POST' }),
            '.panel-time-adjust-btn': () => { const seconds = parseInt(target.dataset.seconds, 10); fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: seconds}) }); },
            '#fullscreen-btn': () => { const view = document.getElementById('timer-view-container'); if (view && !document.fullscreenElement) view.requestFullscreen().catch(err => console.error(err)); else if (document.exitFullscreen) document.exitFullscreen(); },
            '#prev-btn': () => fetch('/previous_step', { method: 'POST' }),
            '#next-step-btn': () => fetch('/next_step', { method: 'POST' }),
            '#add-10s-btn': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: 10}) }),
            '#subtract-10s-btn': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: -10}) })
        };
        for (const selector in actionMap) {
            if (target.matches(selector) || target.closest(selector)) {
                actionMap[selector](); break;
            }
        }
    });
    document.addEventListener('keydown', (e) => {
        const mode = sessionStorage.getItem('current_mode');
        if (!mode) return;
        const actionMap = {
            ' ': () => fetch('/toggle_timer', { method: 'POST' }),
            'ArrowUp': () => fetch('/previous_step', { method: 'POST' }),
            'ArrowDown': () => fetch('/next_step', { method: 'POST' }),
            'ArrowLeft': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: -10}) }),
            'ArrowRight': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: 10}) })
        };
        if (actionMap[e.key]) { e.preventDefault(); actionMap[e.key](); }
    });
});