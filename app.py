#9월 21일 수정
import time
import io
import qrcode
import json
import os
from datetime import datetime, timezone, timedelta
from functools import wraps
from flask import Flask, render_template, session, jsonify, request, url_for, send_file, redirect, flash
from werkzeug.security import generate_password_hash, check_password_hash
from openpyxl import Workbook
from filelock import FileLock # 파일 잠금을 위한 라이브러리 추가

app = Flask(__name__)
app.secret_key = 'skfc-login-and-all-features'

# --- 데이터 파일 경로 정의 ---
DISK_PATH = '/var/data'
if not os.path.exists(DISK_PATH):
    os.makedirs(DISK_PATH)

USED_TOKENS = set()
ATTENDANCE_FILE = os.path.join(DISK_PATH, 'attendance_log.json')
# 잠금 파일을 위한 경로 추가
ATTENDANCE_FILE_LOCK = os.path.join(DISK_PATH, 'attendance_log.json.lock')
USERS_FILE = os.path.join(DISK_PATH, 'users.json')
COHORTS_FILE = os.path.join(DISK_PATH, 'cohorts.json')
ROSTER_FILE = os.path.join(DISK_PATH, 'roster.json')
PERMISSIONS_FILE = os.path.join(DISK_PATH, 'permissions.json')

KST = timezone(timedelta(hours=9))

# 전체 기능 목록 정의
FEATURES = {
    'attendance': '출석 관리', 'history': '출석 기록', 'member-roster': '부원 명단 관리',
    'ceda-timer': '복합 CEDA 타이머', 'free-timer': '자유토론 타이머', 'general-timer': '일반 타이머',
    'access-management': '웹 권한 관리'
}

# --- 타이머 데이터 ---
CEDA_DATA = {
    'names': ['찬성1 입론', '반대2 교차조사', '반대1 입론', '찬성1 교차조사', '찬성2 입론', '반대1 교차조사', '반대2 입론', '찬성2 교차조사', '자유토론', '반대 마무리발언', '찬성 마무리발언'],
    'runtimes': [4, 3, 4, 3, 4, 3, 4, 3, 8, 2, 2],
    'pc': [0, 1, 1, 0, 0, 1, 1, 0, 2, 1, 0],
    # 0: 사용불가, 1: 찬성팀, 2: 반대팀
    'deliberation_chance': [0, 2, 0, 1, 0, 2, 0, 1, 2, 2, 1] 
}
FREE_DEBATE_DATA = { 'names': ['찬성 기조발언', '반대 기조발언', '자유토론', '반대 마무리 발언', '찬성 마무리 발언'], 'runtimes': [1, 1, 11, 1, 1], 'pc': [0, 1, 2, 1, 0] }
GENERAL_TIMER_DATA = { 'names': [f'{i}분 타이머' for i in range(1, 11)] + ['직접 입력'], 'runtimes': [i for i in range(1, 11)] + [0], 'pc': [0] * 11 }

# --- 파일 관리 함수 ---
def load_json_file(filename, default_data={}):
    try:
        if not os.path.exists(filename) or os.path.getsize(filename) == 0:
            return default_data
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default_data

def save_json_file(data, filename):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

# --- 헬퍼 함수 및 데코레이터 ---
def get_current_cohort():
    cohorts = load_json_file(COHORTS_FILE)
    today = datetime.now().date()
    for cohort_id, info in cohorts.items():
        try:
            start_date = datetime.strptime(info['start_date'], '%Y-%m-%d').date()
            end_date = datetime.strptime(info['end_date'], '%Y-%m-%d').date()
            if start_date <= today <= end_date:
                return cohort_id
        except (ValueError, KeyError):
            continue
    return None

