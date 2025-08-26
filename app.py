import time
import io
import qrcode
import json
import os
from datetime import datetime
from flask import Flask, render_template, session, jsonify, request, url_for, send_file, redirect, flash
from werkzeug.security import generate_password_hash, check_password_hash
from openpyxl import Workbook

app = Flask(__name__)
app.secret_key = 'skfc-login-and-all-features'

# --- Render Disk 데이터 파일 경로 정의 ---
DISK_PATH = '/var/data'
if not os.path.exists(DISK_PATH):
    os.makedirs(DISK_PATH)

ATTENDEES_TODAY = []
ATTENDANCE_FILE = os.path.join(DISK_PATH, 'attendance_log.json')
USERS_FILE = os.path.join(DISK_PATH, 'users.json')


# 타이머 데이터
CEDA_DATA = { 'names': ['찬성1 입론', '반대2 교차조사', '반대1 입론', '찬성1 교차조사', '찬성2 입론', '반대1 교차조사', '반대2 입론', '찬성2 교차조사', '자유토론', '반대 마무리발언', '찬성 마무리발언'], 'runtimes': [4, 3, 4, 3, 4, 3, 4, 3, 8, 2, 2], 'pc': [0, 1, 1, 0, 0, 1, 1, 0, 2, 1, 0] }
FREE_DEBATE_DATA = { 'names': ['찬성 기조발언', '반대 기조발언', '자유토론', '반대 마무리 발언', '찬성 마무리 발언'], 'runtimes': [1, 1, 11, 1, 1], 'pc': [0, 1, 2, 1, 0] }
GENERAL_TIMER_DATA = { 'names': [f'{i}분 타이머' for i in range(1, 11)] + ['직접 입력'], 'runtimes': [i for i in range(1, 11)] + [0], 'pc': [0] * 11 }

# --- 파일 관리 함수 (수정된 부분) ---
def load_json_file(filename):
    try:
        # 파일이 비어있을 경우 json.load가 에러를 일으키므로 먼저 확인
        if os.path.getsize(filename) == 0:
            return {}
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        # users.json과 attendance_log.json 모두 루트가 딕셔너리이므로
        # 파일이 없거나 JSON 형식이 아닐 경우, 빈 딕셔너리를 반환합니다.
        return {}

def save_json_file(data, filename):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)


# 헬퍼 함수들
def formalize(sec): sec = int(sec); return f"{sec//60:02d}:{sec%60:02d}"
def get_remain_time(runtime_sec, timestamp):
    elapse = 0
    for i in range(0, len(timestamp) - 1, 2): elapse += timestamp[i+1] - timestamp[i]
    if len(timestamp) % 2 == 1: elapse += time.time() - timestamp[-1]
    return max(0, runtime_sec - elapse)
def is_running(timestamp): return len(timestamp) % 2 == 1
def get_current_data():
    mode = session.get('mode')
    if mode == 'ceda': return CEDA_DATA
    elif mode == 'free_debate': return FREE_DEBATE_DATA
    elif mode == 'general': return GENERAL_TIMER_DATA
    return None
def perform_turn_switch(state):
    runtime_sec = state.get('runtime', 0); current_turn = state.get('turn', 'pros'); next_turn = 'cons' if current_turn == 'pros' else 'pros'
    current_ts_key = f"{current_turn}_timestamp"; current_ts = state.get(current_ts_key, [])
    if is_running(current_ts): current_ts.append(time.time())
    state[current_ts_key] = current_ts
    next_ts_key = f"{next_turn}_timestamp"; next_ts = state.get(next_ts_key, [])
    if not is_running(next_ts) and get_remain_time(runtime_sec, next_ts) > 0: next_ts.append(time.time())
    state[next_ts_key] = next_ts
    state['turn'] = next_turn; state['turn_timestamp'] = [time.time()]
    return state

# --- 라우트 (API) ---

