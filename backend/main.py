import os
import sqlite3
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Depends, File, UploadFile, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import json
import re

from backend.database import get_db_connection
from backend.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    generate_password_hint
)
from backend.ml_utils import (
    extract_text_from_file,
    generate_local_summary,
    generate_local_quiz,
    generate_gemini_summary,
    generate_gemini_quiz,
    generate_ai_schedule,
    generate_ai_chat_response,
    parse_timetable_text
)

app = FastAPI(title="UntilDo - Smart Daily Tasks & AI Knowledge Suite API")

# Setup CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Disable browser caching for development static files
@app.middleware("http")
async def add_no_cache_header(request, call_next):
    response = await call_next(request)
    if request.url.path.endswith((".css", ".js", ".html")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Pydantic Schemas
class UserRegister(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    username: str

class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = ""
    email: Optional[str] = ""
    avatar_id: Optional[str] = "astronaut"
    study_goal: Optional[str] = "Mastering key topics daily"
    target_hours_week: Optional[float] = 15.0

class UpdateUsernameRequest(BaseModel):
    new_username: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class NoteCreate(BaseModel):
    title: str
    content: str
    document_id: Optional[int] = None
    category: Optional[str] = "General"
    is_pinned: Optional[int] = 0

class NoteUpdate(BaseModel):
    title: str
    content: str
    category: Optional[str] = "General"
    is_pinned: Optional[int] = 0

class QuizGenerateRequest(BaseModel):
    document_id: int
    num_questions: int = 5
    gemini_key: Optional[str] = None

class QuizAttemptSave(BaseModel):
    quiz_id: int
    score: int
    total_questions: int
    time_seconds: Optional[int] = 0

class ScheduleGenerateRequest(BaseModel):
    subjects: List[str]
    hours_per_day: float
    exam_date: str
    gemini_key: Optional[str] = None

class ScheduleSave(BaseModel):
    title: str
    schedule_data: List[dict]
    convert_to_tasks: Optional[bool] = False
    start_date: Optional[str] = None

class ScheduleParseRequest(BaseModel):
    raw_text: str
    title: Optional[str] = "Imported Timetable"
    gemini_key: Optional[str] = None
    save_immediately: Optional[bool] = False
    convert_to_tasks: Optional[bool] = True
    start_date: Optional[str] = None

class ScheduleSyncTasksRequest(BaseModel):
    start_date: Optional[str] = None

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    due_date: Optional[str] = ""
    priority: Optional[str] = "Medium"
    reminder_time: Optional[str] = ""
    auto_carry: Optional[int] = 1
    category: Optional[str] = "General"
    subtasks_json: Optional[str] = "[]"
    goal_target: Optional[int] = 0
    goal_current: Optional[int] = 0
    goal_unit: Optional[str] = ""
    goal_period: Optional[str] = ""
    schedule_date: Optional[str] = ""
    parent_title: Optional[str] = ""
    next_goal_prompt: Optional[int] = 0

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    is_completed: Optional[int] = None
    reminder_time: Optional[str] = None
    auto_carry: Optional[int] = None
    carry_count: Optional[int] = None
    category: Optional[str] = None
    subtasks_json: Optional[str] = None
    goal_target: Optional[int] = None
    goal_current: Optional[int] = None
    goal_unit: Optional[str] = None
    goal_period: Optional[str] = None
    schedule_date: Optional[str] = None
    parent_title: Optional[str] = None
    next_goal_prompt: Optional[int] = None

class ChatRequest(BaseModel):
    message: str
    document_id: Optional[int] = None
    gemini_key: Optional[str] = None
    mode: Optional[str] = "study" # "study" or "smalltalk"
    history: Optional[List[Dict[str, str]]] = []

# ==========================================
# AUTH ENDPOINTS
# ==========================================

@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(user_data: UserRegister):
    username = user_data.username.strip()
    password = user_data.password
    
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters long")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters long")
        
    pwd_hash = hash_password(password)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    pwd_hint = generate_password_hint(password)
    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, password_hint) VALUES (?, ?, ?)",
            (username, pwd_hash, pwd_hint)
        )
        user_id = cursor.lastrowid
        
        # Initialize default profile
        cursor.execute(
            "INSERT INTO user_profiles (user_id, full_name, study_goal) VALUES (?, ?, ?)",
            (user_id, username, "Excel in all upcoming exams and coursework")
        )
        conn.commit()
    except Exception as e:
        conn.close()
        if "unique" in str(e).lower() or "integrity" in str(e).lower():
            raise HTTPException(status_code=400, detail="Username already exists")
        raise HTTPException(status_code=500, detail=f"Registration error: {str(e)}")
    
    conn.close()
    
    token = create_access_token(data={"sub": username, "id": user_id})
    return {"access_token": token, "token_type": "bearer", "username": username}

