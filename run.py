import os
import sys
import subprocess
import importlib

def install_requirements():
    print("Checking python dependencies...")
    req_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "requirements.txt")
    if not os.path.exists(req_file):
        print(f"Error: Could not find requirements file at {req_file}")
        return False
        
    required_packages = ["fastapi", "uvicorn", "pypdf", "jose", "passlib", "requests"]
    missing = []
    
    for pkg in required_packages:
        try:
            importlib.import_module(pkg)
        except ImportError:
            # Jose is installed as python-jose, and jose import checks it
            if pkg == "jose":
                try:
                    import jwt # python-jose also sets up jwt / jose namespace
                except ImportError:
                    missing.append("python-jose[cryptography]")
            else:
                missing.append(pkg)
                
    if missing:
        print(f"Missing libraries detected: {', '.join(missing)}")
        print("Installing dependencies from requirements.txt...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_file])
            print("Dependencies successfully installed!")
            return True
        except subprocess.CalledProcessError as e:
            print(f"Error during installation: {e}")
            return False
    else:
        print("All dependencies are ready.")
        return True

import time
import urllib.request
import threading
import webbrowser

def open_app_window():
    """Waits for server to start, then launches standalone app window in Edge/Chrome or default browser."""
    url = "http://127.0.0.1:8000"
    for _ in range(40):
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.35)

    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ]

    for browser_path in candidates:
        if os.path.isfile(browser_path):
            try:
                subprocess.Popen([browser_path, f"--app={url}"])
                return
            except Exception:
                pass

    # Fallback to default browser
    webbrowser.open(url)

def start_server():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    print("\n------------------------------------------------------------")
    print("Launching UntilDo - Smart Daily Tasks & AI Knowledge Suite server...")
    print(f"Local URL: http://127.0.0.1:{port}")
    print(f"Network / Mobile URL: http://0.0.0.0:{port}")
    print(f"API Documentation: http://127.0.0.1:{port}/docs")
    print("Press Ctrl+C to terminate.")
    print("------------------------------------------------------------\n")
    
    if "--no-browser" not in sys.argv and os.environ.get("UNTILDO_BROWSER_OPENED") != "1":
        os.environ["UNTILDO_BROWSER_OPENED"] = "1"
        threading.Thread(target=open_app_window, daemon=True).start()

    try:
        import uvicorn
        uvicorn.run("backend.main:app", host=host, port=port, reload=True)
    except Exception as e:
        print(f"Server failed to start or was terminated: {e}")

if __name__ == "__main__":
    if install_requirements():
        start_server()
    else:
        print("Failed to verify/install requirements. Please check your network and python environment.")
        sys.exit(1)