# 로그인/회원가입 라우트
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user_id = request.form['user_id']
        password = request.form['password']
        users = load_json_file(USERS_FILE)
        
        user_data = users.get(user_id)
        
        if user_data and check_password_hash(user_data['password_hash'], password):
            session['user_id'] = user_id
            session['user_name'] = user_data['name']
            session['member_type'] = user_data.get('member_type', '정보 없음')
            return redirect(url_for('index'))
        else:
            flash('아이디 또는 비밀번호가 올바르지 않습니다.')

    return render_template('login.html')

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        name = request.form['name']
        user_id = request.form['user_id']
        password = request.form['password']
        password_confirm = request.form['password_confirm']
        unique_code = request.form['unique_code']
        cohort = request.form['cohort']
        member_type = request.form['member_type']
        
        users = load_json_file(USERS_FILE)

        if user_id in users:
            flash('이미 존재하는 아이디입니다.')
        elif password != password_confirm:
            flash('비밀번호가 일치하지 않습니다.')
        elif unique_code != '200439204922':
            flash('고유코드가 올바르지 않습니다.')
        else:
            hashed_password = generate_password_hash(password)
            users[user_id] = {
                'name': name,
                'password_hash': hashed_password,
                'cohort': cohort,
                'member_type': member_type
            }
            save_json_file(users, USERS_FILE)
            flash('회원가입이 완료되었습니다. 로그인해주세요.')
            return redirect(url_for('login'))
            
    return render_template('signup.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# 메인 앱 라우트 (로그인 필요)
@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')

# 출석 및 타이머 라우트
@app.route('/start_attendance', methods=['POST'])
def start_attendance():
    global ATTENDEES_TODAY
    today_str = datetime.now().strftime('%Y-%m-%d')
    log = load_json_file(ATTENDANCE_FILE)
    raw_list = log.get(today_str, []) # 이제 log는 항상 딕셔너리이므로 .get() 사용 가능
    sanitized_list = [item for item in raw_list if isinstance(item, dict) and 'name' in item and 'type' in item]
    ATTENDEES_TODAY = sanitized_list
    check_in_url = url_for('check_in_page', _external=True)
    return jsonify({'status': 'attendance started', 'check_in_url': check_in_url})

@app.route('/qrcode')
def qr_code():
    url = request.args.get('url')
    if not url: return "URL not provided", 400
    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=10, border=4)
    qr.add_data(url); qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO(); img.save(buf); buf.seek(0)
    return send_file(buf, mimetype='image/png')

@app.route('/check_in')
def check_in_page(): return render_template('check_in.html')

@app.route('/submit_name', methods=['POST'])
def submit_name():
    global ATTENDEES_TODAY
    name = request.form.get('name', '').strip(); member_type = request.form.get('member_type', '기타')
    if name and member_type:
        new_attendee = {'name': name, 'type': member_type}
        
        today_str = datetime.now().strftime('%Y-%m-%d')
        log = load_json_file(ATTENDANCE_FILE)
        
        # 오늘 날짜의 출석 기록이 없으면 새로 생성
        if today_str not in log:
            log[today_str] = []
            
        # 중복 출석 방지
        if not any(a['name'] == name for a in log[today_str]):
            log[today_str].append(new_attendee)
            if not any(a['name'] == name for a in ATTENDEES_TODAY):
                ATTENDEES_TODAY.append(new_attendee)

        save_json_file(log, ATTENDANCE_FILE)
        
    return "<h1>출석이 완료되었습니다.</h1><p>이 창을 닫아주세요.</p>"

@app.route('/get_attendees')
def get_attendees(): global ATTENDEES_TODAY; return jsonify({'attendees': ATTENDEES_TODAY})

@app.route('/start_history', methods=['POST'])
def start_history(): return jsonify({'status': 'history started'})

@app.route('/get_history_by_date')
def get_history_by_date():
    date_str = request.args.get('date')
    if not date_str: return jsonify({'error': 'Date parameter is required'}), 400
    log = load_json_file(ATTENDANCE_FILE)
    attendees = log.get(date_str, []) # 이제 log는 항상 딕셔너리이므로 .get() 사용 가능
    return jsonify({'attendees': attendees})

@app.route('/reset_attendance_by_date', methods=['POST'])
def reset_attendance_by_date():
    date_str = request.json.get('date')
    if not date_str: return jsonify({'error': 'Date parameter is required'}), 400
    log = load_json_file(ATTENDANCE_FILE)
    if date_str in log:
        del log[date_str]
        save_json_file(log, ATTENDANCE_FILE)
    if date_str == datetime.now().strftime('%Y-%m-%d'):
        global ATTENDEES_TODAY; ATTENDEES_TODAY = []
    return jsonify({'status': f'{date_str} attendance reset'})

