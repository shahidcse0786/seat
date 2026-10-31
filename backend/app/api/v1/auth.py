from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import create_access_token, verify_password
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginIn(BaseModel):
    email: str
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    role: str
    institution_id: str | None
    @classmethod
    def from_model(cls, u: User):
        return cls(id=str(u.id), email=u.email, role=u.role, institution_id=u.institution_id)

class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User is inactive")
    token = create_access_token(subject=str(user.id), claims={"role": user.role, "institution_id": user.institution_id, "email": user.email})
    return LoginOut(access_token=token, user=UserOut.from_model(user))

@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.from_model(user)

@router.get("/demo-users")
def demo_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.role).all()
    return [{"email": u.email, "role": u.role, "institution_id": u.institution_id, "password": "demo1234"} for u in users]
