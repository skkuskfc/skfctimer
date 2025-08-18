document.addEventListener('DOMContentLoaded', () => {
    const mainTitle = document.getElementById('main-title');
    const contentArea = document.getElementById('content-area');
    let timerInterval = null;

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
        if (timerInterval) clearInterval(timerInterval);
        contentArea.innerHTML = '';
        sessionStorage.removeItem('ceda_active');

        const contentType = item.dataset.content;
        if (contentType === 'ceda-timer') {
            contentArea.innerHTML = getCedaTimerHTML();
            fetch('/start_timer', { method: 'POST' })
                .then(() => {
                    sessionStorage.setItem('ceda_active', 'true');
                    timerInterval = setInterval(fetchCedaStatus, 500);
                });
        } else {
            contentArea.innerHTML = `<p style="padding: 20px;">${item.textContent} 콘텐츠가 여기에 표시됩니다.</p>`;
        }
    }

    async function fetchCedaStatus() {
        try {
            const response = await fetch('/status');
            if (!response.ok) throw new Error('Server not responding');
            const data = await response.json();

            if (!data.active) {
                if(timerInterval) clearInterval(timerInterval);
                sessionStorage.removeItem('ceda_active');
                return;
            }
            
            updateTimelineUI(data);

            const timerViewContainer = document.getElementById('ceda-timer-container');
            if (!timerViewContainer) return;

            if (data.type === 'sequence') {
                timerViewContainer.classList.remove('free-debate-mode');
                timerViewContainer.classList.add('sequence-mode');
                updateCedaSequenceUI(data);
            } else if (data.type === 'free_debate') {
                timerViewContainer.classList.remove('sequence-mode');
                timerViewContainer.classList.add('free-debate-mode');
                updateFreeDebateUI(data);
            }

            timerViewContainer.classList.toggle('running', data.is_running);
            timerViewContainer.classList.toggle('stopped', !data.is_running);
            timerViewContainer.classList.toggle('finished', data.is_finished);

        } catch (error) { 
            console.error("상태 업데이트 중 오류:", error);
            if(timerInterval) clearInterval(timerInterval);
        }
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
    
    function updateCedaSequenceUI(data) {
        const view = document.getElementById('sequence-timer-display');
        if (!view) return;
        
        const timerProgressCircle = view.querySelector('.timer-progress');
        const circleRadius = timerProgressCircle.r.baseVal.value;
        const circumference = 2 * Math.PI * circleRadius;
        const progress = data.runtime > 0 ? data.remain_sec / data.runtime : 0;
        timerProgressCircle.style.strokeDashoffset = circumference * (1 - progress);

        view.querySelector('#timer-title').textContent = data.step_name;
        view.querySelector('#timer-time').textContent = data.time_str;

        const toggleBtn = document.getElementById('toggle-btn');
        if (toggleBtn) {
            toggleBtn.className = data.is_running ? 'pause' : 'play';
        }
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
        
        const playPauseClass = data.is_running ? 'pause' : 'play';
        document.querySelectorAll('.panel-toggle-btn').forEach(btn => btn.className = `panel-toggle-btn ${playPauseClass}`);

        const turnProgress = data.turn_remain_sec / 120;
        const activeCircle = document.querySelector('.debate-panel.active .turn-progress');
        const inactiveCircle = document.querySelector('.debate-panel:not(.active) .turn-progress');
        
        if(activeCircle) {
            const radius = activeCircle.r.baseVal.value;
            const circumference = 2 * Math.PI * radius;
            activeCircle.style.strokeDashoffset = circumference * (1 - turnProgress);
        }
        if(inactiveCircle) {
             const radius = inactiveCircle.r.baseVal.value;
             const circumference = 2 * Math.PI * radius;
            inactiveCircle.style.strokeDashoffset = 0;
        }
    }

    function getCedaTimerHTML() {
        return `
            <div id="ceda-timer-container" class="ceda-timer-view">
                <div class="timeline-panel"><div id="timeline-list" class="timeline-list"></div></div>
                <div class="timer-panel">
                    <button id="fullscreen-btn">전체화면</button>

                    <div id="sequence-timer-display">
                        <div class="timer-display-area">
                            <svg class="timer-svg" viewBox="0 0 120 120"><circle class="timer-progress" cx="60" cy="60" r="54" /></svg>
                            <div class="timer-content">
                                <div id="timer-title" class="timer-title"></div>
                                <div id="timer-time" class="timer-time"></div>
                            </div>
                        </div>
                    </div>

                    <div id="free-debate-display">
                        <div id="pros-panel" class="debate-panel pros-panel">
                            <div id="pros-fill" class="color-fill"></div>
                            <div class="content">
                                <div class="panel-controls">
                                    <button class="panel-time-adjust-btn" data-seconds="-10">10s (-)</button>
                                    <button class="panel-time-adjust-btn" data-seconds="10">10s (+)</button>
                                </div>
                                <div class="free-timer-circle">
                                    <svg class="timer-svg" viewBox="0 0 120 120">
                                        <circle class="turn-progress-track" cx="60" cy="60" r="54" />
                                        <circle class="turn-progress" cx="60" cy="60" r="54" />
                                    </svg>
                                    <div class="timer-text-content">
                                        <div class="free-timer-title">찬성</div>
                                        <div id="pros-time" class="free-timer-time">00:00</div>
                                    </div>
                                </div>
                                <button class="panel-toggle-btn"></button>
                                <div class="turn-timer"><div class="turn-timer-title">1회 발언 시간</div><div id="pros-turn-time" class="turn-timer-time">00:00</div></div>
                            </div>
                        </div>
                        <div id="cons-panel" class="debate-panel cons-panel">
                            <div id="cons-fill" class="color-fill"></div>
                            <div class="content">
                               <div class="panel-controls">
                                     <button class="panel-time-adjust-btn" data-seconds="-10">10s (-)</button>
                                     <button class="panel-time-adjust-btn" data-seconds="10">10s (+)</button>
                                </div>
                                <div class="free-timer-circle">
                                    <svg class="timer-svg" viewBox="0 0 120 120">
                                        <circle class="turn-progress-track" cx="60" cy="60" r="54" />
                                        <circle class="turn-progress" cx="60" cy="60" r="54" />
                                    </svg>
                                    <div class="timer-text-content">
                                        <div class="free-timer-title">반대</div>
                                        <div id="cons-time" class="free-timer-time">00:00</div>
                                    </div>
                                </div>
                                <button class="panel-toggle-btn"></button>
                                <div class="turn-timer"><div class="turn-timer-title">1회 발언 시간</div><div id="cons-turn-time" class="turn-timer-time">00:00</div></div>
                            </div>
                        </div>
                    </div>

                    <button id="switch-turn-btn" class="step-btn">발언자 전환</button>
                    
                    <div class="timer-controls">
                        <button id="toggle-btn"></button>
                        <div class="step-controls">
                            <button id="prev-btn" class="step-btn">이전</button>
                            <button id="next-step-btn" class="step-btn">다음</button>
                        </div>
                        <div class="time-adjust-controls">
                             <button id="add-10s-btn" class="time-adjust-btn">10s (+)</button>
                             <button id="subtract-10s-btn" class="time-adjust-btn">10s (-)</button>
                        </div>
                    </div>
                </div>
            </div>`;
    }
    
    contentArea.addEventListener('click', (e) => {
        const target = e.target;
        const targetId = target.id;

        if (target.closest('.timeline-item')) {
            const stepIndex = parseInt(target.closest('.timeline-item').dataset.stepIndex, 10);
            fetch('/set_step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: stepIndex }) });
        } 
        else if (target.closest('.debate-panel:not(.active)')) {
            fetch('/switch_turn', { method: 'POST' });
        }
        else if (target.classList.contains('panel-toggle-btn') || targetId === 'toggle-btn') {
            fetch('/toggle_timer', { method: 'POST' });
        }
        else if (target.classList.contains('panel-time-adjust-btn')) {
            const seconds = parseInt(target.dataset.seconds, 10);
            fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: seconds}) });
        }
        else if (targetId === 'fullscreen-btn') {
            const view = document.getElementById('ceda-timer-container');
            if (view && !document.fullscreenElement) view.requestFullscreen().catch(err => console.error(err));
            else if (document.exitFullscreen) document.exitFullscreen();
        }
        else if (targetId === 'prev-btn') fetch('/previous_step', { method: 'POST' });
        else if (targetId === 'switch-turn-btn') fetch('/switch_turn', { method: 'POST' });
        else if (targetId === 'next-step-btn') fetch('/next_step', { method: 'POST' });
        else if (targetId === 'add-10s-btn' || targetId === 'subtract-10s-btn') {
            const seconds = (targetId === 'add-10s-btn') ? 10 : -10;
            fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: seconds}) });
        }
    });

    document.addEventListener('keydown', (e) => {
        if (sessionStorage.getItem('ceda_active') !== 'true') return;
        
        const actionMap = {
            ' ': () => fetch('/toggle_timer', { method: 'POST' }),
            'ArrowUp': () => fetch('/previous_step', { method: 'POST' }),
            'ArrowDown': () => fetch('/next_step', { method: 'POST' }),
            'ArrowLeft': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: -10}) }),
            'ArrowRight': () => fetch('/adjust_time', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({seconds: 10}) })
        };

        if (actionMap[e.key]) {
            e.preventDefault();
            actionMap[e.key]();
        }
    });
});