from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.api.v1 import (
    health, admin, auth, batches, verifier, findings, employer, concurrency,
    ml, analytics, audit, reports, certificate, public_verify,
)
from app.core.config import settings
from app.core.database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.models  # noqa
    Base.metadata.create_all(bind=engine, checkfirst=True)
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    return JSONResponse(
        status_code=409,
        content={"detail": "Database constraint violated", "hint": str(exc.orig)[:300]},
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError):
    return JSONResponse(
        status_code=500,
        content={"detail": "Database error", "hint": type(exc).__name__},
    )


app.include_router(health.router,        prefix=settings.API_V1_PREFIX)
app.include_router(admin.router,         prefix=settings.API_V1_PREFIX)
app.include_router(auth.router,          prefix=settings.API_V1_PREFIX)
app.include_router(batches.router,       prefix=settings.API_V1_PREFIX)
app.include_router(verifier.router,      prefix=settings.API_V1_PREFIX)
app.include_router(findings.router,      prefix=settings.API_V1_PREFIX)
app.include_router(employer.router,      prefix=settings.API_V1_PREFIX)
app.include_router(concurrency.router,   prefix=settings.API_V1_PREFIX)
app.include_router(ml.router,            prefix=settings.API_V1_PREFIX)
app.include_router(analytics.router,     prefix=settings.API_V1_PREFIX)
app.include_router(audit.router,         prefix=settings.API_V1_PREFIX)
app.include_router(reports.router,       prefix=settings.API_V1_PREFIX)
app.include_router(certificate.router,   prefix=settings.API_V1_PREFIX)
app.include_router(public_verify.router, prefix=settings.API_V1_PREFIX)


@app.get("/")
def root():
    return {"service": settings.PROJECT_NAME, "docs": "/docs", "api": settings.API_V1_PREFIX}
