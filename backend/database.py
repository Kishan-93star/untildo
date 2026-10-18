import os
import sqlite3
import re

DATABASE_URL = os.environ.get("DATABASE_URL")

# Try importing psycopg2 if DATABASE_URL is set
_psycopg2 = None
if DATABASE_URL:
    try:
        import psycopg2
        import psycopg2.extras
        _psycopg2 = psycopg2
    except ImportError:
        _psycopg2 = None

def is_postgres():
    return bool(DATABASE_URL and _psycopg2)

# Normalizes Render's postgres:// scheme to postgresql:// if needed
def get_clean_database_url():
    url = DATABASE_URL
    if url and url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url

# =========================================================================
# COMPATIBILITY WRAPPERS
# =========================================================================

class PostgresCursorWrapper:
    """Wraps a psycopg2 cursor so that:
    1. '?' placeholders in SQL queries are automatically translated to '%s'.
    2. 'lastrowid' works seamlessly across INSERT statements.
    3. Row dict-like indexing works as in sqlite3.Row.
    """
    def __init__(self, raw_cursor, conn):
        self._cur = raw_cursor
        self._conn = conn
        self.lastrowid = None

    def _convert_query(self, query):
        # Convert sqlite ? placeholder to postgres %s
        return query.replace("?", "%s")

    def execute(self, query, params=None):
        q = self._convert_query(query)
        clean_q = q.strip().rstrip(";")
        is_insert = clean_q.lstrip().upper().startswith("INSERT INTO")
        has_returning = "RETURNING" in clean_q.upper()
        
        # If it's an INSERT without RETURNING, append RETURNING id to capture lastrowid
        if is_insert and not has_returning:
            clean_q = clean_q + " RETURNING id"
            if params is not None:
                self._cur.execute(clean_q, params)
            else:
                self._cur.execute(clean_q)
            try:
                row = self._cur.fetchone()
                if row:
                    self.lastrowid = row[0]
            except Exception:
                self.lastrowid = None
            return self
        else:
            if params is not None:
                self._cur.execute(q, params)
            else:
                self._cur.execute(q)
            return self

    def executemany(self, query, seq_of_params):
        q = self._convert_query(query)
        self._cur.executemany(q, seq_of_params)
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        return dict(row)

    def fetchall(self):
        rows = self._cur.fetchall()
        return [dict(r) for r in rows]

    def fetchmany(self, size=None):
        rows = self._cur.fetchmany(size)
        return [dict(r) for r in rows]

    @property
    def rowcount(self):
        return self._cur.rowcount

    def close(self):
        self._cur.close()

    def __iter__(self):
        for row in self._cur:
            yield dict(row)


class PostgresConnectionWrapper:
    """Wraps psycopg2 connection to mimic sqlite3 connection semantics."""
    def __init__(self, raw_conn):
        self._conn = raw_conn

    def cursor(self):
        return PostgresCursorWrapper(self._conn.cursor(cursor_factory=_psycopg2.extras.DictCursor), self)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def execute(self, query, params=None):
        cur = self.cursor()
        return cur.execute(query, params)


# =========================================================================
# CONNECTION FACTORY
# =========================================================================

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "study_assistant.db")

def get_db_connection():
    if is_postgres():
        conn = _psycopg2.connect(get_clean_database_url())
        return PostgresConnectionWrapper(conn)
    else:
        conn = sqlite3.connect(DB_PATH, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 30000;")
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn


# =========================================================================
# DATABASE INITIALIZATION & SCHEMA MIGRATION
# =========================================================================

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    if is_postgres():
        # PostgreSQL Schema
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_profiles (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            full_name TEXT DEFAULT '',
            email TEXT DEFAULT '',
            avatar_id TEXT DEFAULT 'astronaut',
            study_goal TEXT DEFAULT 'Mastering key topics daily',
            target_hours_week REAL DEFAULT 15.0,
            streak_days INTEGER DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            text_content TEXT NOT NULL,
            summary TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            document_id INTEGER REFERENCES documents (id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'General',
            is_pinned INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS quizzes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            document_id INTEGER REFERENCES documents (id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            questions_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS quiz_attempts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            quiz_id INTEGER NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
            score INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            time_seconds INTEGER DEFAULT 0,
            taken_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS schedules (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            schedule_data_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            due_date TEXT DEFAULT '',
            priority TEXT DEFAULT 'Medium',
            is_completed INTEGER DEFAULT 0,
            reminder_time TEXT DEFAULT '',
            auto_carry INTEGER DEFAULT 1,
            carry_count INTEGER DEFAULT 0,
            last_carried_date TEXT DEFAULT '',
            category TEXT DEFAULT 'General',
            subtasks_json TEXT DEFAULT '[]',
            goal_target INTEGER DEFAULT 0,
            goal_current INTEGER DEFAULT 0,
            goal_unit TEXT DEFAULT '',
            goal_period TEXT DEFAULT '',
            schedule_date TEXT DEFAULT '',
            parent_title TEXT DEFAULT '',
            next_goal_prompt INTEGER DEFAULT 0,
            schedule_id INTEGER DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            document_id INTEGER REFERENCES documents (id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

    else:
        # SQLite Schema
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

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

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS quizzes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            document_id INTEGER,
            title TEXT NOT NULL,
            questions_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
        )
        """)

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

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            schedule_data_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            due_date TEXT DEFAULT '',
            priority TEXT DEFAULT 'Medium',
            is_completed INTEGER DEFAULT 0,
            reminder_time TEXT DEFAULT '',
            auto_carry INTEGER DEFAULT 1,
            carry_count INTEGER DEFAULT 0,
            last_carried_date TEXT DEFAULT '',
            category TEXT DEFAULT 'General',
            subtasks_json TEXT DEFAULT '[]',
            goal_target INTEGER DEFAULT 0,
            goal_current INTEGER DEFAULT 0,
            goal_unit TEXT DEFAULT '',
            goal_period TEXT DEFAULT '',
            schedule_date TEXT DEFAULT '',
            parent_title TEXT DEFAULT '',
            next_goal_prompt INTEGER DEFAULT 0,
            schedule_id INTEGER DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            document_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE SET NULL
        )
        """)

        # SQLite Column migrations
        cols = [
            ("notes", "category", "TEXT DEFAULT 'General'"),
            ("notes", "is_pinned", "INTEGER DEFAULT 0"),
            ("quiz_attempts", "time_seconds", "INTEGER DEFAULT 0"),
            ("tasks", "auto_carry", "INTEGER DEFAULT 1"),
            ("tasks", "carry_count", "INTEGER DEFAULT 0"),
            ("tasks", "last_carried_date", "TEXT DEFAULT ''"),
            ("tasks", "category", "TEXT DEFAULT 'General'"),
            ("tasks", "subtasks_json", "TEXT DEFAULT '[]'"),
            ("tasks", "goal_target", "INTEGER DEFAULT 0"),
            ("tasks", "goal_current", "INTEGER DEFAULT 0"),
            ("tasks", "goal_unit", "TEXT DEFAULT ''"),
            ("tasks", "goal_period", "TEXT DEFAULT ''"),
            ("tasks", "schedule_date", "TEXT DEFAULT ''"),
            ("tasks", "parent_title", "TEXT DEFAULT ''"),
            ("tasks", "next_goal_prompt", "INTEGER DEFAULT 0"),
            ("tasks", "schedule_id", "INTEGER DEFAULT NULL"),
        ]
        for tbl, col, ctype in cols:
            try:
                cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN {col} {ctype}")
            except Exception:
                pass

    conn.commit()
    conn.close()

# Initialize on import
init_db()
