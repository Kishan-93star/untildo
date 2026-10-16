import re
import math
import random
import json
import requests
from datetime import datetime, timedelta
from io import BytesIO
from typing import Optional, List, Dict
from pypdf import PdfReader

# Basic list of English stopwords to clean text for local TF-IDF
STOPWORDS = {
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours", 
    "yourself", "yourselves", "he", "him", "his", "himself", "she", "her", "hers", "herself", 
    "it", "its", "itself", "they", "them", "their", "theirs", "themselves", "what", "which", 
    "who", "whom", "this", "that", "these", "those", "am", "is", "are", "was", "were", "be", 
    "been", "being", "have", "has", "had", "having", "do", "does", "did", "doing", "a", "an", 
    "the", "and", "but", "if", "or", "because", "as", "until", "while", "of", "at", "by", "for", 
    "with", "about", "against", "between", "into", "through", "during", "before", "after", 
    "above", "below", "to", "from", "up", "down", "in", "out", "on", "off", "over", "under", 
    "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", 
    "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", 
    "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", 
    "should", "now"
}

def extract_text_from_file(file_content: bytes, filename: str) -> str:
    """Extracts text from PDF or TXT files."""
    if filename.lower().endswith(".pdf"):
        try:
            reader = PdfReader(BytesIO(file_content))
            text = ""
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
            return text.strip()
        except Exception as e:
            raise ValueError(f"Error parsing PDF: {str(e)}")
    elif filename.lower().endswith(".txt"):
        try:
            return file_content.decode("utf-8", errors="ignore").strip()
        except Exception as e:
            raise ValueError(f"Error parsing TXT file: {str(e)}")
    else:
        raise ValueError("Unsupported file format. Please upload a PDF or TXT file.")

# ==========================================
# LOCAL NLP ENGINE (TF-IDF & Keywords)
# ==========================================

def tokenize_sentences(text: str) -> list[str]:
    """Splits text into sentences using basic regular expressions."""
    sentences = re.split(r'(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?)\s', text)
    return [s.strip() for s in sentences if len(s.strip()) > 10]

def clean_word(word: str) -> str:
    """Lowercase and remove punctuation from a word."""
    return re.sub(r'[^\w\s]', '', word.lower())

def tokenize_words(sentence: str) -> list[str]:
    """Splits sentence into cleaned words, filtering out stopwords."""
    words = sentence.split()
    cleaned = []
    for w in words:
        cw = clean_word(w)
        if cw and cw not in STOPWORDS and not cw.isdigit():
            cleaned.append(cw)
    return cleaned

def generate_local_summary(text: str, num_sentences: int = 5) -> str:
    """Generates a summary of the text using a local TF-IDF sentence scoring algorithm."""
    sentences = tokenize_sentences(text)
    if not sentences:
        return "No summary could be generated."
    
    if len(sentences) <= num_sentences:
        return "\n\n".join(sentences)
    
    sentence_words = [tokenize_words(s) for s in sentences]
    word_doc_counts = {}
    
    for word_list in sentence_words:
        unique_words = set(word_list)
        for w in unique_words:
            word_doc_counts[w] = word_doc_counts.get(w, 0) + 1
            
    num_docs = len(sentences)
    sentence_scores = []
    for i, words in enumerate(sentence_words):
        if not words:
            sentence_scores.append((i, 0))
            continue
        
        score = 0
        for w in words:
            tf = words.count(w)
            idf = math.log(num_docs / (1 + word_doc_counts.get(w, 0)))
            score += tf * idf
            
        normalized_score = score / (1 + math.log(len(words)))
        sentence_scores.append((i, normalized_score))
        
    sentence_scores.sort(key=lambda x: x[1], reverse=True)
    top_indices = [idx for idx, _ in sentence_scores[:num_sentences]]
    top_indices.sort()
    
    summary_sentences = [sentences[idx] for idx in top_indices]
    
    markdown_summary = "### Key Takeaways & Core Concepts\n\n"
    for s in summary_sentences:
        markdown_summary += f"- **Key Point:** {s}\n"
    
    return markdown_summary

