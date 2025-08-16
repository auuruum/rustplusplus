#!/usr/bin/env python3
import json
import os

def main():
    # Path to generator.json
    script_dir = os.path.dirname(os.path.abspath(__file__))
    json_file = os.path.join(script_dir, "generator.json")
    
    if not os.path.exists(json_file):
        print(f"Error: '{json_file}' not found.")
        return
    
    # Load JSON
    with open(json_file, "r") as f:
        data = json.load(f)
    
    # Print keys with literal \n
    for key_data in data.get("keys", []):
        print(f"Here is your license key \\n {key_data['key']}")

if __name__ == "__main__":
    main()
