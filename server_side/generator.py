#!/usr/bin/env python3
"""
License Key Generator
Generates random license keys with specified duration and saves them to generator.json
"""

import json
import random
import string
import os

def generate_random_key(length=16):
    """Generate a random hexadecimal key"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

def validate_duration(duration):
    """Validate duration format (e.g., 7d, 30d, 1y)"""
    import re
    pattern = r'^\d+[smhdwy]$'
    return bool(re.match(pattern, duration.lower()))

def main():
    print("License Key Generator")
    print("====================")
    
    # Get number of keys
    while True:
        try:
            num_keys = int(input("How many keys do you want to generate? "))
            if num_keys > 0:
                break
            else:
                print("Please enter a positive number.")
        except ValueError:
            print("Please enter a valid number.")
    
    # Get duration
    while True:
        duration = input("Enter duration (e.g., 7d, 30d, 1y): ").strip()
        if validate_duration(duration):
            break
        else:
            print("Invalid duration format. Use format like: 7d, 30d, 1h, 1y")
    
    # Generate keys
    keys = []
    for i in range(num_keys):
        key = generate_random_key()
        keys.append({
            "key": key,
            "duration": duration
        })
    
    # Create the data structure
    data = {
        "keys": keys
    }
    
    # Save to generator.json
    output_file = "generator.json"
    with open(output_file, "w") as f:
        json.dump(data, f, indent=4)
    
    print(f"\nGenerated {num_keys} keys with duration '{duration}'")
    print(f"Keys saved to: {output_file}")
    print("\nGenerated keys:")
    for i, key_data in enumerate(keys, 1):
        print(f"{i:3d}. {key_data['key']} ({key_data['duration']})")

if __name__ == "__main__":
    main()