from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from datetime import datetime, timedelta
import json
import os
import re
from typing import Optional

app = FastAPI()

# Get the server_side directory (where this script is located)
SERVER_SIDE_DIR = os.path.dirname(__file__)
LICENSES_DIR = os.path.join(SERVER_SIDE_DIR, "licenses")  # Directory containing license JSON files
SERVERS_FILE = os.path.join(SERVER_SIDE_DIR, "servers.json")   # Activated guilds with expiry times

# Load admin password from config
def load_admin_password():
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "index.js")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Extract password from the license.password field
            match = re.search(r"password:\s*process\.env\.RPP_LICENSE_PASSWORD\s*\|\|\s*['\"]([^'\"]+)['\"]", content)
            if match:
                return match.group(1)
            else:
                # Fallback to default if not found
                return "yoursupersecretpassword"
    except Exception as e:
        print(f"Error loading config: {e}")
        return "yoursupersecretpassword"  # Fallback to default

ADMIN_PASSWORD = load_admin_password()

# Initialize directories and files if they don't exist
if not os.path.exists(LICENSES_DIR):
    os.makedirs(LICENSES_DIR)

if not os.path.exists(SERVERS_FILE):
    with open(SERVERS_FILE, "w") as f:
        json.dump({"guilds": []}, f)


class ActivateRequest(BaseModel):
    guild_id: str
    key: str
    password: str  # Added password field


class AddKeyRequest(BaseModel):
    key: str
    duration: str
    password: str  # Added password field


def verify_password(password: str):
    """Verify if the provided password is correct"""
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    return True


def parse_time_string(time_str: str) -> timedelta:
    """
    Parse time string like '1m', '2h', '30d', '1y' or compound formats like '24h 10m' into timedelta object
    Supported units: s (seconds), m (minutes), h (hours), d (days), w (weeks), y (years)
    """
    time_str = time_str.lower().strip()
    
    # Split by spaces to handle compound formats like "24h 10m"
    parts = time_str.split()
    total_delta = timedelta()
    
    for part in parts:
        # Regular expression to match number + unit
        match = re.match(r'^(\d+)([smhdwy])$', part)
        if not match:
            raise ValueError(f"Invalid time format: {part}. Use format like '1m', '2h', '30d', etc.")
        
        amount, unit = match.groups()
        amount = int(amount)
        
        if unit == 's':  # seconds
            total_delta += timedelta(seconds=amount)
        elif unit == 'm':  # minutes
            total_delta += timedelta(minutes=amount)
        elif unit == 'h':  # hours
            total_delta += timedelta(hours=amount)
        elif unit == 'd':  # days
            total_delta += timedelta(days=amount)
        elif unit == 'w':  # weeks
            total_delta += timedelta(weeks=amount)
        elif unit == 'y':  # years (approximate)
            total_delta += timedelta(days=amount * 365)
        else:
            raise ValueError(f"Unsupported time unit: {unit}")
    
    return total_delta


def load_licenses():
    """Load all licenses from JSON files in the licenses directory and subdirectories"""
    all_keys = []
    file_mapping = {}  # Track which file each key came from
    
    if not os.path.exists(LICENSES_DIR):
        return {"keys": [], "file_mapping": {}}
    
    # Recursively scan all JSON files in the licenses directory
    for root, dirs, files in os.walk(LICENSES_DIR):
        for filename in files:
            if filename.endswith('.json') and filename != 'generator.json':
                file_path = os.path.join(root, filename)
                try:
                    with open(file_path, "r") as f:
                        data = json.load(f)
                        if "keys" in data and isinstance(data["keys"], list):
                            for key_obj in data["keys"]:
                                all_keys.append(key_obj)
                                # Map each key to its source file
                                file_mapping[key_obj["key"]] = file_path
                except (json.JSONDecodeError, IOError) as e:
                    print(f"Error reading {filename}: {e}")
                    continue
    
    return {"keys": all_keys, "file_mapping": file_mapping}