def generate_local_quiz(text: str, num_questions: int = 5) -> list[dict]:
    """Generates multiple choice questions using sentence extraction and key vocabulary."""
    sentences = tokenize_sentences(text)
    if not sentences:
        return []
        
    word_counts = {}
    for s in sentences:
        for w in tokenize_words(s):
            if len(w) > 4:
                word_counts[w] = word_counts.get(w, 0) + 1
                
    if len(word_counts) < 4:
        return []
        
    sorted_keywords = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
    keywords = [kw[0] for kw in sorted_keywords[:20]]
    
    questions = []
    used_sentences = set()
    
    for key_term in keywords:
        if len(questions) >= num_questions:
            break
            
        candidates = []
        for s in sentences:
            if s in used_sentences:
                continue
            if re.search(r'\b' + re.escape(key_term) + r'\b', s, re.IGNORECASE):
                if 35 < len(s) < 200:
                    candidates.append(s)
                    
        if not candidates:
            continue
            
        chosen_sentence = random.choice(candidates)
        used_sentences.add(chosen_sentence)
        
        pattern = re.compile(r'\b' + re.escape(key_term) + r'\b', re.IGNORECASE)
        question_text = pattern.sub("_________", chosen_sentence)
        
        match = pattern.search(chosen_sentence)
        correct_answer = match.group(0) if match else key_term
        
        other_keywords = [k for k in keywords if k.lower() != key_term.lower()]
        if len(other_keywords) < 3:
            other_keywords += ["concept", "hypothesis", "analysis", "framework", "variable", "principle"]
            other_keywords = list(set([k for k in other_keywords if k.lower() != key_term.lower()]))
            
        distractors = random.sample(other_keywords, min(3, len(other_keywords)))
        options = [correct_answer] + [d.capitalize() if correct_answer[0].isupper() else d.lower() for d in distractors]
        random.shuffle(options)
        
        questions.append({
            "question": f"Fill in the missing concept:\n\n\"{question_text}\"",
            "options": options,
            "correct_answer": correct_answer,
            "explanation": f"'{correct_answer}' completes this principle as established in the study material: \"{chosen_sentence}\""
        })
        
    return questions

# ==========================================
# GEMINI API CONNECTOR
# ==========================================

