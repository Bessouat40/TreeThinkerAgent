from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.backend.api.agent import router as agent_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Deep Research Agent API",
        description="Backend API to run the autonomous reasoning agent",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(agent_router, prefix="/api")

    @app.get("/")
    async def root():
        return {"message": "Deep Research Agent API is running 🚀"}

    return app


app = create_app()

if __name__ == "__main__":
    uvicorn.run("app.backend.main:app", host="0.0.0.0", port=8000, reload=True)
