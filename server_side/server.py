from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from datetime import datetime, timedelta
import json
import os
import re
import requests
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

# Load Payhip configuration from config
def load_payhip_config():
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "index.js")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Extract secret key from the payhip.secretKey30d field
            secret_match = re.search(r"secretKey30d:\s*process\.env\.RPP_PAYHIP_SECRET_30D\s*\|\|\s*['\"]([^'\"]+)['\"]", content)
            # Extract API base URL from the payhip.apiBaseUrl field
            url_match = re.search(r"apiBaseUrl:\s*process\.env\.RPP_PAYHIP_API_URL\s*\|\|\s*['\"]([^'\"]+)['\"]", content)
            
            secret_key = secret_match.group(1) if secret_match else "prod_sk_default"
            api_url = url_match.group(1) if url_match else "https://payhip.com/api/v2"
            
            return {
                "secret_key": secret_key,
                "api_base_url": api_url
            }
    except Exception as e:
        print(f"Error loading Payhip config: {e}")
        return {
            "secret_key": "prod_sk_default",
            "api_base_url": "https://payhip.com/api/v2"
        }

PAYHIP_CONFIG = load_payhip_config()

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


class PayhipActivateRequest(BaseModel):
    guild_id: str
    license_key: str
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


def cleanup_expired_servers():
    """Remove servers that have been expired for more than 30 days"""
    servers_data = load_servers()
    current_time = datetime.utcnow()
    one_month_ago = current_time - timedelta(days=30)
    
    original_count = len(servers_data["guilds"])
    
    # Filter out servers expired for more than 30 days
    servers_data["guilds"] = [
        guild for guild in servers_data["guilds"]
        if datetime.fromisoformat(guild["expires_at"]) > one_month_ago
    ]
    
    removed_count = original_count - len(servers_data["guilds"])
    
    if removed_count > 0:
        save_servers(servers_data)
        print(f"Cleaned up {removed_count} servers that were expired for more than 30 days")
    
    return removed_count


def verify_payhip_license(license_key: str):
    """Verify a Payhip license key using their API"""
    try:
        url = f"{PAYHIP_CONFIG['api_base_url']}/license/verify"
        params = {"license_key": license_key}
        headers = {"product-secret-key": PAYHIP_CONFIG['secret_key']}
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "data" in data and data["data"]:
                license_data = data["data"]
                return {
                    "valid": True,
                    "enabled": license_data.get("enabled", False),
                    "buyer_email": license_data.get("buyer_email", ""),
                    "uses": license_data.get("uses", 0),
                    "date": license_data.get("date", "")
                }
            else:
                return {"valid": False, "error": "License key not found"}
        else:
            return {"valid": False, "error": f"API request failed with status {response.status_code}"}
    
    except requests.exceptions.RequestException as e:
        return {"valid": False, "error": f"Network error: {str(e)}"}
    except Exception as e:
        return {"valid": False, "error": f"Unexpected error: {str(e)}"}


def is_payhip_license_already_used(license_key: str):
    """Check if a Payhip license key has already been used by checking the 'uses' field from Payhip API
    
    Args:
        license_key: The Payhip license key to check
    
    Returns:
        True if the key has been used before (uses > 0), False otherwise
    """
    try:
        # Use Payhip API to check if license has been used
        verification_result = verify_payhip_license(license_key)
        if verification_result["valid"]:
            uses = verification_result.get("uses", 0)
            print(f"[DEBUG] Payhip license uses count: {uses}")
            # If uses > 0, the license has been used before
            return uses > 0
        else:
            # If license is invalid, consider it as "used" to prevent activation
            return True
    except Exception as e:
        print(f"[DEBUG] Error checking if Payhip license is already used: {e}")
        # On error, assume it's used to be safe
        return True


def increase_payhip_license_usage(license_key: str):
    """Increase the usage count of a Payhip license key"""
    try:
        url = f"{PAYHIP_CONFIG['api_base_url']}/license/usage"
        data = {"license_key": license_key}
        headers = {"product-secret-key": PAYHIP_CONFIG['secret_key']}
        
        response = requests.put(url, data=data, headers=headers, timeout=10)
        
        if response.status_code == 200:
            response_data = response.json()
            if "data" in response_data and response_data["data"]:
                return {"success": True, "data": response_data["data"]}
            else:
                return {"success": False, "error": "Failed to increase usage"}
        else:
            return {"success": False, "error": f"API request failed with status {response.status_code}"}
    
    except requests.exceptions.RequestException as e:
        return {"success": False, "error": f"Network error: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected error: {str(e)}"}