def call_gemini_api(api_key: str, prompt: str) -> str:
    """Makes a direct REST API call to the Gemini API."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }]
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        resp_json = response.json()
        text_content = resp_json['candidates'][0]['content']['parts'][0]['text']
        return text_content
    except Exception as e:
        raise RuntimeError(f"Gemini API request failed: {str(e)}")

def generate_gemini_summary(text: str, api_key: str) -> str:
    """Uses Gemini API to generate structured knowledge notes."""
    truncated_text = text[:15000]
    prompt = (
        "You are an expert AI Knowledge & Document Assistant. Please analyze the text below and extract "
        "comprehensive, high-yield structured notes with clear markdown headings, key concepts/definitions, "
        "actionable bullet points, important principles, and a list of 'Key Actionable Takeaways'.\n\n"
        f"SOURCE MATERIAL:\n{truncated_text}"
    )
    return call_gemini_api(api_key, prompt)

def generate_gemini_quiz(text: str, api_key: str, num_questions: int = 5) -> list[dict]:
    """Uses Gemini API to generate an interactive multiple-choice quiz with explanations."""
    truncated_text = text[:15000]
    prompt = (
        "You are an expert knowledge and skills evaluator. Create an interactive multiple-choice quiz based on the text below.\n"
        f"Generate exactly {num_questions} high quality multiple-choice questions testing key concepts.\n"
        "Return ONLY a valid JSON array of objects. Do not wrap in ```json blocks or add preamble.\n"
        "Each object MUST contain:\n"
        "- 'question': the question string\n"
        "- 'options': array of 4 distinct answer choices\n"
        "- 'correct_answer': exact string corresponding to the correct option\n"
        "- 'explanation': reasoning explaining why it is correct\n\n"
        f"SOURCE MATERIAL:\n{truncated_text}"
    )
    
    raw_response = call_gemini_api(api_key, prompt)
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        cleaned = cleaned.strip()
        
    try:
        return json.loads(cleaned)
    except Exception as e:
        print(f"Failed to parse Gemini quiz JSON: {str(e)}. Falling back to local.")
        return generate_local_quiz(text, num_questions)

def generate_ai_chat_response(
    message: str,
    document_text: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
    api_key: Optional[str] = None,
    mode: Optional[str] = "study"
) -> str:
    """
    Generates conversational copilot responses or bite-sized small talk.
    If mode is 'smalltalk', responses are strictly limited (1-2 sentences max).
    If Gemini API key is provided, uses Gemini 1.5 Flash with custom system instructions.
    Otherwise, uses smart local NLP.
    """
    msg_lower = message.lower().strip()
    is_smalltalk = (mode == "smalltalk") or any(phrase in msg_lower for phrase in ["how are you", "who are you", "what's up", "whats up", "how's it going", "tell me a joke", "i'm tired", "im tired", "bored", "good morning", "good night"])

    if api_key and api_key.strip():
        conversation_history_str = ""
        if history:
            for item in history[-6:]:
                role = "User" if item.get("sender") == "user" else "AI"
                conversation_history_str += f"{role}: {item.get('message')}\n"
                
        doc_context = ""
        if document_text and document_text.strip() and not is_smalltalk:
            doc_context = f"\nDOCUMENT CONTEXT REFERENCE:\n{document_text[:12000]}\n"
            
        if is_smalltalk:
            system_instructions = (
                "You are UntilDo's friendly, supportive AI Buddy. "
                "STRICT CONSTRAINT: Keep all replies extremely short, warm, and concise (strictly 1 to 2 short sentences, maximum 35 words). "
                "Be encouraging, witty, positive, and casual. Never provide long essays or lists in this mode."
            )
        else:
            system_instructions = (
                "You are UntilDo AI, an intelligent, highly versatile AI Copilot & Productivity Mentor. "
                "You assist users across all domains—whether breaking down complex work projects, mastering new skills, "
                "coding, analyzing documents, solving technical or conceptual problems, optimizing daily routines, "
                "or organizing daily tasks and priorities. Format your response cleanly using "
                "Markdown (bold highlights, clear bullet points, code blocks where applicable)."
            )
        
        full_prompt = (
            f"{system_instructions}\n"
            f"{doc_context}\n"
            f"RECENT CONVERSATION:\n{conversation_history_str}\n"
            f"User: {message}\n"
            "AI:"
        )
        
        try:
            return call_gemini_api(api_key, full_prompt)
        except Exception as e:
            print(f"Gemini Chat call failed: {str(e)}. Falling back to local NLP.")

    # --- LOCAL NLP SMALL TALK AGENT (Concise, 1-2 sentences) ---
    if is_smalltalk:
        if any(w in msg_lower for w in ["joke", "funny", "laugh"]):
            jokes = [
                "Why do programmers prefer dark mode? Because light attracts bugs! 💻🐛",
                "Why did the developer go broke? Because they used up all their cache! 💰",
                "Parallel lines have so much in common... it's a shame they'll never meet! 📐",
                "Why was the task manager so calm? Because everything was under control and scheduled! ⚡"
            ]
            return random.choice(jokes)
            
        if any(w in msg_lower for w in ["how are you", "how r u", "how you doing", "what's up", "whats up"]):
            greetings = [
                "I'm feeling great and ready to help you conquer your goals and tasks today! How is your day going? ✨",
                "Doing fantastic! Just sipping some virtual coffee and ready whenever you are. ☕",
                "All systems go! Let me know if you need a quick break, a task breakdown, or a motivation boost. 🚀"
            ]
            return random.choice(greetings)

        if any(w in msg_lower for w in ["tired", "sleepy", "exhausted", "hard", "stressed"]):
            comforts = [
                "Take a deep breath, drink a glass of water, and stretch for 2 minutes. You've got this! 💧",
                "Remember: progress over perfection. Even checking off one task today keeps your momentum going! 🌟",
                "It's okay to take a short 5-minute break. Your brain reorganizes ideas and recharges while resting! 🧠"
            ]
            return random.choice(comforts)
            
        if any(w in msg_lower for w in ["thank", "thanks", "thx", "appreciate"]):
            return "You're very welcome! I'm always here cheering you on. Keep up the awesome momentum! 🎉"

        if any(w in msg_lower for w in ["hello", "hi", "hey", "sup"]):
            return "Hey there! Ready to crush some tasks or do a quick focus session? 😊"

        # General concise reply
        return f"I hear you! Consistency is the secret to mastery. Let me know whenever you're ready for the next objective! 💡"
            
    # Local NLP / Fallback Response Engine
    msg_lower = message.lower().strip()
    
    # Check if a document context was provided
    if document_text and document_text.strip():
        sentences = tokenize_sentences(document_text)
        query_words = tokenize_words(msg_lower)
        
        if query_words and sentences:
            # Score sentences against user query
            scored = []
            for s in sentences:
                s_words = set(tokenize_words(s))
                overlap = len(set(query_words).intersection(s_words))
                if overlap > 0:
                    scored.append((overlap, s))
                    
            scored.sort(key=lambda x: x[0], reverse=True)
            top_matches = [s for _, s in scored[:4]]
            
            if top_matches:
                response = f"### 📚 Context from your Document Vault\n\n"
                response += f"Based on your document for **\"{message}\"**, here are the most relevant insights:\n\n"
                for match in top_matches:
                    response += f"> 💡 *\"{match}\"*\n\n"
                response += "\n**💡 Action Tip:** Save key takeaways to **Knowledge Notes** or create checklist tasks in **UntilDo Tasks**!"
                return response
                
    # Intelligent General Copilot Responses
    if any(greet in msg_lower for greet in ["hello", "hi", "hey", "greetings", "good morning", "good evening"]):
        return (
            "### 👋 Hello! I'm your UntilDo AI Copilot.\n\n"
            "I'm here to boost your productivity, organize your work, and accelerate your learning! Here are a few things I can do:\n"
            "- 🎯 **Break down projects or goals** into daily actionable sub-tasks\n"
            "- 📖 **Explain difficult concepts** simply (Try: *\"Explain Event Loops like I'm 10\"*)\n"
            "- ⚡ **Summarize documents** and extract key principles\n"
            "- 🗓️ **Design a structured 7-day routine**\n"
            "- 📝 **Generate interactive quizzes & drills**\n\n"
            "*How can I assist your goals today?*"
        )
        
    if "feynman" in msg_lower or "technique" in msg_lower:
        return (
            "### 🧠 The Feynman Technique for Rapid Mastery\n\n"
            "1. **Choose a Concept:** Pick a topic or technical architecture you want to understand deeply.\n"
            "2. **Explain it Simply:** Teach it using plain language without relying on jargon.\n"
            "3. **Identify Knowledge Gaps:** Pinpoint where explanations become fuzzy or hand-wavy.\n"
            "4. **Refine & Build Analogies:** Consult source material to construct clear mental models.\n\n"
            "Would you like to practice explaining a concept to me now?"
        )
        
    if "flashcard" in msg_lower or "mnemonic" in msg_lower:
        return (
            f"### 🎴 Active Recall & Memory Anchors for: *{message}*\n\n"
            "- **Card 1 (Core Concept):** What is the fundamental purpose or mechanism of this topic?\n"
            "- **Card 2 (Practical Application):** In what real-world scenario would you apply this?\n"
            "- **Card 3 (Contrast / Nuance):** How does this differ from alternative approaches?\n\n"
            "**Pro Tip:** Convert these points into a new note in **Knowledge Notes** for quick review!"
        )
        
    if any(w in msg_lower for w in ["plan", "schedule", "routine", "time management", "pomodoro"]):
        return (
            "### ⏳ The Ideal 25/5 Pomodoro & Deep Work Routine\n\n"
            "- ⏱️ **Sprint 1 (25 min):** Laser focus on your top priority task without multitasking.\n"
            "- ☕ **Short Break (5 min):** Stand up, hydrate, let your eyes relax.\n"
            "- ⏱️ **Sprint 2 (25 min):** Continue task execution or review milestone progress.\n"
            "- ☕ **Short Break (5 min):** Quick stretch.\n"
            "- 🏆 **After 4 rounds:** Take a 20-30 minute restorative break.\n\n"
            "*Tip: Check your **AI Timetable** tab to generate a custom 7-day plan!*"
        )
        
    # Default high-yield copilot response
    return (
        f"### ⚡ Strategic Breakdown: *{message}*\n\n"
        f"Here is an actionable overview of **{message}**:\n\n"
        "1. **Core Objectives:** Establish the fundamental requirements and scope.\n"
        "2. **Key Dependencies & Mechanics:** Identify how components, tools, or ideas interconnect.\n"
        "3. **Actionable Implementation:** Divide execution into bite-sized milestones in your daily task list.\n"
        "4. **Verification & Iteration:** Validate results, test edge cases, and review progress.\n\n"
        "*Tip: Select an uploaded document from the context dropdown above for tailored file analysis, or connect your Gemini API key in Settings for multi-tier deep reasoning!*"
    )

def generate_ai_schedule(subjects: list[str], hours_per_day: float, exam_date: str, api_key: Optional[str] = None) -> list[dict]:
    """Generates a structured 7-day distribution plan for work, study, or projects."""
    if api_key:
        prompt = (
            "You are an expert productivity advisor. Generate a 7-day optimized routine & timetable schedule.\n"
            f"- Focus Areas / Subjects: {', '.join(subjects)}\n"
            f"- Daily commitment: {hours_per_day} hours/day\n"
            f"- Target milestone date: {exam_date}\n\n"
            "Return ONLY a valid JSON array of objects. Do not write markdown tags or preambles.\n"
            "Each object must have:\n"
            "- 'day': e.g. 'Day 1 (Monday)'\n"
            "- 'time': e.g. '09:00 AM - 11:30 AM'\n"
            "- 'subject': Subject / Area name\n"
            "- 'topic': Specific focus module or deliverable\n"
            "- 'tasks': Actionable task checklist\n"
        )
        try:
            raw_response = call_gemini_api(api_key, prompt)
            cleaned = raw_response.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
                cleaned = re.sub(r'\s*```$', '', cleaned)
                cleaned = cleaned.strip()
            return json.loads(cleaned)
        except Exception as e:
            print(f"Gemini schedule generator failed: {str(e)}. Falling back to local.")
            
    # Local fallback scheduler
    local_schedule = []
    days = ["Day 1 (Monday)", "Day 2 (Tuesday)", "Day 3 (Wednesday)", "Day 4 (Thursday)", "Day 5 (Friday)", "Day 6 (Saturday)", "Day 7 (Sunday)"]
    topics_pool = {
        "flutter": ["Flutter Widgets & Layouts", "State Management (Bloc/Riverpod)", "Navigation & Routing", "API Integration & Async", "Local Persistence & Hive", "Clean Architecture & Testing"],
        "dart": ["Dart Types & Null Safety", "Async/Await & Streams", "OOP & Mixins", "Generics & Collections", "Functional Dart Patterns", "Unit Testing & Mocking"],
        "python": ["Python Core & Generators", "FastAPI & Async IO", "Pydantic Models & Validation", "Database ORM & Migrations", "Unit Testing with PyTest", "Performance Profiling"],
        "javascript": ["Async/Await & Promises", "DOM & Modern Event Architecture", "ES Modules & Bundling", "React/Vue Component Patterns", "API Integration & State", "TypeScript Migration"],
        "math": ["Algebra Foundations", "Calculus Integration", "Differential Equations", "Linear Systems", "Probability Distributions", "Statistical Inference"],
        "science": ["Cell Biology & Mitosis", "Chemical Bonding & Thermodynamics", "Newtonian Physics", "Organic Chemistry Basics", "Electromagnetism", "Genetics & DNA"],
        "computer science": ["Data Structures (Trees & Graphs)", "Big O Complexity Analysis", "REST API Development", "Database Indexing & SQL", "System Architecture & Design", "Machine Learning Fundamentals"],
        "project": ["Project Scoping & Architecture", "Core Feature Implementation", "Component Integration", "Refactoring & Optimization", "QA & Edge Case Testing", "Deployment & Documentation"],
        "design": ["Wireframing & User Flows", "Design System & Typography", "Responsive Layouts", "Interactive Prototyping", "Micro-interactions & Polish", "User Testing & Feedback"]
    }
    
    generic_topics = ["Fundamental Architecture & Scope", "Core Execution & Component Building", "Refining Edge Cases & Troubleshooting", "Integration & Practical Testing", "Performance Polish & Review", "Final Milestone Review & Wrap-up"]
    
    for i, day in enumerate(days):
        subj = subjects[i % len(subjects)]
        norm_subj = subj.lower().strip()
        matched_pool = None
        for key in topics_pool:
            if key in norm_subj or norm_subj in key:
                matched_pool = topics_pool[key]
                break
                
        if matched_pool:
            topic = matched_pool[i % len(matched_pool)]
        else:
            topic = generic_topics[i % len(generic_topics)]
            
        study_hours = float(hours_per_day)
        if study_hours <= 2:
            time_slot = "06:00 PM - 08:00 PM"
            tasks = f"Review core specs for {topic}; Complete targeted implementation steps; Log notes and progress."
        elif study_hours <= 4:
            time_slot = "10:00 AM - 12:00 PM & 03:00 PM - 05:00 PM"
            tasks = f"Deep focus session on {topic}; Implement key deliverables; Solve test cases; Update task list."
        else:
            time_slot = "09:00 AM - 12:00 PM & 02:00 PM - 05:00 PM"
            tasks = f"Comprehensive sprint on {topic}; Build modules; Run integration tests; Document milestones."
            
        local_schedule.append({
            "day": day,
            "time": time_slot,
            "subject": subj,
            "topic": topic,
            "tasks": tasks
        })
        
    return local_schedule


# ==========================================
# TIMETABLE IMPORT & PARSING ENGINE
# ==========================================

def normalize_schedule_items(items: list[dict], start_date_str: Optional[str] = None) -> list[dict]:
    """Cleans and standardizes parsed timetable items with actual calendar dates starting from start_date_str (defaults to today)."""
    result = []
    
    # Parse base start date
    if start_date_str:
        try:
            base_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        except Exception:
            base_date = datetime.now().date()
    else:
        base_date = datetime.now().date()
        
    today_date = datetime.now().date()

    for i, it in enumerate(items):
        target_date = base_date + timedelta(days=i)
        weekday_name = target_date.strftime("%A")
        weekday_short = target_date.strftime("%a")
        date_formatted = target_date.strftime("%b %d")
        is_today = (target_date == today_date)

        day_label = f"Day {i + 1} ({weekday_short}, {date_formatted})"
        if is_today:
            day_label = f"Day {i + 1} (Today • {weekday_short})"
            
        time_str = str(it.get("time") or it.get("time_slot") or it.get("slot") or it.get("hours") or "09:00 AM - 11:30 AM").strip()
        subj_str = str(it.get("subject") or it.get("course") or it.get("area") or it.get("category") or "General Study").strip()
        topic_str = str(it.get("topic") or it.get("module") or it.get("chapter") or it.get("focus") or subj_str).strip()
        
        raw_tasks = it.get("tasks") or it.get("action_items") or it.get("task") or it.get("description") or it.get("activities") or "Review core notes; Complete practice exercises; Summarize key takeaways"
        if isinstance(raw_tasks, list):
            tasks_str = "; ".join(str(t).strip() for t in raw_tasks if str(t).strip())
        else:
            tasks_str = str(raw_tasks).strip()
            
        result.append({
            "day": day_label,
            "date": target_date.strftime("%Y-%m-%d"),
            "weekday": weekday_name,
            "day_index": i,
            "time": time_str,
            "subject": subj_str,
            "topic": topic_str,
            "tasks": tasks_str,
            "is_today": is_today
        })
    return result

def parse_json_schedule(text: str) -> list[dict]:
    """Parses JSON-formatted schedules, whether wrapped in markdown code blocks or bare."""
    json_candidate = None
    if "```" in text:
        match = re.search(r'```(?:json)?\s*(\[\s*\{.*?\}\s*\])\s*```', text, re.DOTALL)
        if match:
            json_candidate = match.group(1)
    if not json_candidate:
        match = re.search(r'(\[\s*\{.*?\}\s*\])', text, re.DOTALL)
        if match:
            json_candidate = match.group(1)
            
    if json_candidate:
        try:
            data = json.loads(json_candidate)
            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                return normalize_schedule_items(data)
        except Exception:
            pass
    return []

def parse_markdown_table(text: str) -> list[dict]:
    """Extracts schedule rows from markdown or pipe-separated tables."""
    lines = [l.strip() for l in text.splitlines() if "|" in l]
    if len(lines) < 2:
        return []

    header_idx = -1
    for i, line in enumerate(lines):
        cells = [c.strip().lower() for c in line.split("|")[1:-1]]
        if any(h in cells for h in ["day", "time", "subject", "topic", "task", "tasks", "focus", "date"]):
            header_idx = i
            break

    if header_idx == -1:
        cells = [c.strip().lower() for c in lines[0].split("|")[1:-1]]
        if len(cells) >= 2:
            header_idx = 0
        else:
            return []

    headers = [c.strip().lower() for c in lines[header_idx].split("|")[1:-1]]
    col_map = {}
    for idx, col in enumerate(headers):
        if "day" in col or "date" in col:
            col_map["day"] = idx
        elif "time" in col or "hour" in col or "slot" in col:
            col_map["time"] = idx
        elif "subj" in col or "course" in col or "area" in col or "category" in col:
            col_map["subject"] = idx
        elif "top" in col or "chap" in col or "modul" in col or "focus" in col or "concept" in col:
            col_map["topic"] = idx
        elif "task" in col or "activ" in col or "desc" in col or "detail" in col or "action" in col or "work" in col:
            col_map["tasks"] = idx

    available_indices = [i for i in range(len(headers)) if i not in col_map.values()]
    if "day" not in col_map and 0 in available_indices:
        col_map["day"] = 0
        available_indices.remove(0)
    if "time" not in col_map and len(headers) > 1 and 1 in available_indices:
        col_map["time"] = 1
        available_indices.remove(1)
    if "subject" not in col_map and available_indices:
        col_map["subject"] = available_indices.pop(0)
    if "topic" not in col_map and available_indices:
        col_map["topic"] = available_indices.pop(0)
    if "tasks" not in col_map and available_indices:
        col_map["tasks"] = available_indices.pop(0)

    rows = []
    for line in lines[header_idx + 1:]:
        if re.match(r'^\s*\|?\s*:?-+:?\s*\|', line):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if not cells or all(c == "" for c in cells):
            continue
            
        def get_cell(field, default=""):
            idx = col_map.get(field)
            if idx is not None and idx < len(cells) and cells[idx]:
                return cells[idx]
            return default

        row_day = get_cell("day", f"Day {len(rows) + 1}")
        row_time = get_cell("time", "09:00 AM - 11:30 AM")
        row_subj = get_cell("subject", "General Study")
        row_topic = get_cell("topic", row_subj)
        row_tasks = get_cell("tasks", "Review key concepts; Complete practice problems")

        rows.append({
            "day": row_day,
            "time": row_time,
            "subject": row_subj,
            "topic": row_topic,
            "tasks": row_tasks
        })

    return normalize_schedule_items(rows) if rows else []

def parse_day_blocks(text: str) -> list[dict]:
    """Parses multi-line day blocks with bullet points or key-value items."""
    day_pattern = re.compile(
        r'(?:^|\n)(?:\#{1,4}\s*|\*{1,2}\s*)?'
        r'((?:Day\s*\d+(?:\s*\(.*?\))?|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*\(.*?\))?))'
        r'[:\s\-\–]*(.*?)(?=\n(?:\#{1,4}\s*|\*{1,2}\s*)?(?:Day\s*\d+|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b|\Z)',
        re.IGNORECASE | re.DOTALL
    )

    matches = list(day_pattern.finditer(text))
    if not matches:
        return []

    days_data = []
    for m in matches:
        raw_day_name = m.group(1).strip()
        block_content = m.group(2).strip()
        
        lines = [l.strip() for l in block_content.splitlines() if l.strip()]
        
        time_slot = "09:00 AM - 11:30 AM"
        subject = ""
        topic = ""
        tasks_list = []

        time_match = re.search(r'(?:Time(?:\s*Slot)?\s*[:\-]\s*)?(\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b)', block_content)
        if time_match:
            time_slot = time_match.group(1).strip()

        for line in lines:
            line_clean = re.sub(r'^[*\-#\s•+]+', '', line).strip()
            sub_m = re.match(r'^(?:Subject|Course|Module|Area)\s*[:\-]\s*(.*)$', line_clean, re.IGNORECASE)
            if sub_m:
                subject = sub_m.group(1).strip()
                continue
            top_m = re.match(r'^(?:Topic|Focus|Chapter)\s*[:\-]\s*(.*)$', line_clean, re.IGNORECASE)
            if top_m:
                topic = top_m.group(1).strip()
                continue
            task_m = re.match(r'^(?:Tasks?|Action Items?|Checklist|Activities?)\s*[:\-]\s*(.*)$', line_clean, re.IGNORECASE)
            if task_m:
                t_content = task_m.group(1).strip()
                if t_content:
                    tasks_list.append(t_content)
                continue
            
            if line.startswith(("- ", "* ", "• ", "+ ")) or re.match(r'^\d+\.\s', line):
                if not re.search(r'^(?:Time|Subject|Topic)\s*:', line_clean, re.IGNORECASE):
                    if "|" in line_clean:
                        parts = [p.strip() for p in line_clean.split("|")]
                        if len(parts) >= 2:
                            if not subject: subject = parts[0]
                            if not topic: topic = parts[1]
                            if len(parts) >= 3: tasks_list.append(parts[2])
                            continue
                    tasks_list.append(line_clean)
            elif not subject and len(line_clean) < 60 and not re.search(r'\d{1,2}:\d{2}', line_clean):
                if "-" in line_clean:
                    sp = line_clean.split("-", 1)
                    subject = sp[0].strip()
                    topic = sp[1].strip()
                else:
                    subject = line_clean

        if not subject:
            subject = topic if topic else "Study Session"
        if not topic:
            topic = subject
        tasks_str = "; ".join(tasks_list) if tasks_list else "Review core concepts; Solve practice problems"

        days_data.append({
            "day": raw_day_name,
            "time": time_slot,
            "subject": subject,
            "topic": topic,
            "tasks": tasks_str
        })

    return normalize_schedule_items(days_data) if days_data else []

def parse_compact_lines(text: str) -> list[dict]:
    """Parses one session per line formats (e.g. 'Monday: 9 AM - 11 AM - Physics: Mechanics - Problems 1-10')."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    items = []
    
    for line in lines:
        m = re.match(r'^(?:[#*\-\d.]*\s*)?(Day\s*\d+(?:\s*\(.*?\))?|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*\(.*?\))?)[\s:\-\–|]+(.*)$', line, re.IGNORECASE)
        if not m:
            continue
        day_name = m.group(1).strip()
        rest = m.group(2).strip()
        if not rest:
            continue

        time_slot = "09:00 AM - 11:30 AM"
        time_m = re.search(r'\(?(\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b)\)?', rest)
        if time_m:
            time_slot = time_m.group(1)
            rest = rest.replace(time_m.group(0), " ").strip()

        chunks = [c.strip() for c in re.split(r'\s*\|\s*|\s+[-–:]\s*|:\s+', rest) if c.strip()]
        subject = "General Study"
        topic = "Daily Study Session"
        tasks = "Review key concepts and complete practice exercises"

        if len(chunks) == 1:
            subject = chunks[0]
            topic = chunks[0]
        elif len(chunks) == 2:
            subject = chunks[0]
            topic = chunks[1]
        elif len(chunks) >= 3:
            subject = chunks[0]
            topic = chunks[1]
            tasks = "; ".join(chunks[2:])

        items.append({
            "day": day_name,
            "time": time_slot,
            "subject": subject,
            "topic": topic,
            "tasks": tasks
        })

    return normalize_schedule_items(items) if items else []