@app.route('/export_excel')
def export_excel():
    date_str = request.args.get('date')
    if not date_str: return "Date not provided", 400
    log = load_json_file(ATTENDANCE_FILE)
    attendees = log.get(date_str, [])
    wb = Workbook(); ws = wb.active; ws.title = date_str; ws.append(['이름', '부원 구분'])
    for attendee in attendees: ws.append([attendee.get('name', ''), attendee.get('type', '')])
    excel_buffer = io.BytesIO(); wb.save(excel_buffer); excel_buffer.seek(0)
    return send_file(excel_buffer, as_attachment=True, download_name=f'attendance_{date_str}.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@app.route('/start_ceda_timer', methods=['POST'])
def start_ceda_timer():
    session['mode'] = 'ceda'; session['step'] = 0; setup_step()
    return jsonify({'status': 'CEDA timer initialized'})

@app.route('/start_free_timer', methods=['POST'])
def start_free_timer():
    session['mode'] = 'free_debate'; session['step'] = 0; setup_step()
    return jsonify({'status': 'Free debate timer initialized'})

@app.route('/start_general_timer', methods=['POST'])
def start_general_timer():
    session['mode'] = 'general'; session['step'] = 0; setup_step()
    return jsonify({'status': 'General timer initialized'})

@app.route('/set_custom_time', methods=['POST'])
def set_custom_time():
    if session.get('mode') != 'general': return jsonify({'status': 'invalid mode'}), 400
    req_data = request.get_json()
    minutes = int(req_data.get('minutes', 0)); seconds = int(req_data.get('seconds', 0))
    session['step'] = len(GENERAL_TIMER_DATA['names']) - 1
    session['timer_state'] = { 'runtime': minutes * 60 + seconds, 'timestamp': [] }
    return jsonify({'status': 'custom time set'})

@app.route('/toggle_timer', methods=['POST'])
def toggle_timer():
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    state = session.get('timer_state', {})
    step = session.get('step', 0); step_type = data['pc'][step]
    if step_type == 2:
        turn = state.get('turn', 'pros'); ts_key = f"{turn}_timestamp"; timestamp = state.get(ts_key, [])
        if is_running(timestamp): timestamp.append(time.time())
        else: timestamp.append(time.time())
        state[ts_key] = timestamp
        turn_ts = state.get('turn_timestamp', [])
        if is_running(turn_ts): turn_ts.append(time.time())
        else: turn_ts.append(time.time())
        state['turn_timestamp'] = turn_ts
    else:
        timestamp = state.get('timestamp', [])
        if is_running(timestamp): timestamp.append(time.time())
        else: timestamp.append(time.time())
        state['timestamp'] = timestamp
    session['timer_state'] = state
    return jsonify({'status': 'toggled'})

@app.route('/switch_turn', methods=['POST'])
def switch_turn():
    state = session.get('timer_state', {}); state = perform_turn_switch(state); session['timer_state'] = state
    return jsonify({'status': 'turn switched'})

@app.route('/next_step', methods=['POST'])
def next_step():
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    session['step'] = min(session.get('step', 0) + 1, len(data['names']) - 1); setup_step()
    return jsonify({'status': 'next step'})

@app.route('/previous_step', methods=['POST'])
def previous_step():
    session['step'] = max(session.get('step', 0) - 1, 0); setup_step()
    return jsonify({'status': 'previous step'})

@app.route('/set_step', methods=['POST'])
def set_step():
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    req_data = request.get_json()
    new_step = req_data.get('step')
    if new_step is not None and 0 <= new_step < len(data['names']):
        session['step'] = new_step; setup_step()
        return jsonify({'status': f'step set to {new_step}'})
    return jsonify({'status': 'invalid step'}), 400

@app.route('/adjust_time', methods=['POST'])
def adjust_time():
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    req_data = request.get_json()
    seconds = req_data.get('seconds', 0)
    state = session.get('timer_state', {})
    step_type = data['pc'][session.get('step', 0)]
    if step_type == 2:
        turn = state.get('turn', 'pros'); main_ts_key = f"{turn}_timestamp"; main_ts = state.get(main_ts_key, [])
        runtime_sec = state.get('runtime', 0); current_main_remain = get_remain_time(runtime_sec, main_ts)
        new_main_remain = max(0, current_main_remain + seconds); new_main_elapse = runtime_sec - new_main_remain
        if is_running(main_ts): state[main_ts_key] = [time.time() - new_main_elapse]
        else: state[main_ts_key] = [time.time() - new_main_elapse, time.time()]
        turn_ts = state.get('turn_timestamp', []); turn_runtime_sec = 120
        current_turn_remain = get_remain_time(turn_runtime_sec, turn_ts)
        new_turn_remain = max(0, current_turn_remain + seconds); new_turn_elapse = turn_runtime_sec - new_turn_remain
        if is_running(turn_ts): state['turn_timestamp'] = [time.time() - new_turn_elapse]
        else: state['turn_timestamp'] = [time.time() - new_turn_elapse, time.time()]
    else:
        timestamp = state.get('timestamp', []); runtime_sec = state.get('runtime', 0)
        current_remain = get_remain_time(runtime_sec, timestamp)
        new_remain = max(0, current_remain + seconds); new_elapse = runtime_sec - new_remain
        if is_running(timestamp): state['timestamp'] = [time.time() - new_elapse]
        else: state['timestamp'] = [time.time() - new_elapse, time.time()]
    session['timer_state'] = state
    return jsonify({'status': 'time adjusted'})

@app.route('/status')
def status():
    mode = session.get('mode')
    data = get_current_data()
    if not data: return jsonify({'active': False})
    step = session.get('step', 0); state = session.get('timer_state', {}); step_type = data['pc'][step]
    response = {'active': True, 'mode': mode, 'step': step, 'step_name': data['names'][step], 'timeline': data}
    if step_type == 2:
        turn_ts = state.get('turn_timestamp', []); turn_remain_sec = get_remain_time(120, turn_ts)
        if turn_remain_sec <= 0 and is_running(turn_ts):
            state = perform_turn_switch(state); session['timer_state'] = state
        runtime_sec = state.get('runtime', 0)
        pros_ts = state.get('pros_timestamp', []); cons_ts = state.get('cons_timestamp', [])
        turn = state.get('turn', 'pros'); pros_remain_sec = get_remain_time(runtime_sec, pros_ts); cons_remain_sec = get_remain_time(runtime_sec, cons_ts)
        active_timestamp = state.get(f"{turn}_timestamp", []); is_timer_running = is_running(active_timestamp)
        response.update({'type': 'free_debate', 'turn': turn, 'pros_runtime': runtime_sec, 'cons_runtime': runtime_sec, 'pros_remain_sec': pros_remain_sec, 'cons_remain_sec': cons_remain_sec, 'pros_time_str': formalize(pros_remain_sec), 'cons_time_str': formalize(cons_remain_sec), 'turn_remain_sec': turn_remain_sec, 'turn_time_str': formalize(turn_remain_sec), 'is_running': is_timer_running, 'is_finished': pros_remain_sec == 0 and cons_remain_sec == 0})
    else: 
        runtime_sec = state.get('runtime', 0); timestamp = state.get('timestamp', [])
        remain_sec = get_remain_time(runtime_sec, timestamp)
        response.update({'type': 'sequence', 'remain_sec': remain_sec, 'time_str': formalize(remain_sec), 'runtime': runtime_sec, 'is_running': is_running(timestamp), 'is_finished': remain_sec == 0})
    return jsonify(response)

def setup_step():
    data = get_current_data()
    if not data: return
    step = session.get('step', 0); runtime_sec = data['runtimes'][step] * 60; step_type = data['pc'][step]
    if step_type == 2: session['timer_state'] = {'runtime': runtime_sec, 'pros_timestamp': [], 'cons_timestamp': [], 'turn': 'pros', 'turn_timestamp': []}
    else: session['timer_state'] = { 'runtime': runtime_sec, 'timestamp': [] }

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)