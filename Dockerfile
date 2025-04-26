FROM python:3.12-slim-bookworm

WORKDIR app
ADD https://github.com/cropscout-system/cropscout-interface.git .
COPY /etc/letsencrypt/live/demo.cropscout.farm/fullchain.pem /etc/letsencrypt/live/demo.cropscout.farm/privkey.pem keychain/

RUN pip install -r requirements.lock

WORKDIR cropscout
CMD python3 main.py