@app.get("/check")
def check_license(guild_id: str, password: str):
    # Verify password
    verify_password(password)
    
    # Perform cleanup of expired servers
    try:
        cleanup_expired_servers()
    except Exception as e:
        print(f"Error during cleanup: {e}")
    
    servers_data = load_servers()
    for guild in servers_data["guilds"]:
        if guild["id"] == guild_id:
            expires_at = datetime.fromisoformat(guild["expires_at"])
            if datetime.utcnow() > expires_at:
                return {"status": "expired", "expires_at": guild["expires_at"]}
            
            # If this is a Payhip license, verify it's still valid
            if "payhip_key" in guild:
                verification_result = verify_payhip_license(guild["payhip_key"])
                if not verification_result["valid"] or not verification_result["enabled"]:
                    # Payhip license is invalid or disabled, mark as expired
                    return {
                        "status": "expired", 
                        "expires_at": guild["expires_at"],
                        "reason": "Payhip license disabled or invalid"
                    }
            
            # Calculate remaining time
            remaining = expires_at - datetime.utcnow()
            remaining_seconds = int(remaining.total_seconds())
            
            response = {
                "status": "active", 
                "expires_at": guild["expires_at"],
                "remaining_seconds": remaining_seconds
            }
            
            # Add license type information
            if "payhip_key" in guild:
                response["license_type"] = "payhip"
            else:
                response["license_type"] = "standard"
            
            return response
    return {"status": "none"}


