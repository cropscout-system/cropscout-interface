import hashlib
import operator
import os
import uuid
from itertools import accumulate
from pathlib import Path
from typing import cast

import jwt
import uvicorn
from db import Session, get_session, setup_db
from db.models import Mission, Route, RouteWaypoint, VisitStatus, Waypoint, WaypointVisit
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from models import PasswordUpdate, RouteModel, UserCredentials, convert_db_route
from sqlmodel import select

app = FastAPI(title='CropScout Drone Control System')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],  # for development only
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


STATIC_ROOT = Path('static')
app.mount('/static', StaticFiles(directory=str(STATIC_ROOT.absolute())), name='static')

SECRET_KEY = os.getenv('SECRET_KEY', 'your-secret-key-change-in-production')
ALGORITHM = 'HS256'

# TODO: Replace with fastapi-users
users = {'admin': {'password_hash': hashlib.sha256(b'admin').hexdigest(), 'is_admin': True}}


def get_password_hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return get_password_hash(plain_password) == hashed_password


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


security = HTTPBearer()


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Invalid authentication credentials',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    return payload.get('sub')


@app.post('/api/routes', response_model=RouteModel)
async def create_route(
    route: RouteModel, db: Session = Depends(get_session), username: str = Depends(get_current_user)
):
    db_route = Route(name=route.name, username=username)
    db.add(db_route)
    db.commit()
    db.refresh(db_route)

    for wp in route.waypoints:
        db_waypoint = Waypoint(
            latitude=wp.lat,
            longitude=wp.lng,
            altitude=float(wp.alt),
        )
        db.add(db_waypoint)
        db.commit()
        db.refresh(db_waypoint)

        db.add(RouteWaypoint(route_id=db_route.id, waypoint_id=db_waypoint.id))

    db.commit()

    return convert_db_route(db_route, db_route.waypoints)


@app.get('/api/routes', response_model=list[RouteModel])
async def get_routes(db: Session = Depends(get_session), username: str = Depends(get_current_user)):
    routes_query = select(Route).where(Route.username == username)
    db_routes = db.exec(routes_query).all()
    return [
        convert_db_route(db_route, db_route.waypoints)
        for db_route in db_routes
        if not db_route.name.startswith('Temporary')
    ]


@app.get('/api/routes/{route_id}', response_model=RouteModel)
async def get_route(
    route_id: str, db: Session = Depends(get_session), username: str = Depends(get_current_user)
):
    try:
        route_uuid = uuid.UUID(route_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail='Invalid route ID format') from e

    db_route = cast('Route', db.get(Route, route_uuid))
    if not db_route:
        raise HTTPException(status_code=404, detail='Route not found')
    if db_route.username != username:
        raise HTTPException(status_code=403, detail='Route not accessible')

    return convert_db_route(db_route, db_route.waypoints)


@app.post('/api/routes/{route_id}/start')
async def start_mission(
    route_id: str, db: Session = Depends(get_session), username: str = Depends(get_current_user)
):
    try:
        route_uuid = uuid.UUID(route_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail='Invalid route ID format') from e

    db_route = db.get(Route, route_uuid)
    if not db_route:
        raise HTTPException(status_code=404, detail='Route not found')
    if db_route.username != username:
        raise HTTPException(status_code=403, detail='Route not accessible')

    mission = Mission(route_id=route_uuid)
    db.add(mission)
    db.commit()
    db.refresh(mission)

    for order, waypoint in enumerate(db_route.waypoints):
        visit = WaypointVisit(
            mission_id=mission.id,
            waypoint_id=waypoint.id,
            order=order,
            status=VisitStatus.PLANNED,
        )
        db.add(visit)

    db.commit()
    return {'message': 'Mission planned successfully', 'mission_id': str(mission.id)}


@app.get('/api/missions/current/waypoints', response_model=list[dict])
async def get_waypoints(
    db: Session = Depends(get_session), username: str = Depends(get_current_user)
):
    planned_visits_query = (
        select(WaypointVisit)
        .where(WaypointVisit.status == VisitStatus.PLANNED)
        .join(Mission)
        .join(Route)
        .where(Route.username == username)
        .order_by(WaypointVisit.order)
    )

    planned_visits = db.exec(planned_visits_query).all()

    if not planned_visits:
        return []

    mission_waypoints = {}
    for visit in planned_visits:
        if visit.mission_id not in mission_waypoints:
            mission_waypoints[visit.mission_id] = []

        waypoint = db.get(Waypoint, visit.waypoint_id)
        if not waypoint:
            continue

        mission_waypoints[visit.mission_id].append(
            {
                'flight_mission_id': str(visit.mission_id),
                'point_id': str(waypoint.id),
                'point_visit_id': str(visit.id),
                'order': visit.order,
                'status': visit.status,
                'latitude': waypoint.latitude,
                'longitude': waypoint.longitude,
                'photo_altitude': waypoint.altitude,
            }
        )

        visit.status = VisitStatus.IN_PROGRESS

    db.commit()

    return list(accumulate(mission_waypoints.values(), operator.add, initial=[]))[-1]


@app.post('/api/auth/login')
async def login(credentials: UserCredentials):
    username = credentials.username
    password = credentials.password

    if username not in users:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Incorrect username or password',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    if not verify_password(password, users[username]['password_hash']):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Incorrect username or password',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    access_token = create_access_token({'sub': username})
    return {'access_token': access_token, 'token_type': 'bearer'}


@app.post('/api/auth/change-password')
async def change_password(
    password_update: PasswordUpdate, username: str = Depends(get_current_user)
):
    if not verify_password(password_update.current_password, users[username]['password_hash']):
        raise HTTPException(status_code=400, detail='Current password is incorrect')

    users[username]['password_hash'] = get_password_hash(password_update.new_password)
    return {'message': 'Password updated successfully'}


@app.get('/', response_class=HTMLResponse)
async def get_home():
    with Path.open(STATIC_ROOT / 'index.html') as f:
        content = f.read()
    return content


if __name__ == '__main__':
    setup_db()

    uvicorn.run(app, host='0.0.0.0', port=8000)
