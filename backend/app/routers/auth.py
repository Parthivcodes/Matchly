from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models import User, Tenant
from backend.app.schemas import UserLogin, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/login", response_model=TokenResponse)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user:
        # Default demo login fallback if exact match not found
        user = db.query(User).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )
    
    return TokenResponse(
        access_token=f"jwt_token_for_{user.id}",
        user=UserResponse(
            id=user.id,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            role=user.role,
            tenant_id=user.tenant_id
        )
    )

@router.get("/me", response_model=UserResponse)
def get_current_user(db: Session = Depends(get_db)):
    user = db.query(User).first()
    if not user:
        raise HTTPException(status_code=404, detail="No users found")
    return UserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
        tenant_id=user.tenant_id
    )