def permission_required(feature):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            permissions = session.get('permissions', [])
            if feature not in permissions:
                return jsonify({'error': '접근 권한이 없습니다.'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def check_current_timer_permission():
    mode = session.get('mode')
    if not mode: return False
    required_permission = {'ceda': 'ceda-timer', 'free_debate': 'free-timer', 'general': 'general-timer'}.get(mode)
    return required_permission and required_permission in session.get('permissions', [])

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

# 로그인/회원가입/메인
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user_id = request.form['user_id']
        password = request.form['password']
        users = load_json_file(USERS_FILE)
        user_data = users.get(user_id)
        if user_data and check_password_hash(user_data['password_hash'], password):
            session.clear()
            session['user_id'] = user_id
            session['user_name'] = user_data['name']
            member_type = user_data.get('member_type', '정보 없음')
            session['member_type'] = member_type

            permissions_data = load_json_file(PERMISSIONS_FILE, default_data={})
            if member_type == '회장':
                session['permissions'] = list(FEATURES.keys())
            else:
                session['permissions'] = permissions_data.get(member_type, [])
            
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

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    accessible_pages = {key: FEATURES[key] for key in session.get('permissions', []) if key in FEATURES}
    return render_template('index.html', accessible_pages=accessible_pages)

# --- 출석 관리 로직 ---
@app.route('/start_attendance', methods=['POST'])
@permission_required('attendance')
def start_attendance():
    global USED_TOKENS; USED_TOKENS.clear()
    return jsonify({'status': 'attendance started'})

@app.route('/qrcode')
def qr_code():
    if 'attendance' not in session.get('permissions', []):
        return "접근 권한이 없습니다.", 403
    token = int(time.time() / 10)
    url = url_for('check_in_page', token=token, _external=True)
    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=10, border=4)
    qr.add_data(url); qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO(); img.save(buf); buf.seek(0)
    return send_file(buf, mimetype='image/png')

@app.route('/check_in')
def check_in_page():
    global USED_TOKENS
    received_token_str = request.args.get('token')
    if not received_token_str or not received_token_str.isdigit():
        return "<h1>유효하지 않은 접근입니다.</h1>", 400
    received_token = int(received_token_str)
    current_token = int(time.time() / 10)
    if not (current_token == received_token or current_token - 1 == received_token):
        return "<h1>만료된 QR코드입니다. 새로고침된 QR코드를 이용해주세요.</h1>", 400
    if received_token in USED_TOKENS:
        return "<h1>이미 사용된 QR코드입니다.</h1>", 400
    session['attendance_token'] = received_token
    return render_template('check_in.html')

@app.route('/submit_name', methods=['POST'])
def submit_name():
    global USED_TOKENS
    token = session.get('attendance_token')
    if token is None: return "<h1>잘못된 접근입니다. QR코드를 통해 다시 시도해주세요.</h1>", 400
    if token in USED_TOKENS: return "<h1>이미 출석체크를 완료했습니다. 이 창을 닫아주세요.</h1>", 400

    name = request.form.get('name', '').strip()
    member_type = request.form.get('member_type', '기타')
    check_in_time = datetime.now(KST)

    if name and member_type:
        lock = FileLock(ATTENDANCE_FILE_LOCK, timeout=5) # 잠금 객체 생성, 5초간 대기
        try:
            with lock: # 파일 잠금 시작
                today_str = check_in_time.strftime('%Y-%m-%d')
                log = load_json_file(ATTENDANCE_FILE)
                
                today_log_entry = log.get(today_str)
                if isinstance(today_log_entry, list):
                    attendees, settings = today_log_entry, {'cutoff_time': '18:00'}
                elif isinstance(today_log_entry, dict):
                    attendees, settings = today_log_entry.get('attendees', []), today_log_entry.get('settings', {'cutoff_time': '18:00'})
                else:
                    attendees, settings = [], {'cutoff_time': '18:00'}

                cutoff_time_str = settings.get('cutoff_time', '18:00')
                
                naive_cutoff = datetime.strptime(f"{today_str} {cutoff_time_str}", '%Y-%m-%d %H:%M')
                effective_cutoff = naive_cutoff + timedelta(seconds=59)
                cutoff_datetime = effective_cutoff.replace(tzinfo=KST)

                status = '출석' if check_in_time <= cutoff_datetime else '지각'
                timestamp_str = check_in_time.strftime('%H:%M:%S')

                member_found = False
                for member in attendees:
                    if member['name'] == name:
                        member['status'] = status
                        member['timestamp'] = timestamp_str
                        member_found = True
                        break
                
                if not member_found:
                    attendees.append({'name': name, 'type': member_type, 'status': status, 'timestamp': timestamp_str})
                
                log[today_str] = {'settings': settings, 'attendees': attendees}
                save_json_file(log, ATTENDANCE_FILE)
                # 파일 잠금이 해제되기 전에 모든 작업을 완료
        
        except TimeoutError:
             return "<h1>서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요.</h1>", 503

        USED_TOKENS.add(token)
        session.pop('attendance_token', None)
        return "<h1>출석이 완료되었습니다.</h1><p>이 창을 닫아주세요.</p>"
    
    return "<h1>이름과 부원 구분을 모두 선택해주세요.</h1>", 400

@app.route('/api/todays_attendance')
@permission_required('attendance')
def get_todays_attendance():
    today_str = datetime.now(KST).strftime('%Y-%m-%d')
    log = load_json_file(ATTENDANCE_FILE)
    today_log_entry = log.get(today_str)
    if isinstance(today_log_entry, list):
        attendees, settings = today_log_entry, {'cutoff_time': '18:00'}
    elif isinstance(today_log_entry, dict):
        attendees, settings = today_log_entry.get('attendees', []), today_log_entry.get('settings', {'cutoff_time': '18:00'})
    else:
        attendees, settings = [], {'cutoff_time': '18:00'}
    return jsonify({'attendees': attendees, 'settings': settings})

@app.route('/api/initialize_attendance_with_roster', methods=['POST'])
@permission_required('attendance')
def initialize_attendance_with_roster():
    current_cohort_id = get_current_cohort()
    if not current_cohort_id:
        return jsonify({'error': '현재 활동 중인 기수 정보가 없습니다.'}), 404
    
    rosters = load_json_file(ROSTER_FILE)
    roster_list = rosters.get(current_cohort_id, [])
    
    if not roster_list:
        return jsonify({'error': f'{current_cohort_id} 명단이 비어있습니다.'}), 404

    initial_attendance = [{'name': m.get('name'), 'type': m.get('activity_type'), 'status': '결석', 'timestamp': ''} for m in roster_list]
    today_str = datetime.now(KST).strftime('%Y-%m-%d')
    log = load_json_file(ATTENDANCE_FILE)
    
    today_log_entry = log.get(today_str)
    if isinstance(today_log_entry, dict):
        existing_settings = today_log_entry.get('settings', {'cutoff_time': '18:00'})
    else:
        existing_settings = {'cutoff_time': '18:00'}
    
    log[today_str] = {'attendees': initial_attendance, 'settings': existing_settings}
    save_json_file(log, ATTENDANCE_FILE)
    return jsonify({'attendees': initial_attendance, 'settings': existing_settings})

@app.route('/api/set_cutoff_time', methods=['POST'])
@permission_required('attendance')
def set_cutoff_time():
    data = request.json
    date_str, cutoff_time = data.get('date'), data.get('cutoff_time')
    if not date_str or not cutoff_time: return jsonify({'error': 'Date and cutoff time are required'}), 400
    log = load_json_file(ATTENDANCE_FILE)
    if date_str not in log or isinstance(log.get(date_str), list):
        log[date_str] = {'settings': {}, 'attendees': []}
    log[date_str]['settings'] = {'cutoff_time': cutoff_time}
    save_json_file(log, ATTENDANCE_FILE)
    return jsonify({'status': 'success'})

@app.route('/api/update_attendance_status', methods=['POST'])
@permission_required('history')
def update_attendance_status():
    data = request.json
    date_str, name, new_status = data.get('date'), data.get('name'), data.get('status')
    if not all([date_str, name, new_status]): return jsonify({'error': '필수 정보가 누락되었습니다.'}), 400
    log = load_json_file(ATTENDANCE_FILE)
    date_log_entry = log.get(date_str)
    if not date_log_entry: return jsonify({'error': '해당 날짜를 찾을 수 없습니다.'}), 404

    attendees, settings = (date_log_entry, {}) if isinstance(date_log_entry, list) else (date_log_entry.get('attendees', []), date_log_entry.get('settings', {}))
    
    member_found = False
    for attendee in attendees:
        if attendee['name'] == name:
            attendee['status'] = new_status
            if new_status == '결석': attendee['timestamp'] = ''
            member_found = True
            break
    
    if member_found:
        log[date_str] = {'settings': settings, 'attendees': attendees}
        save_json_file(log, ATTENDANCE_FILE)
        return jsonify({'status': 'success'})
    return jsonify({'error': '해당 참석자를 찾을 수 없습니다.'}), 404

@app.route('/get_history_by_date')
@permission_required('history')
def get_history_by_date():
    date_str = request.args.get('date')
    if not date_str: return jsonify({'error': 'Date parameter is required'}), 400
    log = load_json_file(ATTENDANCE_FILE)
    date_log_entry = log.get(date_str)
    attendees = date_log_entry if isinstance(date_log_entry, list) else (date_log_entry.get('attendees', []) if isinstance(date_log_entry, dict) else [])
    for attendee in attendees:
        attendee.setdefault('status', '출석')
        attendee.setdefault('timestamp', '')
    return jsonify({'attendees': attendees})

@app.route('/reset_attendance_by_date', methods=['POST'])
@permission_required('history')
def reset_attendance_by_date():
    date_str = request.json.get('date')
    if not date_str: return jsonify({'error': 'Date parameter is required'}), 400
    log = load_json_file(ATTENDANCE_FILE)
    if date_str in log:
        del log[date_str]
        save_json_file(log, ATTENDANCE_FILE)
    return jsonify({'status': f'{date_str} attendance reset'})

@app.route('/export_excel')
@permission_required('history')
def export_excel():
    date_str = request.args.get('date')
    if not date_str: return "Date not provided", 400
    current_cohort = get_current_cohort()
    cohort_str = f"{current_cohort}" if current_cohort else "알수없음"
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        filename = f"{cohort_str}_{date_obj.strftime('%m월_%d일')}_출석부.xlsx"
    except ValueError:
        filename = f"attendance_{date_str}.xlsx"
    log = load_json_file(ATTENDANCE_FILE)
    date_log_entry = log.get(date_str)
    attendees = date_log_entry if isinstance(date_log_entry, list) else (date_log_entry.get('attendees', []) if isinstance(date_log_entry, dict) else [])
    wb = Workbook(); ws = wb.active; ws.title = date_str
    ws.append(['이름', '부원 구분', '출석 상태', '출석 시간'])
    present_count = 0; late_count = 0
    for attendee in attendees:
        status = attendee.get('status', '출석')
        if status == '출석': present_count += 1
        elif status == '지각': late_count +=1
        ws.append([attendee.get('name', ''), attendee.get('type', ''), status, attendee.get('timestamp', '')])
    ws.append([])
    total_attended = present_count + late_count
    ws.append([f"총원: {len(attendees)}명"])
    ws.append([f"참석: {total_attended}명 (출석: {present_count}명, 지각: {late_count}명)"])
    excel_buffer = io.BytesIO(); wb.save(excel_buffer); excel_buffer.seek(0)
    return send_file(excel_buffer, as_attachment=True, download_name=filename, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@app.route('/api/cohorts', methods=['GET', 'POST'])
@permission_required('member-roster')
def manage_cohorts():
    if request.method == 'GET':
        return jsonify(load_json_file(COHORTS_FILE))
    data = request.json
    cohort_id = data.get('cohort_id')
    if not cohort_id: return jsonify({'error': '기수 정보가 필요합니다.'}), 400
    cohorts = load_json_file(COHORTS_FILE)
    cohorts[cohort_id] = {'start_date': data.get('start_date'), 'end_date': data.get('end_date'), 'president': data.get('president')}
    save_json_file(cohorts, COHORTS_FILE)
    return jsonify({'status': 'success', 'cohort': cohorts[cohort_id]})

@app.route('/api/roster/<cohort_id>', methods=['GET', 'POST'])
@permission_required('member-roster')
def manage_roster(cohort_id):
    rosters = load_json_file(ROSTER_FILE)
    if request.method == 'GET':
        return jsonify(rosters.get(cohort_id, []))
    rosters[cohort_id] = request.json.get('roster', [])
    save_json_file(rosters, ROSTER_FILE)
    return jsonify({'status': 'success'})

# --- 웹 권한 관리 API ---
@app.route('/api/access_data')
@permission_required('access-management')
def get_access_data():
    users = load_json_file(USERS_FILE)
    member_types = sorted(list(set(u.get('member_type') for u in users.values() if u.get('member_type') and u.get('member_type') != '회장')))
    editable_features = {k: v for k, v in FEATURES.items() if k != 'access-management'}
    permissions = load_json_file(PERMISSIONS_FILE, default_data={})
    return jsonify({'member_types': member_types, 'features': editable_features, 'permissions': permissions})

@app.route('/api/permissions', methods=['POST'])
@permission_required('access-management')
def save_permissions():
    new_permissions = request.json
    save_json_file(new_permissions, PERMISSIONS_FILE)
    return jsonify({'status': 'success'})

@app.route('/api/users')
@permission_required('access-management')
def get_users():
    users = load_json_file(USERS_FILE)
    user_list = [{'id': uid, 'name': u.get('name'), 'cohort': u.get('cohort'), 'member_type': u.get('member_type')} for uid, u in users.items()]
    return jsonify(user_list)

@app.route('/api/delete_user', methods=['POST'])
@permission_required('access-management')
def delete_user():
    user_id_to_delete = request.json.get('user_id')
    if not user_id_to_delete: return jsonify({'error': 'User ID is required'}), 400
    users = load_json_file(USERS_FILE)
    if user_id_to_delete in users:
        if users[user_id_to_delete].get('member_type') == '회장':
            return jsonify({'error': '회장 계정은 삭제할 수 없습니다.'}), 403
        del users[user_id_to_delete]
        save_json_file(users, USERS_FILE)
        return jsonify({'status': 'success'})
    return jsonify({'error': 'User not found'}), 404

# --- 타이머 라우트 ---
@app.route('/start_ceda_timer', methods=['POST'])
@permission_required('ceda-timer')
def start_ceda_timer():
    session['mode'] = 'ceda'
    session['step'] = 0
    # 팀별 숙의시간 120초(2분)로 초기화
    session['deliberation_remain'] = {'pros': 120, 'cons': 120} 
    session['is_in_deliberation'] = False
    setup_step()
    return jsonify({'status': 'CEDA timer initialized'})

@app.route('/start_free_timer', methods=['POST'])
@permission_required('free-timer')
def start_free_timer():
    session['mode'] = 'free_debate'; session['step'] = 0; setup_step()
    return jsonify({'status': 'Free debate timer initialized'})

@app.route('/start_general_timer', methods=['POST'])
@permission_required('general-timer')
def start_general_timer():
    session['mode'] = 'general'; session['step'] = 0; setup_step()
    return jsonify({'status': 'General timer initialized'})

@app.route('/set_custom_time', methods=['POST'])
@permission_required('general-timer')
def set_custom_time():
    req_data = request.get_json()
    minutes, seconds = int(req_data.get('minutes', 0)), int(req_data.get('seconds', 0))
    session['step'] = len(GENERAL_TIMER_DATA['names']) - 1
    session['timer_state'] = { 'runtime': minutes * 60 + seconds, 'timestamp': [] }
    return jsonify({'status': 'custom time set'})

@app.route('/toggle_timer', methods=['POST'])
def toggle_timer():
    if not check_current_timer_permission(): return jsonify({'error': '접근 권한이 없습니다.'}), 403
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    state = session.get('timer_state', {}); step = session.get('step', 0); step_type = data['pc'][step]
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
    if not check_current_timer_permission(): return jsonify({'error': '접근 권한이 없습니다.'}), 403
    state = session.get('timer_state', {}); state = perform_turn_switch(state); session['timer_state'] = state
    return jsonify({'status': 'turn switched'})

@app.route('/next_step', methods=['POST'])
def next_step():
    if not check_current_timer_permission(): return jsonify({'error': '접근 권한이 없습니다.'}), 403
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    session['step'] = min(session.get('step', 0) + 1, len(data['names']) - 1); setup_step()
    return jsonify({'status': 'next step'})

@app.route('/previous_step', methods=['POST'])
def previous_step():
    if not check_current_timer_permission(): return jsonify({'error': '접근 권한이 없습니다.'}), 403
    session['step'] = max(session.get('step', 0) - 1, 0); setup_step()
    return jsonify({'status': 'previous step'})

@app.route('/set_step', methods=['POST'])
def set_step():
    if not check_current_timer_permission(): return jsonify({'error': '접근 권한이 없습니다.'}), 403
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    new_step = request.get_json().get('step')
    if new_step is not None and 0 <= new_step < len(data['names']):
        session['step'] = new_step; setup_step()
        return jsonify({'status': f'step set to {new_step}'})
    return jsonify({'status': 'invalid step'}), 400

@app.route('/adjust_time', methods=['POST'])
def adjust_time():
    if not check_current_timer_permission(): return jsonify({'error': '접근 권한이 없습니다.'}), 403
    data = get_current_data()
    if not data: return jsonify({'status': 'error'}), 400
    seconds = request.get_json().get('seconds', 0)
    state = session.get('timer_state', {}); step_type = data['pc'][session.get('step', 0)]
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

@app.route('/use_deliberation_time', methods=['POST'])
@permission_required('ceda-timer')
def use_deliberation_time():
    data = request.get_json()
    seconds_to_use = int(data.get('seconds', 0))
    team = data.get('team') # 'pros' 또는 'cons'
    
    if team not in ['pros', 'cons'] or seconds_to_use not in [60, 120]:
        return jsonify({'error': '잘못된 요청입니다.'}), 400
    
    deliberation_remain = session.get('deliberation_remain', {'pros': 0, 'cons': 0})
    if seconds_to_use > deliberation_remain.get(team, 0):
        return jsonify({'error': '숙의 시간이 부족합니다.'}), 400
    
    deliberation_remain[team] -= seconds_to_use
    session['deliberation_remain'] = deliberation_remain
    
    # 숙의 시간 타이머 상태 설정
    session['is_in_deliberation'] = True
    session['deliberation_state'] = {
        'team': team,
        'runtime': seconds_to_use,
        'timestamp': [time.time()] # 시작과 동시에 run
    }
    return jsonify({'status': 'success', 'remaining': session['deliberation_remain']})

@app.route('/status')
def status():
    if not check_current_timer_permission(): return jsonify({'active': False, 'error': '접근 권한이 없습니다.'}), 403
    
    mode = session.get('mode')
    data = get_current_data()
    if not data: return jsonify({'active': False})
    
    step = session.get('step', 0)
    state = session.get('timer_state', {})
    
    # 숙의 시간 모드인지 확인
    if session.get('is_in_deliberation'):
        delib_state = session.get('deliberation_state', {})
        delib_remain_sec = get_remain_time(delib_state.get('runtime', 0), delib_state.get('timestamp', []))
        
        if delib_remain_sec <= 0:
            session['is_in_deliberation'] = False # 숙의 시간 종료
        else:
            team_name = "찬성" if delib_state.get('team') == 'pros' else "반대"
            return jsonify({
                'active': True, 'mode': mode, 'step': step, 'timeline': data,
                'is_in_deliberation': True,
                'step_name': f'{team_name}',
                'deliberation_time_str': formalize(delib_remain_sec),
                'is_running': is_running(delib_state.get('timestamp', []))
            })

    step_type = data['pc'][step]
    response = {'active': True, 'mode': mode, 'step': step, 'step_name': data['names'][step], 'timeline': data, 'is_in_deliberation': False}

    # 현재 단계에서 숙의 시간 사용 가능한지 확인
    if mode == 'ceda':
        main_runtime = state.get('runtime', 0)
        main_remain = get_remain_time(main_runtime, state.get('timestamp', []))
        
        chance_code = data['deliberation_chance'][step]
        # 타이머가 시작되지 않았고, 숙의시간 사용 가능한 단계일 때
        if main_runtime > 0 and main_remain == main_runtime and chance_code != 0:
            response['show_deliberation_controls'] = True
            response['deliberation_chance_for'] = 'pros' if chance_code == 1 else 'cons'
            response['deliberation_remain'] = session.get('deliberation_remain', {'pros': 0, 'cons': 0})
    return jsonify(response)

def setup_step():
    data = get_current_data()
    if not data: return
    step = session.get('step', 0); runtime_sec = data['runtimes'][step] * 60; step_type = data['pc'][step]
    if step_type == 2: session['timer_state'] = {'runtime': runtime_sec, 'pros_timestamp': [], 'cons_timestamp': [], 'turn': 'pros', 'turn_timestamp': []}
    else: session['timer_state'] = { 'runtime': runtime_sec, 'timestamp': [] }

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