@app.post("/api/auth/login", response_model=Token)
def login(user_data: UserLogin):
    username = user_data.username.strip()
    password = user_data.password
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()
    
    if user is None or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
        
    token = create_access_token(data={"sub": user["username"], "id": user["id"]})
    return {"access_token": token, "token_type": "bearer", "username": user["username"]}

class ForgotHintRequest(BaseModel):
    username: str

@app.post("/api/auth/forgot-hint")
def get_forgot_hint(req: ForgotHintRequest):
    username = req.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Please enter your username")
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT username, password_hint FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="No account found with that username")
        
    hint = row["password_hint"]
    if not hint:
        return {
            "status": "ok",
            "username": username,
            "hint": "No hint available for this account. Please create a new account or sign in."
        }
        
    return {
        "status": "ok",
        "username": username,
        "hint": hint
    }

@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

# ==========================================
# USER PROFILE ENDPOINTS
# ==========================================

@app.get("/api/user/profile")
def get_user_profile(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_profiles WHERE user_id = ?", (current_user["id"],))
    profile = cursor.fetchone()
    
    if not profile:
        # Create if not found
        cursor.execute(
            "INSERT INTO user_profiles (user_id, full_name, study_goal) VALUES (?, ?, ?)",
            (current_user["id"], current_user["username"], "Mastering key concepts")
        )
        conn.commit()
        cursor.execute("SELECT * FROM user_profiles WHERE user_id = ?", (current_user["id"],))
        profile = cursor.fetchone()
        
    conn.close()
    return dict(profile)

@app.put("/api/user/profile")
def update_user_profile(data: UserProfileUpdate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE user_profiles 
        SET full_name = ?, email = ?, avatar_id = ?, study_goal = ?, target_hours_week = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    """, (data.full_name, data.email, data.avatar_id, data.study_goal, data.target_hours_week, current_user["id"]))
    conn.commit()
    conn.close()
    return {"message": "Profile updated successfully"}

@app.put("/api/user/username")
def update_username(req: UpdateUsernameRequest, current_user: dict = Depends(get_current_user)):
    new_username = req.new_username.strip()
    if len(new_username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters long")

    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if username is already taken by another user
    cursor.execute("SELECT id FROM users WHERE username = ? AND id != ?", (new_username, current_user["id"]))
    existing = cursor.fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="That username is already taken")

    try:
        cursor.execute("UPDATE users SET username = ? WHERE id = ?", (new_username, current_user["id"]))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Failed to update username: {str(e)}")
    conn.close()

    new_token = create_access_token(data={"sub": new_username, "id": current_user["id"]})
    return {
        "status": "ok",
        "message": "Username changed successfully",
        "username": new_username,
        "access_token": new_token
    }

@app.put("/api/user/password")
def change_password(req: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
    cur_pwd = req.current_password
    new_pwd = req.new_password
    
    if len(new_pwd) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters long")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT password_hash FROM users WHERE id = ?", (current_user["id"],))
    user = cursor.fetchone()
    if not user or not verify_password(cur_pwd, user["password_hash"]):
        conn.close()
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    new_hash = hash_password(new_pwd)
    new_hint = generate_password_hint(new_pwd)
    
    try:
        cursor.execute("UPDATE users SET password_hash = ?, password_hint = ? WHERE id = ?", (new_hash, new_hint, current_user["id"]))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Failed to update password: {str(e)}")
    conn.close()

    return {"status": "ok", "message": "Password updated successfully"}


# ==========================================
# DOCUMENT ENDPOINTS
# ==========================================

@app.post("/api/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    gemini_key: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    try:
        content = await file.read()
        text_content = extract_text_from_file(content, file.filename)
        
        # Generate summary
        if gemini_key and gemini_key.strip():
            summary = generate_gemini_summary(text_content, gemini_key)
        else:
            summary = generate_local_summary(text_content)
            
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO documents (user_id, filename, text_content, summary) VALUES (?, ?, ?, ?)",
            (current_user["id"], file.filename, text_content, summary)
        )
        doc_id = cursor.lastrowid
        
        # Auto-create study note
        note_title = f"Summary - {file.filename}"
        cursor.execute(
            "INSERT INTO notes (user_id, document_id, title, content, category) VALUES (?, ?, ?, ?, ?)",
            (current_user["id"], doc_id, note_title, summary, "AI Summary")
        )
        
        conn.commit()
        conn.close()
        
        return {
            "id": doc_id,
            "filename": file.filename,
            "summary": summary,
            "message": "Document uploaded and summarized successfully!"
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload document: {str(e)}")

@app.get("/api/documents")
def list_documents(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, filename, uploaded_at, length(text_content) as char_count FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC",
        (current_user["id"],)
    )
    docs = cursor.fetchall()
    conn.close()
    return [dict(doc) for doc in docs]

@app.get("/api/documents/{doc_id}")
def get_document(doc_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, filename, text_content, summary, uploaded_at FROM documents WHERE id = ? AND user_id = ?",
        (doc_id, current_user["id"])
    )
    doc = cursor.fetchone()
    conn.close()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return dict(doc)

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM documents WHERE id = ? AND user_id = ?", (doc_id, current_user["id"]))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Document not found")
    cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()
    return {"message": "Document deleted successfully"}

# ==========================================
# NOTES ENDPOINTS
# ==========================================

@app.get("/api/notes")
def list_notes(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, document_id, title, content, category, is_pinned, updated_at FROM notes WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC",
        (current_user["id"],)
    )
    notes = cursor.fetchall()
    conn.close()
    return [dict(note) for note in notes]

@app.post("/api/notes")
def create_note(note: NoteCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO notes (user_id, document_id, title, content, category, is_pinned) VALUES (?, ?, ?, ?, ?, ?)",
        (current_user["id"], note.document_id, note.title, note.content, note.category or "General", note.is_pinned or 0)
    )
    note_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"id": note_id, "title": note.title, "message": "Note created successfully"}

@app.put("/api/notes/{note_id}")
def update_note(note_id: int, note: NoteUpdate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM notes WHERE id = ? AND user_id = ?", (note_id, current_user["id"]))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")
        
    cursor.execute(
        "UPDATE notes SET title = ?, content = ?, category = ?, is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (note.title, note.content, note.category or "General", note.is_pinned or 0, note_id)
    )
    conn.commit()
    conn.close()
    return {"message": "Note updated successfully"}

@app.delete("/api/notes/{note_id}")
def delete_note(note_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM notes WHERE id = ? AND user_id = ?", (note_id, current_user["id"]))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")
        
    cursor.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()
    return {"message": "Note deleted successfully"}

# ==========================================
# QUIZ ENDPOINTS
# ==========================================

@app.post("/api/quizzes/generate")
def generate_quiz(req: QuizGenerateRequest, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT filename, text_content FROM documents WHERE id = ? AND user_id = ?",
        (req.document_id, current_user["id"])
    )
    doc = cursor.fetchone()
    if not doc:
        conn.close()
        raise HTTPException(status_code=404, detail="Document not found")
        
    if req.gemini_key and req.gemini_key.strip():
        questions = generate_gemini_quiz(doc["text_content"], req.gemini_key, req.num_questions)
    else:
        questions = generate_local_quiz(doc["text_content"], req.num_questions)
        
    if not questions:
        conn.close()
        raise HTTPException(status_code=400, detail="Could not extract enough quiz questions. Make sure the document contains sufficient explanatory text.")
        
    title = f"Quiz - {doc['filename']}"
    questions_json = json.dumps(questions)
    
    cursor.execute(
        "INSERT INTO quizzes (user_id, document_id, title, questions_json) VALUES (?, ?, ?, ?)",
        (current_user["id"], req.document_id, title, questions_json)
    )
    quiz_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return {
        "id": quiz_id,
        "title": title,
        "questions": questions
    }

@app.post("/api/quizzes/attempts")
def save_quiz_attempt(attempt: QuizAttemptSave, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM quizzes WHERE id = ? AND user_id = ?", (attempt.quiz_id, current_user["id"]))
    quiz = cursor.fetchone()
    if not quiz:
        conn.close()
        raise HTTPException(status_code=404, detail="Quiz not found")
        
    cursor.execute(
        "INSERT INTO quiz_attempts (user_id, quiz_id, score, total_questions, time_seconds) VALUES (?, ?, ?, ?, ?)",
        (current_user["id"], attempt.quiz_id, attempt.score, attempt.total_questions, attempt.time_seconds or 0)
    )
    conn.commit()
    conn.close()
    return {"message": "Quiz attempt logged successfully"}

@app.get("/api/quizzes/attempts")
def get_quiz_attempts(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT qa.id, qa.score, qa.total_questions, qa.time_seconds, qa.taken_at, q.title 
        FROM quiz_attempts qa 
        JOIN quizzes q ON qa.quiz_id = q.id 
        WHERE qa.user_id = ? 
        ORDER BY qa.taken_at DESC
        LIMIT 25
    """, (current_user["id"],))
    attempts = cursor.fetchall()
    conn.close()
    return [dict(a) for a in attempts]

# ==========================================
# SCHEDULE & PLANNER TASKS ENDPOINTS
# ==========================================

@app.post("/api/schedules/generate")
def generate_schedule(req: ScheduleGenerateRequest, current_user: dict = Depends(get_current_user)):
    try:
        schedule_data = generate_ai_schedule(
            subjects=req.subjects,
            hours_per_day=req.hours_per_day,
            exam_date=req.exam_date,
            api_key=req.gemini_key
        )
        return {"schedule_data": schedule_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate schedule: {str(e)}")

@app.post("/api/schedules")
def save_schedule(req: ScheduleSave, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    schedule_json = json.dumps(req.schedule_data)
    cursor.execute(
        "INSERT INTO schedules (user_id, title, schedule_data_json) VALUES (?, ?, ?)",
        (current_user["id"], req.title, schedule_json)
    )
    schedule_id = cursor.lastrowid

    tasks_created = 0
    if req.convert_to_tasks:
        today_date = datetime.now().date()
        if req.start_date:
            try:
                base_date = datetime.strptime(req.start_date, "%Y-%m-%d").date()
            except Exception:
                base_date = today_date
        else:
            base_date = today_date

        for idx, item in enumerate(req.schedule_data):
            target_date = item.get("date") or (base_date + timedelta(days=idx)).strftime("%Y-%m-%d")
            raw_tasks = item.get("tasks", "")
            task_lines = [t.strip().rstrip(".") for t in re.split(r'[;\n]', raw_tasks) if t.strip()]
            subtasks_obj = [{"id": sub_i + 1, "title": st, "completed": False} for sub_i, st in enumerate(task_lines)]
            subtasks_json = json.dumps(subtasks_obj)

            cursor.execute(
                """INSERT INTO tasks (user_id, title, description, due_date, priority, category, auto_carry, schedule_id, subtasks_json) 
                   VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)""",
                (
                    current_user["id"],
                    f"{item.get('subject', 'Study')}: {item.get('topic', 'Daily Focus')}",
                    f"{item.get('day', '')} • Time: {item.get('time', 'Scheduled')} - {raw_tasks}",
                    target_date,
                    "Medium",
                    "Study",
                    schedule_id,
                    subtasks_json
                )
            )
            tasks_created += 1

    conn.commit()
    conn.close()
    return {"id": schedule_id, "title": req.title, "tasks_created": tasks_created, "message": "Schedule saved successfully"}

@app.post("/api/schedules/parse-text")
def parse_and_import_schedule(req: ScheduleParseRequest, current_user: dict = Depends(get_current_user)):
    raw_text = req.raw_text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Pasted timetable text cannot be empty")
        
    schedule_data = parse_timetable_text(raw_text, api_key=req.gemini_key, start_date_str=req.start_date)
    if not schedule_data:
        raise HTTPException(
            status_code=422,
            detail="Could not detect a timetable structure from the pasted text. Please make sure the text contains days (e.g. Day 1, Monday), a schedule table, or JSON."
        )
        
    saved_id = None
    tasks_created = 0
    if req.save_immediately or req.convert_to_tasks:
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            if req.save_immediately:
                schedule_json = json.dumps(schedule_data)
                cursor.execute(
                    "INSERT INTO schedules (user_id, title, schedule_data_json) VALUES (?, ?, ?)",
                    (current_user["id"], req.title or "Imported Timetable", schedule_json)
                )
                saved_id = cursor.lastrowid

            if req.convert_to_tasks:
                today_date = datetime.now().date()
                if req.start_date:
                    try:
                        base_date = datetime.strptime(req.start_date, "%Y-%m-%d").date()
                    except Exception:
                        base_date = today_date
                else:
                    base_date = today_date

                for idx, item in enumerate(schedule_data):
                    target_date = item.get("date") or (base_date + timedelta(days=idx)).strftime("%Y-%m-%d")
                    raw_tasks = item.get("tasks", "")
                    task_lines = [t.strip().rstrip(".") for t in re.split(r'[;\n]', raw_tasks) if t.strip()]
                    subtasks_obj = [{"id": sub_i + 1, "title": st, "completed": False} for sub_i, st in enumerate(task_lines)]
                    subtasks_json = json.dumps(subtasks_obj)

                    cursor.execute(
                        """INSERT INTO tasks (user_id, title, description, due_date, priority, category, auto_carry, schedule_id, subtasks_json) 
                           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)""",
                        (
                            current_user["id"],
                            f"{item.get('subject', 'Study')}: {item.get('topic', 'Daily Focus')}",
                            f"{item.get('day', '')} • Time: {item.get('time', 'Scheduled')} - {raw_tasks}",
                            target_date,
                            "Medium",
                            "Study",
                            saved_id,
                            subtasks_json
                        )
                    )
                    tasks_created += 1
            conn.commit()
        finally:
            conn.close()

    return {
        "title": req.title or "Imported Timetable",
        "schedule_data": schedule_data,
        "saved_id": saved_id,
        "tasks_created": tasks_created,
        "message": f"Successfully parsed {len(schedule_data)} sessions"
    }

@app.post("/api/schedules/{schedule_id}/sync-tasks")
def sync_schedule_to_tasks(schedule_id: int, req: Optional[ScheduleSyncTasksRequest] = None, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, schedule_data_json FROM schedules WHERE id = ? AND user_id = ?", (schedule_id, current_user["id"]))
    sched = cursor.fetchone()
    if not sched:
        conn.close()
        raise HTTPException(status_code=404, detail="Schedule not found")

    schedule_data = json.loads(sched["schedule_data_json"])
    start_date_str = (req.start_date if req and req.start_date else None) or datetime.now().strftime("%Y-%m-%d")
    try:
        base_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except Exception:
        base_date = datetime.now().date()

    # Clear previous tasks for this schedule to avoid duplicate tasks
    cursor.execute("DELETE FROM tasks WHERE user_id = ? AND schedule_id = ?", (current_user["id"], schedule_id))

    tasks_created = 0
    for idx, item in enumerate(schedule_data):
        target_date = (base_date + timedelta(days=idx)).strftime("%Y-%m-%d")
        raw_tasks = item.get("tasks", "")
        task_lines = [t.strip().rstrip(".") for t in re.split(r'[;\n]', raw_tasks) if t.strip()]
        subtasks_obj = [{"id": sub_i + 1, "title": st, "completed": False} for sub_i, st in enumerate(task_lines)]
        subtasks_json = json.dumps(subtasks_obj)

        cursor.execute(
            """INSERT INTO tasks (user_id, title, description, due_date, priority, category, auto_carry, schedule_id, subtasks_json) 
               VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            (
                current_user["id"],
                f"{item.get('subject', 'Study')}: {item.get('topic', 'Daily Focus')}",
                f"Day {idx + 1} ({target_date}) • Time: {item.get('time', 'Scheduled')} - {raw_tasks}",
                target_date,
                "Medium",
                "Study",
                schedule_id,
                subtasks_json
            )
        )
        tasks_created += 1

    conn.commit()
    conn.close()
    return {"tasks_created": tasks_created, "message": f"Synced {tasks_created} topics directly to your Tasks page starting from {start_date_str}!"}

@app.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE schedule_id = ? AND user_id = ?", (schedule_id, current_user["id"]))
    cursor.execute("DELETE FROM schedules WHERE id = ? AND user_id = ?", (schedule_id, current_user["id"]))
    conn.commit()
    conn.close()
    return {"message": "Schedule deleted successfully"}

@app.get("/api/schedules")
def list_schedules(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, title, schedule_data_json, created_at FROM schedules WHERE user_id = ? ORDER BY created_at DESC",
        (current_user["id"],)
    )
    schedules = cursor.fetchall()
    conn.close()
    
    result = []
    for s in schedules:
        result.append({
            "id": s["id"],
            "title": s["title"],
            "schedule_data": json.loads(s["schedule_data_json"]),
            "created_at": s["created_at"]
        })
    return result


def process_auto_carry(user_id: int, conn):
    """
    UntilDo Daily Carry Engine:
    Find all incomplete tasks (is_completed = 0) with auto_carry = 1 where due_date < today_str.
    Advance their due_date to today_str, increment carry_count, and record last_carried_date.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_dt = datetime.strptime(today_str, "%Y-%m-%d").date()
    
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, due_date, carry_count FROM tasks WHERE user_id = ? AND is_completed = 0 AND auto_carry = 1 AND due_date != '' AND due_date IS NOT NULL AND due_date < ?",
        (user_id, today_str)
    )
    overdue_tasks = cursor.fetchall()
    for t in overdue_tasks:
        old_due_str = t["due_date"]
        try:
            old_due_dt = datetime.strptime(old_due_str, "%Y-%m-%d").date()
            diff_days = (today_dt - old_due_dt).days
        except Exception:
            diff_days = 1
        
        diff_days = max(1, diff_days)
        curr_carry = t["carry_count"] or 0
        new_carry = curr_carry + diff_days
        cursor.execute(
            "UPDATE tasks SET due_date = ?, carry_count = ?, last_carried_date = ? WHERE id = ?",
            (today_str, new_carry, today_str, t["id"])
        )
    if overdue_tasks:
        conn.commit()

@app.get("/api/planner/tasks")
@app.get("/api/tasks")
def get_planner_tasks(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    process_auto_carry(current_user["id"], conn)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM tasks WHERE user_id = ? ORDER BY is_completed ASC, due_date ASC, id DESC",
        (current_user["id"],)
    )
    tasks = cursor.fetchall()
    conn.close()
    return [dict(t) for t in tasks]

@app.post("/api/planner/tasks")
@app.post("/api/tasks")
def create_planner_task(task: TaskCreate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    auto_carry_val = 1 if task.auto_carry is None else int(task.auto_carry)
    cursor.execute(
        """INSERT INTO tasks (user_id, title, description, due_date, priority, reminder_time, auto_carry, carry_count, category, subtasks_json, goal_target, goal_current, goal_unit, goal_period, schedule_date, parent_title, next_goal_prompt) 
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (current_user["id"], task.title, task.description or "", task.due_date or "", task.priority or "Medium", task.reminder_time or "", auto_carry_val, task.category or "General", task.subtasks_json or "[]", task.goal_target or 0, task.goal_current or 0, task.goal_unit or "", task.goal_period or "", task.schedule_date or "", task.parent_title or "", task.next_goal_prompt or 0)
    )
    task_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"id": task_id, "title": task.title, "auto_carry": auto_carry_val, "message": "Task created successfully"}

@app.put("/api/planner/tasks/{task_id}")
@app.put("/api/tasks/{task_id}")
def update_planner_task(task_id: int, task: TaskUpdate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, current_user["id"]))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
        
    title = task.title if task.title is not None else existing["title"]
    desc = task.description if task.description is not None else existing["description"]
    due = task.due_date if task.due_date is not None else existing["due_date"]
    priority = task.priority if task.priority is not None else existing["priority"]
    completed = task.is_completed if task.is_completed is not None else existing["is_completed"]
    reminder = task.reminder_time if task.reminder_time is not None else existing["reminder_time"]
    auto_carry = task.auto_carry if task.auto_carry is not None else (existing["auto_carry"] if "auto_carry" in existing.keys() else 1)
    carry_count = task.carry_count if task.carry_count is not None else (existing["carry_count"] if "carry_count" in existing.keys() else 0)
    category = task.category if task.category is not None else (existing["category"] if "category" in existing.keys() else "General")
    subtasks_json = task.subtasks_json if task.subtasks_json is not None else (existing["subtasks_json"] if "subtasks_json" in existing.keys() else "[]")
    goal_target = task.goal_target if task.goal_target is not None else (existing["goal_target"] if "goal_target" in existing.keys() else 0)
    goal_current = task.goal_current if task.goal_current is not None else (existing["goal_current"] if "goal_current" in existing.keys() else 0)
    goal_unit = task.goal_unit if task.goal_unit is not None else (existing["goal_unit"] if "goal_unit" in existing.keys() else "")
    goal_period = task.goal_period if task.goal_period is not None else (existing["goal_period"] if "goal_period" in existing.keys() else "")
    schedule_date = task.schedule_date if task.schedule_date is not None else (existing["schedule_date"] if "schedule_date" in existing.keys() else "")
    parent_title = task.parent_title if task.parent_title is not None else (existing["parent_title"] if "parent_title" in existing.keys() else "")
    next_goal_prompt = task.next_goal_prompt if task.next_goal_prompt is not None else (existing["next_goal_prompt"] if "next_goal_prompt" in existing.keys() else 0)

    # Auto-complete if goal target is reached
    if goal_target > 0 and goal_current >= goal_target and task.is_completed is None:
        completed = 1

    cursor.execute("""
        UPDATE tasks 
        SET title = ?, description = ?, due_date = ?, priority = ?, is_completed = ?, reminder_time = ?, auto_carry = ?, carry_count = ?, category = ?, subtasks_json = ?, goal_target = ?, goal_current = ?, goal_unit = ?, goal_period = ?, schedule_date = ?, parent_title = ?, next_goal_prompt = ?
        WHERE id = ?
    """, (title, desc, due, priority, completed, reminder, auto_carry, carry_count, category, subtasks_json, goal_target, goal_current, goal_unit, goal_period, schedule_date, parent_title, next_goal_prompt, task_id))
    conn.commit()
    conn.close()
    return {"message": "Task updated successfully"}

class GoalProgressUpdate(BaseModel):
    delta: Optional[int] = None
    current: Optional[int] = None

@app.post("/api/tasks/{task_id}/goal-progress")
def update_task_goal_progress(task_id: int, prog: GoalProgressUpdate, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, goal_target, goal_current, is_completed FROM tasks WHERE id = ? AND user_id = ?", (task_id, current_user["id"]))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
    
    current_val = row["goal_current"] or 0
    target_val = row["goal_target"] or 0
    if prog.current is not None:
        new_val = max(0, prog.current)
    elif prog.delta is not None:
        new_val = max(0, current_val + prog.delta)
    else:
        new_val = current_val

    is_completed = row["is_completed"]
    if target_val > 0 and new_val >= target_val and not is_completed:
        is_completed = 1

    cursor.execute("UPDATE tasks SET goal_current = ?, is_completed = ? WHERE id = ?", (new_val, is_completed, task_id))
    conn.commit()
    conn.close()
    return {"id": task_id, "goal_current": new_val, "goal_target": target_val, "is_completed": is_completed}

@app.delete("/api/planner/tasks/{task_id}")
@app.delete("/api/tasks/{task_id}")
def delete_planner_task(task_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", (task_id, current_user["id"]))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
        
    cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return {"message": "Task deleted successfully"}

@app.post("/api/tasks/{task_id}/toggle-carry")
def toggle_task_auto_carry(task_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT auto_carry FROM tasks WHERE id = ? AND user_id = ?", (task_id, current_user["id"]))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
    current_val = 1 if row["auto_carry"] is None else row["auto_carry"]
    new_val = 0 if current_val == 1 else 1
    cursor.execute("UPDATE tasks SET auto_carry = ? WHERE id = ?", (new_val, task_id))
    conn.commit()
    conn.close()
    return {"id": task_id, "auto_carry": new_val, "message": f"Auto-carry {'enabled' if new_val == 1 else 'disabled'}"}

@app.post("/api/tasks/{task_id}/carry-to-today")
def carry_task_to_today(task_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT due_date, carry_count FROM tasks WHERE id = ? AND user_id = ?", (task_id, current_user["id"]))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
    today_str = datetime.now().strftime("%Y-%m-%d")
    current_carry = row["carry_count"] or 0
    cursor.execute("UPDATE tasks SET due_date = ?, carry_count = ?, last_carried_date = ? WHERE id = ?",
                   (today_str, current_carry + 1, today_str, task_id))
    conn.commit()
    conn.close()
    return {"id": task_id, "due_date": today_str, "carry_count": current_carry + 1, "message": "Task carried forward to today"}

@app.post("/api/tasks/carry-all-overdue")
def carry_all_overdue_tasks(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    today_str = datetime.now().strftime("%Y-%m-%d")
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, carry_count FROM tasks WHERE user_id = ? AND is_completed = 0 AND due_date < ?",
        (current_user["id"], today_str)
    )
    overdue = cursor.fetchall()
    count = 0
    for t in overdue:
        c = (t["carry_count"] or 0) + 1
        cursor.execute("UPDATE tasks SET due_date = ?, carry_count = ?, last_carried_date = ? WHERE id = ?",
                       (today_str, c, today_str, t["id"]))
        count += 1
    conn.commit()
    conn.close()
    return {"carried_count": count, "message": f"Carried {count} tasks to today"}

# ==========================================
# AI CHAT ENDPOINTS (ChatGPT-style)
# ==========================================

@app.post("/api/chat")
def send_chat_message(req: ChatRequest, current_user: dict = Depends(get_current_user)):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
        
    document_text = None
    if req.document_id:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT text_content FROM documents WHERE id = ? AND user_id = ?", (req.document_id, current_user["id"]))
        doc = cursor.fetchone()
        conn.close()
        if doc:
            document_text = doc["text_content"]
            
    # Generate AI answer
    ai_response = generate_ai_chat_response(
        message=message,
        document_text=document_text,
        history=req.history,
        api_key=req.gemini_key,
        mode=req.mode
    )
    
    # Store in database
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chat_messages (user_id, sender, message, document_id) VALUES (?, 'user', ?, ?)",
        (current_user["id"], message, req.document_id)
    )
    cursor.execute(
        "INSERT INTO chat_messages (user_id, sender, message, document_id) VALUES (?, 'ai', ?, ?)",
        (current_user["id"], ai_response, req.document_id)
    )
    conn.commit()
    conn.close()
    
    return {
        "reply": ai_response,
        "document_id": req.document_id
    }

@app.get("/api/chat/history")
def get_chat_history(document_id: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    if document_id:
        cursor.execute(
            "SELECT id, sender, message, document_id, created_at FROM chat_messages WHERE user_id = ? AND document_id = ? ORDER BY created_at ASC LIMIT 60",
            (current_user["id"], document_id)
        )
    else:
        cursor.execute(
            "SELECT id, sender, message, document_id, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 60",
            (current_user["id"],)
        )
    messages = cursor.fetchall()
    conn.close()
    return [dict(m) for m in messages]

@app.delete("/api/chat/history")
def clear_chat_history(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM chat_messages WHERE user_id = ?", (current_user["id"],))
    conn.commit()
    conn.close()
    return {"message": "Chat history cleared"}

# ==========================================
# DASHBOARD STATS & PROGRESS CHART DATA
# ==========================================

@app.get("/api/dashboard/stats")
def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM documents WHERE user_id = ?", (current_user["id"],))
    doc_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM notes WHERE user_id = ?", (current_user["id"],))
    notes_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*), AVG(CAST(score AS FLOAT) / total_questions * 100) FROM quiz_attempts WHERE user_id = ?", (current_user["id"],))
    quiz_row = cursor.fetchone()
    quizzes_taken = quiz_row[0] or 0
    avg_score = round(quiz_row[1], 1) if quiz_row[1] is not None else 0
    
    cursor.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND is_completed = 1", (current_user["id"],))
    completed_tasks = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM tasks WHERE user_id = ?", (current_user["id"],))
    total_tasks = cursor.fetchone()[0]
    
    # Quiz attempt score trends (last 8 attempts)
    cursor.execute("""
        SELECT qa.score, qa.total_questions, qa.taken_at, q.title 
        FROM quiz_attempts qa 
        JOIN quizzes q ON qa.quiz_id = q.id 
        WHERE qa.user_id = ? 
        ORDER BY qa.taken_at ASC 
        LIMIT 10
    """, (current_user["id"],))
    attempts_history = [
        {
            "title": row["title"],
            "score_pct": round((row["score"] / max(1, row["total_questions"])) * 100, 1),
            "date": row["taken_at"][:10]
        }
        for row in cursor.fetchall()
    ]
    
    conn.close()
    
    return {
        "documents_count": doc_count,
        "notes_count": notes_count,
        "quizzes_taken": quizzes_taken,
        "average_quiz_score": avg_score,
        "completed_tasks": completed_tasks,
        "total_tasks": total_tasks,
        "quiz_trends": attempts_history
    }

# ==========================================
# MOUNT STATIC FILES
# ==========================================

static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
os.makedirs(static_dir, exist_ok=True)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
