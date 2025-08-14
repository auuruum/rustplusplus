from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from datetime import datetime, timedelta
import json
import os
import re
from typing import Optional

app = FastAPI()

LICENSE_FILE = "server_side/licenses.json"  # Available license keys
SERVERS_FILE = "server_side/servers.json"   # Activated guilds with expiry times

# Password for protected endpoints - change this to your desired password
ADMIN_PASSWORD = "your_secure_password_here"

# Initialize files if they don't exist
if not os.path.exists(LICENSE_FILE):
    with open(LICENSE_FILE, "w") as f:
        json.dump({"keys": []}, f)

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
    with open(LICENSE_FILE, "r") as f:
        return json.load(f)

def save_licenses(data):
    with open(LICENSE_FILE, "w") as f:
        json.dump(data, f, indent=4)

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
    key_index = None
    
    for i, lic in enumerate(licenses_data["keys"]):
        if lic["key"] == req.key:
            key_found = True
            key_duration = lic["duration"]
            key_index = i
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
    
    # Remove the used key from available licenses
    licenses_data["keys"].pop(key_index)
    
    # Save both files
    save_licenses(licenses_data)
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