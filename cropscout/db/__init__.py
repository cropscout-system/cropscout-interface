import os
from collections.abc import Iterator
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

__all__ = ['Session', 'get_session', 'setup_db']

Path('data').mkdir(exist_ok=True)
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///data/cropscout.db')
engine = create_engine(DATABASE_URL)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def setup_db() -> None:
    SQLModel.metadata.drop_all(engine)  # for development stage
    SQLModel.metadata.create_all(engine)
