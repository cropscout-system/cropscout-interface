FROM python:3.12-slim-bookworm

ADD git@github.com:cropscout-system/cropscout-interface /app
RUN pip install -r requirements.lock

WORKDIR /app/cropscout
CMD python3 main.py