def remove_key_from_file(key_to_remove, file_path):
    """Remove a specific key from its source file"""
    try:
        with open(file_path, "r") as f:
            data = json.load(f)
        
        # Remove the key from the file
        if "keys" in data and isinstance(data["keys"], list):
            data["keys"] = [key_obj for key_obj in data["keys"] if key_obj["key"] != key_to_remove]
        
        # Save the updated file
        with open(file_path, "w") as f:
            json.dump(data, f, indent=4)
        
        print(f"Removed key {key_to_remove} from {file_path}")
        return True
    except Exception as e:
        print(f"Error removing key from {file_path}: {e}")
        return False

def save_licenses(data):
    """Note: This function is kept for compatibility but doesn't save to individual files"""
    # Since we're reading from multiple JSON files, we don't implement saving here
    # Individual license files should be managed manually or through admin interface
    pass

def load_servers():
    with open(SERVERS_FILE, "r") as f:
        return json.load(f)

def save_servers(data):
    with open(SERVERS_FILE, "w") as f:
        json.dump(data, f, indent=4)


@app.get("/check")
def check_license(guild_id: str, password: str):
    # Verify password
    verify_password(password)
    
    servers_data = load_servers()
    for guild in servers_data["guilds"]:
        if guild["id"] == guild_id:
            expires_at = datetime.fromisoformat(guild["expires_at"])
            if datetime.utcnow() > expires_at:
                return {"status": "expired", "expires_at": guild["expires_at"]}
            
            # Calculate remaining time
            remaining = expires_at - datetime.utcnow()
            remaining_seconds = int(remaining.total_seconds())
            
            return {
                "status": "active", 
                "expires_at": guild["expires_at"],
                "remaining_seconds": remaining_seconds
            }
    return {"status": "none"}


@app.post("/activate")
def activate_license(req: ActivateRequest):
    # Verify password
    verify_password(req.password)
    
    licenses_data = load_licenses()
    servers_data = load_servers()

    # Find the key in available licenses
    key_found = False
    key_duration = None
    key_source_file = None
    
    for lic in licenses_data["keys"]:
        if lic["key"] == req.key:
            key_found = True
            key_duration = lic["duration"]
            key_source_file = licenses_data["file_mapping"].get(req.key)
            break
    
    if not key_found:
        raise HTTPException(status_code=400, detail="Invalid key")
    
    # Parse the duration
    try:
        duration = parse_time_string(key_duration)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Check if guild already has an active license (for stacking)
    existing_guild = None
    for guild in servers_data["guilds"]:
        if guild["id"] == req.guild_id:
            existing_guild = guild
            break
    
    if existing_guild:
        # Guild exists - extend the license (stacking)
        current_expiry = datetime.fromisoformat(existing_guild["expires_at"])
        # If license is expired, start from now, otherwise extend from current expiry
        start_time = max(datetime.utcnow(), current_expiry)
        new_expiry = start_time + duration
        existing_guild["expires_at"] = new_expiry.isoformat()
    else:
        # New guild - create new entry
        new_expiry = datetime.utcnow() + duration
        servers_data["guilds"].append({
            "id": req.guild_id,
            "expires_at": new_expiry.isoformat()
        })
    
    # Remove the used key from its source file
    if key_source_file:
        remove_key_from_file(req.key, key_source_file)
    else:
        print(f"Warning: Could not find source file for key {req.key}")
    
    # Save servers data
    save_servers(servers_data)
    
    final_expiry = existing_guild["expires_at"] if existing_guild else new_expiry.isoformat()
    return {"status": "activated", "expires_at": final_expiry, "message": "License key has been consumed"}


@app.post("/add_key")
def add_key(req: AddKeyRequest):
    # Verify password
    verify_password(req.password)
    
    # Validate duration format
    try:
        parse_time_string(req.duration)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    data = load_licenses()
    data["keys"].append({"key": req.key, "duration": req.duration})
    save_licenses(data)
    return {"status": "ok"}


@app.get("/keys")
def list_keys(password: str):
    # Verify password
    verify_password(password)
    
    data = load_licenses()
    return {"available_keys": len(data["keys"]), "keys": data["keys"]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)