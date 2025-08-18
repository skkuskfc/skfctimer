import time
from flask import Flask, render_template, session, jsonify, request

app = Flask(__name__)
app.secret_key = 'skfc-debate-timer-final-free-debate'

# --- 데이터 ---
CEDA_DATA = {
    'names': ['찬성1 입론', '반대2 교차조사', '반대1 입론', '찬성1 교차조사', '찬성2 입론', '반대1 교차조사', '반대2 입론', '찬성2 교차조사', '자유토론', '반대 마무리발언', '찬성 마무리발언'],
    'runtimes': [4, 3, 4, 3, 4, 3, 4, 3, 8, 2, 2],
    'pc': [0, 1, 1, 0, 0, 1, 1, 0, 2, 1, 0] # 0:찬성, 1:반대, 2:자유토론
}

# --- 헬퍼 함수 ---
def formalize(sec):
    sec = int(sec)
    return f"{sec//60:02d}:{sec%60:02d}"

def get_remain_time(runtime, timestamp):
    elapse = 0
    for i in range(0, len(timestamp) - 1, 2):
        elapse += timestamp[i+1] - timestamp[i]
    if len(timestamp) % 2 == 1:
        elapse += time.time() - timestamp[-1]
    return max(0, runtime - elapse)

def is_running(timestamp): return len(timestamp) % 2 == 1

# --- Flask 라우트 ---
@app.route('/')
def index():
    session.clear()
    return render_template('index.html')

@app.route('/start_timer', methods=['POST'])
def start_timer():
    session['mode'] = 'ceda'
    session['step'] = 0
    setup_step()
    return jsonify({'status': 'CEDA timer initialized'})

@app.route('/toggle_timer', methods=['POST'])
def toggle_timer():
    state = session.get('timer_state', {})
    step_type = CEDA_DATA['pc'][session.get('step', 0)]
    
    if step_type == 2: # 자유토론
        turn = state.get('turn', 'pros')
        ts_key = f"{turn}_timestamp"
        timestamp = state.get(ts_key, [])
        if is_running(timestamp): timestamp.append(time.time())
        else: timestamp.append(time.time())
        state[ts_key] = timestamp
        
        turn_ts = state.get('turn_timestamp', [])
        if is_running(turn_ts): turn_ts.append(time.time())
        else:
            if get_remain_time(120, turn_ts) > 0:
                turn_ts.append(time.time())
        state['turn_timestamp'] = turn_ts

    else: # 일반
        timestamp = state.get('timestamp', [])
        if is_running(timestamp): timestamp.append(time.time())
        else: timestamp.append(time.time())
        state['timestamp'] = timestamp
        
    session['timer_state'] = state
    return jsonify({'status': 'toggled'})

@app.route('/switch_turn', methods=['POST'])
def switch_turn():
    state = session.get('timer_state', {})
    step_type = CEDA_DATA['pc'][session.get('step', 0)]
    if step_type != 2: return jsonify({'status': 'not in free debate mode'}), 400

    current_turn = state.get('turn', 'pros')
    next_turn = 'cons' if current_turn == 'pros' else 'pros'
    
    current_ts_key = f"{current_turn}_timestamp"
    current_ts = state.get(current_ts_key, [])
    if is_running(current_ts): current_ts.append(time.time())
    state[current_ts_key] = current_ts

    next_ts_key = f"{next_turn}_timestamp"
    next_ts = state.get(next_ts_key, [])
    if not is_running(next_ts) and get_remain_time(state.get('runtime', 0), next_ts) > 0:
        next_ts.append(time.time())
    state[next_ts_key] = next_ts
    
    state['turn'] = next_turn
    state['turn_timestamp'] = [time.time()]
    session['timer_state'] = state
    return jsonify({'status': 'turn switched'})

@app.route('/next_step', methods=['POST'])
def next_step():
    session['step'] = min(session.get('step', 0) + 1, len(CEDA_DATA['names']) - 1)
    setup_step()
    return jsonify({'status': 'next step'})

