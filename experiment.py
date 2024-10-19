import gevent
from gevent import monkey
monkey.patch_all() 

import logging
import os, sqlite3, simplejson, json, random, time

from flask import Flask, request, session, g, redirect, url_for, abort, render_template, flash, jsonify
from markupsafe import escape
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import Integer, String, func
from flask_socketio import SocketIO, send, emit, join_room
from dataclasses import dataclass
from apscheduler.schedulers.background import BackgroundScheduler


##################################################################
### parameters
##################################################################


# n_rounds = {'train':15, 'test':10}
n_rounds = {'train':2, 'test':2}
timeout = 240


##################################################################
### configure flask
##################################################################


app = Flask(__name__)
app.secret_key = "super secret key"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///project.db"
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins="*", message_queue='redis://localhost:6379')

if __name__ != '__main__':
    gunicorn_logger = logging.getLogger('gunicorn.error')
    app.logger.handlers = gunicorn_logger.handlers
    app.logger.setLevel(gunicorn_logger.level)
else:
    logging.basicConfig(level=logging.DEBUG)

if __name__ == '__main__':
    # socketio.run(app, debug=True)
    socketio.run(app, host="0.0.0.0", port=5000)

logging.basicConfig(level=logging.INFO)


##################################################################
### configure database
##################################################################


class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)

db.init_app(app)


@dataclass
class User(db.Model):
    i: Mapped[int] = mapped_column(primary_key=True)
    user: Mapped[str] = mapped_column(unique=True)
    status: Mapped[str]
    pair: Mapped[int] = mapped_column(nullable=True)
    role: Mapped[str] = mapped_column(nullable=True)
    partner: Mapped[str] = mapped_column(nullable=True)
    partner_train: Mapped[str] = mapped_column(nullable=True)
    partner_test: Mapped[str] = mapped_column(nullable=True)
    task: Mapped[int]
    assignment: Mapped[str]
    time: Mapped[float] = mapped_column(nullable=True)


@dataclass
class Game(db.Model):
    i: Mapped[int] = mapped_column(primary_key=True)
    pair: Mapped[int] 
    task: Mapped[int] 
    n: Mapped[int] 
    turn: Mapped[int] 
    start_s: Mapped[str] 
    start_r: Mapped[str] 
    targets: Mapped[str] 
    move_1: Mapped[str] = mapped_column(nullable=True)
    move_2: Mapped[str] = mapped_column(nullable=True)
    move_3: Mapped[str] = mapped_column(nullable=True)


if not os.path.isfile('./instance/project.db'):
    with app.app_context():
        db.create_all()


##################################################################
### functions
##################################################################


def create_game(pair_num, task, n):
    app.logger.info(f'creating game; pair:{pair_num} task:{task} n:{n}')

    if task == 'train':
        start_s = random_images(9,9)
        start_r = random_images(9,9)
        targets = random_images(3,9)
    elif task == 'test':
        start_s = random_images(12,12)
        start_r = random_images(12,12)
        # targets = random_images(1,12)
        # hard code targets: 7 previously-seen and 3 new
        test_sequence = [0,1,2,3,4,5,6,9,10,11]
        targets = json.dumps({'0':str(test_sequence[n])})
    game = Game(
        pair = pair_num,
        task = task,
        n = n,
        turn = 0,
        start_s = start_s,
        start_r = start_r,
        targets = targets
    )
    db.session.add(game)
    db.session.commit()
    return


##################### NEED TO UPDATE FOR WHEN TASK IS TEST: USERS KEEP ROLES


def create_pair(user_1,user_2,task):
    pair_users = [user_1,user_2]
    random.shuffle(pair_users)
    pair_num = db.session.query(func.max(User.pair)).scalar()
    if pair_num:
        pair_num += 1
    else:
        pair_num = 1
    for i in [0, 1]:
        user = pair_users[i]
        user.pair = pair_num
        if i == 0:
            user.role = 'sender'
            user.partner = pair_users[i+1].user
        else:
            user.role = 'receiver'
            user.partner = pair_users[i-1].user
        user.status = 'playing'
        app.logger.info('paired user: ' + user.user)
        if task=='train':
            user.partner_train = user.partner
        elif task=='test':
            user.partner_test = user.partner
    db.session.commit()
    time.sleep(.25)
    create_game(pair_num, task, 0)
    for i in [0, 1]:
        app.logger.info(f'refreshing user: {pair_users[i].user}')
        socketio.emit('refresh', room=pair_users[i].user)
    return


def process_user(username, task, assignment):
    user = db.session.query(User).filter(User.user==username).first()
    if user is None:
        user = User(
            user = username,
            status = 'waiting',
            role = None,
            pair = None,
            partner = None,
            partner_train = None,
            partner_test = None,
            task = task,
            assignment = assignment,
            time = time.time()
        )
        db.session.add(user)
    else:
        user.task = task
        if user.time == None:
            user.time = time.time()
        game = db.session.query(Game).filter(Game.pair==user.pair,Game.task==user.task).order_by(Game.i.desc()).first()
        if game is not None:
            if game.n + 1 < n_rounds[user.task]:
                user.status=='playing'
                emit('refresh', to=user.user)
            else:
                app.logger.info(f'Issuing (done) for user: {user.user} and partner: {user.partner}')
                user.status = 'waiting'
                user.time = None
                emit('done', {'type':'complete'}, to=user.user)
        else:
            user.status = 'waiting'
    db.session.commit()


