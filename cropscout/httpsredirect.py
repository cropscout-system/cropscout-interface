import uvicorn
from fastapi import FastAPI
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware

app = FastAPI()
app.add_middleware(HTTPSRedirectMiddleware)

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=80)
