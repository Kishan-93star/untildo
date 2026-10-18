import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
import bcrypt
import sqlite3
from backend.database import get_db_connection

# JWT configuration
SECRET_KEY = os.environ.get("STUDY_JWT_SECRET", "study_assistant_super_secret_session_token_key_987654321")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 1 day

security_scheme = HTTPBearer()

def hash_password(password: str) -> str:
    # Use direct bcrypt library to avoid passlib-bcrypt compatibility issue
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def generate_password_hint(password: str) -> str:
    """Creates a hint showing first 2 and last 2 characters (e.g. 'se••••••et')."""
    if not password:
        return ""
    p_len = len(password)
    bullet = "*"
    if p_len <= 3:
        return password[0] + bullet * (p_len - 1)
    elif p_len <= 5:
        # Show 1st and last
        dots = bullet * (p_len - 2)
        return f"{password[0]}{dots}{password[-1]}"
    else:
        # Show first 2 and last 2
        dots = bullet * (p_len - 4)
        return f"{password[:2]}{dots}{password[-2:]}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security_scheme)) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        user_id: int = payload.get("id")
        if username is None or user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()
    
    if user is None:
        raise credentials_exception
        
    return {"id": user["id"], "username": user["username"]}
