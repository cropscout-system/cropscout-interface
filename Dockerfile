FROM python:3.12-slim-bookworm

WORKDIR app
ADD https://github.com/cropscout-system/cropscout-interface.git .
RUN pip install -r requirements.lock

WORKDIR cropscout
CMD python3 main.py