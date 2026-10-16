import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "study_assistant.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # Create User Profiles table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        full_name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        avatar_id TEXT DEFAULT 'astronaut',
        study_goal TEXT DEFAULT 'Mastering key topics daily',
        target_hours_week REAL DEFAULT 15.0,
        streak_days INTEGER DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Create Documents table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        text_content TEXT NOT NULL,
        summary TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Create Notes table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        document_id INTEGER,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        is_pinned INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE SET NULL
    )
    """)
    
    # Create Quizzes table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        document_id INTEGER,
        title TEXT NOT NULL,
        questions_json TEXT NOT NULL, -- JSON string containing array of questions
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
    )
    """)
    
    # Create Quiz Attempts table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quiz_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        quiz_id INTEGER NOT NULL,
        score INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        time_seconds INTEGER DEFAULT 0,
        taken_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (quiz_id) REFERENCES quizzes (id) ON DELETE CASCADE
    )
    """)
    
    # Create Schedules table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        schedule_data_json TEXT NOT NULL, -- JSON string containing detailed calendar plan
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Create Tasks & Reminders table (with Daily Carry / Rollover support)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        due_date TEXT DEFAULT '', -- YYYY-MM-DD or empty for ongoing/no deadline
        priority TEXT DEFAULT 'Medium', -- Critical, High, Medium, Low
        is_completed INTEGER DEFAULT 0,
        reminder_time TEXT DEFAULT '',
        auto_carry INTEGER DEFAULT 1, -- 1: Auto-carry daily until done, 0: Disabled
        carry_count INTEGER DEFAULT 0, -- Number of days carried forward
        last_carried_date TEXT DEFAULT '',
        category TEXT DEFAULT 'General', -- Study, Work, Personal, Fitness, Project
        subtasks_json TEXT DEFAULT '[]', -- JSON array of subtasks [{"id": 1, "title": "...", "completed": false}]
        goal_target INTEGER DEFAULT 0, -- Numeric goal (e.g. 10 pages)
        goal_current INTEGER DEFAULT 0, -- Current logged amount
        goal_unit TEXT DEFAULT '', -- e.g. "pages", "chapters"
        goal_period TEXT DEFAULT '', -- e.g. "10 pages in 2 days"
        schedule_date TEXT DEFAULT '', -- When task should appear / start date
        parent_title TEXT DEFAULT '', -- Overarching bigger task / project this belongs to
        next_goal_prompt INTEGER DEFAULT 0, -- 1: Prompt for next goal/step when finished
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Create Chat Messages table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        sender TEXT NOT NULL, -- 'user' or 'ai'
        message TEXT NOT NULL,
        document_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE SET NULL
    )
    """)
    
    # Migration helper: Check if columns exist in existing tables
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN category TEXT DEFAULT 'General'")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN is_pinned INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE quiz_attempts ADD COLUMN time_seconds INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN auto_carry INTEGER DEFAULT 1")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN carry_count INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN last_carried_date TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN category TEXT DEFAULT 'General'")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN subtasks_json TEXT DEFAULT '[]'")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN goal_target INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN goal_current INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN goal_unit TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN goal_period TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN schedule_date TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN parent_title TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN next_goal_prompt INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN schedule_id INTEGER DEFAULT NULL")
    except Exception:
        pass
        
    conn.commit()
    conn.close()

# Initialize on import
init_db()

