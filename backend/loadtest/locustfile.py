"""Locust load test against the Medicare Excellence Flask API.

Run against a locally running instance, e.g.:

    MONGO_DB_NAME=MediBotDB_loadtest gunicorn -w 4 -b 127.0.0.1:5055 app:app &
    locust -f loadtest/locustfile.py --host=http://127.0.0.1:5055 \
        --headless -u 20 -r 5 -t 30s --csv=loadtest/results
"""

import uuid

from locust import HttpUser, between, task


class ApiUser(HttpUser):
    wait_time = between(0.1, 0.5)

    def on_start(self):
        self.email = f"loadtest-{uuid.uuid4().hex[:12]}@example.com"
        self.password = "secret123"
        self.client.post(
            "/signup",
            json={
                "name": "Load Test User",
                "email": self.email,
                "password": self.password,
                "role": "patient",
                "dob": "1995-05-01",
                "gender": "female",
            },
        )
        response = self.client.post("/login", json={"email": self.email, "password": self.password})
        self.token = response.json().get("token") if response.ok else None

    @task(5)
    def health_check(self):
        self.client.get("/")

    @task(3)
    def login(self):
        self.client.post("/login", json={"email": self.email, "password": self.password})

    @task(2)
    def me(self):
        if self.token:
            self.client.get("/me", headers={"Authorization": f"Bearer {self.token}"})