def process_waiting():
    while True:
        with app.app_context(), app.test_request_context():
            users = db.session.query(User).filter(User.status=='waiting').all()
            
            # pair train users for each assignment type
            for assignment_type in ['same','different']:
                user_list = [user for user in users if user.task=='train' and user.assignment==assignment_type]
                if len(user_list) >= 2:
                    for i in range(0, len(user_list) - 1, 2):
                        create_pair(user_list[i], user_list[i + 1], 'train')


            # pair test users for the "same" assignment type 
            user_list = [user for user in users if user.task=='test' and user.assignment=='same']
            paired_users = set()
            user_dict = {user.user: user for user in user_list}
            for user_0 in user_list:
                if user_0.user in paired_users:
                    continue
                partner_name = user_0.partner_train
                if partner_name in user_dict and partner_name not in paired_users:
                    user_1 = user_dict[partner_name] 
                    create_pair(user_0, user_1, 'test')
                    paired_users.add(user_0.user)
                    paired_users.add(user_1.user)


            # pair test users for the "different" assignment type
            user_list = [user for user in users if user.task=='test' and user.assignment=='different']
            paired_users = set()
            user_dict = {user.user: user for user in user_list}
            for user_0 in user_list:
                if user_0.user in paired_users:
                    continue
                partner_train_user = user_dict.get(user_0.partner_train)
                available_matches = [
                    user for user in user_list
                    if user != user_0 and user != partner_train_user and user.user not in paired_users
                ]
                if available_matches:
                    user_1 = available_matches[0]
                    create_pair(user_0, user_1, 'test')
                    paired_users.add(user_0.user)
                    paired_users.add(user_1.user)


            for user in users:
                if user.time:
                    if time.time() - user.time > timeout:
                        user.status = 'timeout'
                        user.time = None
                        app.logger.info(f'timeout for user: {user.user}, task: {user.task}, assignment: {user.assignment}')
                        socketio.emit('done', {'type':'timeout'}, to=user.user)
                        db.session.commit()
                        time.sleep(.1)
        time.sleep(2)


def random_images(n,m): 
    index = [str(i) for i in range(0, m)]
    images = [str(i) for i in range(0, m)]
    images = random.sample(images, n)
    return json.dumps(dict(zip(index,images)))
    

def score_game(s1,s2):
    s1 = json.loads(s1)
    s2 = json.loads(s2)
    r = {}
    for key in s1.keys():
        r[key] = (s1[key]==s2[key])
    return r


##################################################################
### scheduler
##################################################################


socketio.start_background_task(process_waiting)


##################################################################
### routing
##################################################################


@app.route("/")
def default():
    return 'welcome'


@app.route("/main")
def main():
    return render_template('main.html')


@app.route('/test')
def test():
    return render_template('test.html')


##################################################################
### sockets
##################################################################


@socketio.on('connected')
def handle_connected(data):
    app.logger.info(f'socket connected for user: {data['username']}, task: {data['task']}, assignment: {data['assignment']}')
    join_room(data['username'])
    process_user(data['username'], data['task'], data['assignment'])


@socketio.on('typing')
def handle_typing(data):
    partner = data['partner']
    emit('notify_typing', to=partner)


@socketio.on('update')
def update(data):
    user = db.session.query(User).filter(User.user==data['username']).first()
    if user.status == 'waiting':
        data = {}
    else:
        game = db.session.query(Game).filter(Game.pair==user.pair,Game.task==user.task).order_by(Game.i.desc()).first()
        if game is not None:
            app.logger.info(f'retrieved game: {game.i}, pair: {game.pair}, task: {game.task}, user: {user.user}')
            if game.task=='train':
                n_remaining = n_rounds['train'] - game.n
            elif game.task=='test':
                n_remaining = n_rounds['test'] - game.n
            data = {'pair':game.pair, 'task':game.task, 'n':game.n, 'turn':game.turn, 'start_s':game.start_s, 'start_r':game.start_r, 'targets':game.targets, 'role':user.role, 'partner':user.partner,  'n_remaining':n_remaining}
            if game.turn>=1:
                data['move_1'] = game.move_1
            if game.turn>=2:
                data['move_2'] = game.move_2
                data['score'] = score_game(game.targets,game.move_2)
    emit('update', data, to=user.user)


@socketio.on('move')
def move(data):
    user = db.session.query(User).filter(User.user==data['username']).first()
    game = db.session.query(Game).filter(Game.pair==user.pair,Game.task==user.task).order_by(Game.i.desc()).first()
    
    if game.turn==0:
        game.move_1 = str(data['text'])
    elif game.turn==1:
        game.move_2 = str(data['text'])
    elif game.turn==2 and game.task=='test':
        game.move_3 = str(data['text'])

    # advance turn
    game.turn += 1
    db.session.commit()
    
    # refresh
    emit('refresh', to=user.user)
    emit('refresh', to=user.partner)

    if (game.turn==2 and game.task=='train') or (game.turn==3):
        if game.task=='train':
            if sum(score_game(game.targets,game.move_2).values()) == 3:
                time.sleep(3)
            else:
                time.sleep(7)
        
        # create new game
        if game.task=='train' and (game.n + 1 < n_rounds['train']):
            create_game(user.pair, 'train', game.n + 1)
        elif game.task=='test' and (game.n + 1 < n_rounds['test']):
            create_game(user.pair, 'test', game.n + 1)
        else:
            partner = db.session.query(User).filter(User.user==user.partner).first()
            for i in [user, partner]:
                i.status = 'waiting'
                i.time = None
            db.session.commit()

            app.logger.info(f'Issuing done for user: {user.user} and partner: {user.partner}')
            emit('done', {'type':'complete'}, to=user.user)
            emit('done', {'type':'complete'}, to=user.partner)
            return

        # refresh
        emit('refresh', to=user.user)
        emit('refresh', to=user.partner)