@app.post("/activate")
def activate_license(req: ActivateRequest):
    print(f"[DEBUG] License activation request - Guild: {req.guild_id}, Key: {req.key[:10]}...")
    
    # Verify password
    try:
        verify_password(req.password)
        print(f"[DEBUG] Password verification successful")
    except Exception as e:
        print(f"[DEBUG] Password verification failed: {e}")
        raise
    
    # Detect license key type
    is_payhip_key = re.match(r'^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$', req.key)
    license_type = "payhip" if is_payhip_key else "standard"
    print(f"[DEBUG] Detected license type: {license_type}")
    
    if is_payhip_key:
        # Handle Payhip license activation
        print(f"[DEBUG] Processing Payhip license key: {req.key}")
        
        # Check if this license key has already been used (one-time use enforcement)
        # Payhip licenses can only be used once - we don't store used keys but check existing guilds
        if is_payhip_license_already_used(req.key):
            print(f"[DEBUG] Payhip license key already used: {req.key}")
            raise HTTPException(status_code=400, detail="This license key has already been used. Payhip licenses can only be used once.")
        
        # Verify the Payhip license
        verification_result = verify_payhip_license(req.key)
        print(f"[DEBUG] Payhip verification result: {verification_result}")
        
        if not verification_result["valid"]:
            print(f"[DEBUG] Payhip license invalid: {verification_result.get('error', 'Unknown error')}")
            raise HTTPException(status_code=400, detail=f"Invalid Payhip license: {verification_result.get('error', 'License not found or invalid')}")
        
        # Note: 'enabled' field indicates if license is currently active
        # For new licenses, this may be False until first activation
        if not verification_result["enabled"]:
            print(f"[DEBUG] Payhip license not yet enabled, proceeding with activation")
        
        # Increase usage count
        usage_result = increase_payhip_license_usage(req.key)
        print(f"[DEBUG] Payhip usage increase result: {usage_result}")
        
        if not usage_result["success"]:
            print(f"[DEBUG] Failed to increase Payhip usage: {usage_result.get('error')}")
            # Continue anyway, as verification passed
        
        # Load servers data
        servers_data = load_servers()
        
        # Check if guild already has an active license (for stacking)
        existing_guild = None
        for guild in servers_data["guilds"]:
            if guild["id"] == req.guild_id:
                existing_guild = guild
                break
        
        # Payhip licenses get 30-day extensions
        duration = timedelta(days=30)
        
        if existing_guild:
            # Guild exists - extend the license (stacking)
            current_expiry = datetime.fromisoformat(existing_guild["expires_at"])
            # If license is expired, start from now, otherwise extend from current expiry
            start_time = max(datetime.utcnow(), current_expiry)
            new_expiry = start_time + duration
            existing_guild["expires_at"] = new_expiry.isoformat()
            print(f"[DEBUG] Extended existing guild license to: {new_expiry.isoformat()}")
        else:
            # New guild - create new entry
            new_expiry = datetime.utcnow() + duration
            new_guild = {
                "id": req.guild_id,
                "expires_at": new_expiry.isoformat()
            }
            servers_data["guilds"].append(new_guild)
            print(f"[DEBUG] Created new guild license expiring: {new_expiry.isoformat()}")
        
        # Save servers data
        save_servers(servers_data)
        
        final_expiry = existing_guild["expires_at"] if existing_guild else new_expiry.isoformat()
        print(f"[DEBUG] Payhip license activation successful - expires: {final_expiry}")
        return {
            "status": "activated", 
            "expires_at": final_expiry, 
            "message": "Payhip license activated successfully",
            "license_type": "payhip"
        }
    
    else:
        # Handle standard license activation
        print(f"[DEBUG] Processing standard license key: {req.key}")
        
        licenses_data = load_licenses()
        servers_data = load_servers()
        print(f"[DEBUG] Loaded {len(licenses_data['keys'])} available license keys")

        # Find the key in available licenses
        key_found = False
        key_duration = None
        key_source_file = None
        
        for lic in licenses_data["keys"]:
            if lic["key"] == req.key:
                key_found = True
                key_duration = lic["duration"]
                key_source_file = licenses_data["file_mapping"].get(req.key)
                print(f"[DEBUG] Found key with duration: {key_duration}, source file: {key_source_file}")
                break
        
        if not key_found:
            print(f"[DEBUG] Standard license key not found in available keys")
            raise HTTPException(status_code=400, detail="Invalid key")
        
        # Parse the duration
        try:
            duration = parse_time_string(key_duration)
            print(f"[DEBUG] Parsed duration: {duration}")
        except ValueError as e:
            print(f"[DEBUG] Failed to parse duration '{key_duration}': {e}")
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
            # Remove payhip_key if it exists (switching from Payhip to standard)
            if "payhip_key" in existing_guild:
                del existing_guild["payhip_key"]
            print(f"[DEBUG] Extended existing guild license to: {new_expiry.isoformat()}")
        else:
            # New guild - create new entry
            new_expiry = datetime.utcnow() + duration
            servers_data["guilds"].append({
                "id": req.guild_id,
                "expires_at": new_expiry.isoformat()
            })
            print(f"[DEBUG] Created new guild license expiring: {new_expiry.isoformat()}")
        
        # Remove the used key from its source file
        if key_source_file:
            try:
                remove_key_from_file(req.key, key_source_file)
                print(f"[DEBUG] Removed used key from source file: {key_source_file}")
            except Exception as e:
                print(f"[DEBUG] Failed to remove key from source file: {e}")
        else:
            print(f"[DEBUG] Warning: Could not find source file for key {req.key}")
        
        # Save servers data
        save_servers(servers_data)
        
        final_expiry = existing_guild["expires_at"] if existing_guild else new_expiry.isoformat()
        print(f"[DEBUG] Standard license activation successful - expires: {final_expiry}")
        return {
            "status": "activated", 
            "expires_at": final_expiry, 
            "message": "License key has been consumed",
            "license_type": "standard"
        }


# Removed /activate_payhip endpoint - now handled by unified /activate endpoint


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


@app.post("/cleanup")
def cleanup_servers(password: str):
    """Manually trigger cleanup of servers expired for more than 30 days"""
    # Verify password
    verify_password(password)
    
    removed_count = cleanup_expired_servers()
    return {"status": "ok", "removed_servers": removed_count, "message": f"Cleaned up {removed_count} expired servers"}


if __name__ == "__main__":
    # Cleanup expired servers on startup
    print("Performing startup cleanup of expired servers...")
    try:
        cleanup_expired_servers()
    except Exception as e:
        print(f"Error during startup cleanup: {e}")
    
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)