import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.app.config import settings
from backend.app.database import engine, Base
from backend.app.seed_data import seed_database
from backend.app.routers import (
    auth, invoices, purchase_orders, goods_receipts,
    exceptions, vendors, analytics, exports
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite/PostgreSQL schema
    Base.metadata.create_all(bind=engine)
    # Populate rich demonstration seed data if not present
    try:
        seed_database()
    except Exception as e:
        print(f"Seed notice: {e}")
    yield

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(invoices.router, prefix="/api/v1")
app.include_router(purchase_orders.router, prefix="/api/v1")
app.include_router(goods_receipts.router, prefix="/api/v1")
app.include_router(exceptions.router, prefix="/api/v1")
app.include_router(vendors.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(exports.router, prefix="/api/v1")

# Mount frontend static files
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Matchly API is running. Frontend static directory not found."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