@app.route('/previous_step', methods=['POST'])
def previous_step():
    session['step'] = max(session.get('step', 0) - 1, 0)
    setup_step()
    return jsonify({'status': 'previous step'})

@app.route('/set_step', methods=['POST'])
def set_step():
    data = request.get_json()
    new_step = data.get('step')
    if new_step is not None and 0 <= new_step < len(CEDA_DATA['names']):
        session['step'] = new_step
        setup_step()
        return jsonify({'status': f'step set to {new_step}'})
    return jsonify({'status': 'invalid step'}), 400
    
@app.route('/adjust_time', methods=['POST'])
def adjust_time():
    data = request.get_json()
    seconds = data.get('seconds', 0)
    state = session.get('timer_state', {})
    step_type = CEDA_DATA['pc'][session.get('step', 0)]

    ts_key_to_adjust = 'timestamp'
    if step_type == 2:
        turn = state.get('turn', 'pros')
        ts_key_to_adjust = f"{turn}_timestamp"
    
    timestamp = state.get(ts_key_to_adjust, [])
    if is_running(timestamp):
        timestamp[len(timestamp)-1] += seconds
    elif len(timestamp) > 0 :
        timestamp[0] -= seconds
    else: 
        timestamp.append(time.time() - seconds)
        timestamp.append(time.time())

    state[ts_key_to_adjust] = timestamp
    session['timer_state'] = state
    return jsonify({'status': 'time adjusted'})

@app.route('/status')
def status():
    if session.get('mode') != 'ceda': return jsonify({'active': False})
    
    step = session.get('step', 0)
    state = session.get('timer_state', {})
    step_type = CEDA_DATA['pc'][step]
    
    response = {'active': True, 'step': step, 'step_name': CEDA_DATA['names'][step], 'timeline': CEDA_DATA}
    
    if step_type == 2: 
        runtime = state.get('runtime', 0)
        pros_ts = state.get('pros_timestamp', [])
        cons_ts = state.get('cons_timestamp', [])
        turn_ts = state.get('turn_timestamp', [])

        pros_remain = get_remain_time(runtime, pros_ts)
        cons_remain = get_remain_time(runtime, cons_ts)
        turn_remain = get_remain_time(120, turn_ts)
        turn = state.get('turn', 'pros')
        
        active_timestamp = state.get(f"{turn}_timestamp", [])
        is_timer_running = is_running(active_timestamp)

        response.update({
            'type': 'free_debate', 'turn': turn,
            'pros_runtime': runtime, 'cons_runtime': runtime,
            'pros_remain_sec': pros_remain, 'cons_remain_sec': cons_remain,
            'pros_time_str': formalize(pros_remain), 'cons_time_str': formalize(cons_remain),
            'turn_remain_sec': turn_remain, # [추가된 부분]
            'turn_time_str': formalize(turn_remain),
            'is_running': is_timer_running,
            'is_finished': pros_remain == 0 and cons_remain == 0
        })
    else: 
        runtime = state.get('runtime', 0)
        timestamp = state.get('timestamp', [])
        remain_sec = get_remain_time(runtime, timestamp)
        response.update({
            'type': 'sequence', 'remain_sec': remain_sec,
            'time_str': formalize(remain_sec), 'runtime': runtime,
            'is_running': is_running(timestamp),
            'is_finished': remain_sec == 0
        })
        
    return jsonify(response)

def setup_step():
    step = session.get('step', 0)
    runtime_sec = CEDA_DATA['runtimes'][step] * 60
    step_type = CEDA_DATA['pc'][step]

    if step_type == 2:
        session['timer_state'] = {
            'runtime': runtime_sec,
            'pros_timestamp': [], 'cons_timestamp': [],
            'turn': 'pros', 'turn_timestamp': []
        }
    else:
        session['timer_state'] = { 'runtime': runtime_sec, 'timestamp': [] }

if __name__ == '__main__':
    app.run(debug=True, port=5001)