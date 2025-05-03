#!/usr/bin/env python3
import csv
import sys
from faker import Faker
import os

fake = Faker()

def generate_valid_participants(num_entries):
    participants = []
    for _ in range(num_entries):
        name = fake.name()
        email = fake.unique.email()
        phone = fake.msisdn()[0:15]
        university = fake.company()
        faculty = fake.word()
        major = fake.job()

        participant = {
            'name': name,
            'email': email,
            'phoneNumber': phone,
            'university': university,
            'faculty': faculty,
            'major': major,
        }
        participants.append(participant)
    return participants


if __name__ == "__main__":
    if len(sys.argv) not in [1, 2]:
        print("Usage: python faker.py [num_entries]")
        sys.exit(1)

    num_entries = 1000 
    if len(sys.argv) == 2:
        try:
            num_entries = int(sys.argv[1])
            if num_entries <= 0:
                raise ValueError
        except ValueError:
            print("Please provide a positive integer for num_entries.")
            sys.exit(1)

    participants_data = generate_valid_participants(num_entries)
    print(f"Generated {len(participants_data)} valid participants.")
    csv_file_path = "./valid_participants.csv"

    for i in range(1, 100):
        if not os.path.exists(csv_file_path):
            break
        csv_file_path = f"./valid_participants_{i}.csv"

    with open(csv_file_path, mode='w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=participants_data[0].keys())
        writer.writeheader()
        writer.writerows(participants_data)
    
    print(f"CSV file created: {csv_file_path}")
        
