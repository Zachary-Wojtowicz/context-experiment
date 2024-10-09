from gevent import monkey
monkey.patch_all() 

import logging
import os, sqlite3, simplejson, json, random, time

from flask import Flask, request, session, g, redirect, url_for, abort, render_template, flash, jsonify
from markupsafe import escape
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, String, func
from flask_socketio import SocketIO, send, emit, join_room
from dataclasses import dataclass
from apscheduler.schedulers.background import BackgroundScheduler


##################################################################
### parameters
##################################################################


n_rounds_train = 15
n_rounds_test = 10


##################################################################
### configure flask
##################################################################


app = Flask(__name__)
app.secret_key = "super secret key"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///project.db"
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins="*")

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
    train_partner: Mapped[str] = mapped_column(nullable=True)
    test_partner: Mapped[str] = mapped_column(nullable=True)
    task: Mapped[int]
    condition: Mapped[int]


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
        targets = random_images(1,12)
    elif task == 'done':
        targets = ''
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
    db.session.commit()
    time.sleep(.25)
    create_game(pair_num, task, 0)
    for i in [0, 1]:
        socketio.emit('refresh', room=pair_users[i].user)
    return pair_num


def process_user(username, task, condition):
    user = db.session.query(User).filter(User.user==username).first()
    if user is None:
        user = User(
            user = username,
            status = 'waiting',
            role = None,
            pair = None,
            partner = None,
            train_partner = None,
            test_partner = None,
            task = task,
            condition = condition
        )
        db.session.add(user)
    else:
        user.task = task
        if user.status=='waiting':
            return
        elif user.status=='playing':
            emit('refresh', to=user.user)
        elif user.status=='done':
            user.status = 'waiting'
            app.logger.info(f'finishing for user : {data['username']}, task: {data['task']}, condition: {data['condition']}')
            emit('done', to=user.user)
            # emit('redirect', url_for('done'), to=user.user)
    db.session.commit()


def process_waiting():
    while True:
        with app.app_context(), app.test_request_context():
            users = db.session.query(User).filter(User.status=='waiting').all()
            users_train = [user for user in users if user.task=='train']
            users_test = [user for user in users if user.task=='test']
            if len(users_train) >= 2:
                create_pair(users_train[0],users_train[1],'train')
            if len(users_test) >= 2:
                create_pair(users_test[0],users_test[1],'test')
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

# scheduler = BackgroundScheduler()
# job = scheduler.add_job(process_waiting, 'interval', seconds=2)
# scheduler.start()


##################################################################
### routing
##################################################################


@app.route("/")
def default():
    return 'welcome'

@app.route("/main")
def main():
    return render_template('main.html')


@app.route('/done')
def done():
    return 'Done!'


@app.route('/test')
def test():
    return render_template('test.html')


##################################################################
### sockets
##################################################################


@socketio.on('connected')
def handle_connected(data):
    app.logger.info(f'socket connected for user: {data['username']}, task: {data['task']}, condition: {data['condition']}')
    join_room(data['username'])
    process_user(data['username'], data['task'], data['condition'])


@socketio.on('update')
def update(data):
    user = db.session.query(User).filter(User.user==data['username']).first()
    if user.status == 'waiting':
        data = {}
    else:
        game = db.session.query(Game).filter(Game.pair==user.pair,Game.task==user.task).order_by(Game.i.desc()).first()
        if game is not None:
            if game.task != 'done':
                if game.task=='train':
                    n_remaining = n_rounds_train - game.n
                elif game.task=='test':
                    n_remaining = n_rounds_test - game.n
                elif game.task=='done':
                    n_remaining = 0
                data = {'pair':game.pair, 'task':game.task, 'n':game.n, 'turn':game.turn, 'start_s':game.start_s, 'start_r':game.start_r, 'targets':game.targets, 'role':user.role, 'n_remaining':n_remaining}
                if game.turn>=1:
                    data['move_1'] = game.move_1
                if game.turn>=2:
                    data['move_2'] = game.move_2
                    data['score'] = score_game(game.targets,game.move_2)
            else:
                emit('done', to=user.user)
                # emit('redirect', url_for('done'), to=user.user)
                return
    emit('update', data, to=user.user)


@socketio.on('move')
def move(data):
    user = db.session.query(User).filter(User.user==data['username']).first()
    game = db.session.query(Game).filter(Game.pair==user.pair,Game.task==user.task).order_by(Game.i.desc()).first()
    
    if game.turn==0:
        game.move_1 = str(data['text'])
    elif game.turn==1:
        game.move_2 = str(data['text'])
    elif game.turn==2 and game.task==1:
        game.move_3 = str(data['text'])

    # advance turn
    game.turn += 1
    db.session.commit()
    
    # refresh
    emit('refresh', to=user.user)
    emit('refresh', to=user.partner)

    if (game.turn==2 and game.task=='train') or (game.turn==3):
        # wait 3 seconds
        if game.task=='train':
            time.sleep(7)
        
        # create new game
        if game.task=='train' and (game.n + 1 < n_rounds_train):
            create_game(user.pair, 'train', game.n + 1)
        elif game.task=='test' and (game.n + 1 < n_rounds_test):
            create_game(user.pair, 'test', game.n + 1)
        else:
            create_game(user.pair, 'done', 0)
            user.status = 'done'
            partner = db.session.query(User).filter(User.user==user.partner).first()
            partner.status = 'done'
            db.session.commit()

        # refresh
        emit('refresh', to=user.user)
        emit('refresh', to=user.partner)