def parse_timetable_text(raw_text: str, api_key: Optional[str] = None, start_date_str: Optional[str] = None) -> list[dict]:
    """
    Intelligently parses any timetable or study schedule generated by ChatGPT, Gemini, Claude, or user notes.
    Tries JSON, Markdown tables, multi-line day blocks, and compact line formats.
    Calculates real dates starting from start_date_str (defaults to today).
    Falls back to Gemini AI semantic parsing if an API key is available.
    """
    raw_text = raw_text.strip()
    if not raw_text:
        return []

    # 1. Try JSON parser
    res = parse_json_schedule(raw_text)
    if res:
        return normalize_schedule_items(res, start_date_str)

    # 2. Try Markdown Table parser
    res = parse_markdown_table(raw_text)
    if res:
        return normalize_schedule_items(res, start_date_str)

    # 3. Check for sub-bullets
    has_sub_bullets = bool(re.search(r'\n\s*[-*•+]\s*(?:Time|Subject|Topic|Task|\w+)', raw_text, re.IGNORECASE))
    if has_sub_bullets:
        res = parse_day_blocks(raw_text)
        if res:
            return normalize_schedule_items(res, start_date_str)

    # 4. Try compact lines parser
    res = parse_compact_lines(raw_text)
    if res:
        return normalize_schedule_items(res, start_date_str)

    # 5. Try day blocks parser as fallback
    res = parse_day_blocks(raw_text)
    if res:
        return normalize_schedule_items(res, start_date_str)

    # 6. Semantic AI Parsing with Gemini (if API key is present)
    if api_key:
        prompt = (
            "You are an expert productivity and study assistant. Parse the following user-provided timetable or schedule into a clean JSON array of sessions.\n"
            "Return ONLY a valid JSON array of objects. Do not write markdown tags or preambles.\n"
            "Each object must have:\n"
            "- 'day': e.g. 'Day 1' or 'Day 1 (Friday)'\n"
            "- 'time': e.g. '09:00 AM - 11:30 AM' (if missing in text, estimate a realistic study slot)\n"
            "- 'subject': Subject or area name\n"
            "- 'topic': Specific focus module, concept, or deliverable\n"
            "- 'tasks': Actionable task checklist / activities (semicolon-separated)\n\n"
            f"INPUT TEXT:\n{raw_text[:10000]}"
        )
        try:
            raw_response = call_gemini_api(api_key, prompt)
            cleaned = raw_response.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
                cleaned = re.sub(r'\s*```$', '', cleaned)
                cleaned = cleaned.strip()
            parsed = json.loads(cleaned)
            if isinstance(parsed, list) and len(parsed) > 0:
                return normalize_schedule_items(parsed, start_date_str)
        except Exception as e:
            print(f"Gemini timetable parser failed: {e}")

    return []

