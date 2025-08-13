from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import datetime, timedelta
import json
import os
import re

app = FastAPI()

LICENSE_FILE = "licenses.json"

# Если файл не существует — создаём пустой
if not os.path.exists(LICENSE_FILE):
    with open(LICENSE_FILE, "w") as f:
        json.dump({"keys": []}, f)


class ActivateRequest(BaseModel):
    guild_id: str
    key: str


def parse_time_string(time_str: str) -> timedelta:
    """
    Parse time string like '1m', '2h', '30d', '1y' into timedelta object
    Supported units: s (seconds), m (minutes), h (hours), d (days), w (weeks), y (years)
    """
    time_str = time_str.lower().strip()
    
    # Regular expression to match number + unit
    match = re.match(r'^(\d+)([smhdwy])$', time_str)
    if not match:
        raise ValueError(f"Invalid time format: {time_str}. Use format like '1m', '2h', '30d', etc.")
    
    amount, unit = match.groups()
    amount = int(amount)
    
    if unit == 's':  # seconds
        return timedelta(seconds=amount)
    elif unit == 'm':  # minutes
        return timedelta(minutes=amount)
    elif unit == 'h':  # hours
        return timedelta(hours=amount)
    elif unit == 'd':  # days
        return timedelta(days=amount)
    elif unit == 'w':  # weeks
        return timedelta(weeks=amount)
    elif unit == 'y':  # years (approximate)
        return timedelta(days=amount * 365)
    else:
        raise ValueError(f"Unsupported time unit: {unit}")


def load_licenses():
    with open(LICENSE_FILE, "r") as f:
        return json.load(f)


def save_licenses(data):
    with open(LICENSE_FILE, "w") as f:
        json.dump(data, f, indent=4)


@app.get("/check")
def check_license(guild_id: str):
    data = load_licenses()
    for lic in data["keys"]:
        if lic.get("guild_id") == guild_id:
            if datetime.utcnow() > datetime.fromisoformat(lic["expires_at"]):
                return {"status": "expired"}
            return {"status": "active", "expires_at": lic["expires_at"]}
    return {"status": "none"}


@app.post("/activate")
def activate_license(req: ActivateRequest):
    data = load_licenses()

    # Ищем ключ
    for lic in data["keys"]:
        if lic["key"] == req.key and "guild_id" not in lic:
            # Привязываем ключ
            lic["guild_id"] = req.guild_id

            # Парсим время из строки и устанавливаем срок действия
            try:
                duration = parse_time_string(lic["duration"])
                lic["expires_at"] = (datetime.utcnow() + duration).isoformat()
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

            save_licenses(data)
            return {"status": "active", "expires_at": lic["expires_at"]}

        elif lic["key"] == req.key and lic.get("guild_id"):
            raise HTTPException(status_code=400, detail="Key already used")

    raise HTTPException(status_code=404, detail="Invalid key")


# Для теста — добавить ключ вручную
@app.post("/add_key")
def add_key(key: str, duration: str):
    # Validate duration format
    try:
        parse_time_string(duration)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    data = load_licenses()
    data["keys"].append({"key": key, "duration": duration})
    save_licenses(data)
    return {"status": "ok"}