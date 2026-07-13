import uuid


def _unique_email():
    return f"test-{uuid.uuid4().hex[:12]}@example.com"


def test_health_check(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"


def test_signup_creates_patient_account(client):
    email = _unique_email()
    response = client.post(
        "/signup",
        json={
            "name": "Test Patient",
            "email": email,
            "password": "secret123",
            "role": "patient",
            "dob": "1995-05-01",
            "gender": "female",
        },
    )
    assert response.status_code == 201
    body = response.get_json()
    assert body["role"] == "patient"
    assert body["user"]["email"] == email
    assert "token" in body


def test_signup_duplicate_email_is_rejected(client):
    email = _unique_email()
    payload = {
        "name": "Test Patient",
        "email": email,
        "password": "secret123",
        "role": "patient",
        "dob": "1995-05-01",
        "gender": "female",
    }
    first = client.post("/signup", json=payload)
    assert first.status_code == 201

    second = client.post("/signup", json=payload)
    assert second.status_code == 409


def test_signup_missing_password_returns_validation_error(client):
    response = client.post(
        "/signup",
        json={"name": "Test Patient", "email": _unique_email(), "role": "patient"},
    )
    assert response.status_code == 400


def test_login_with_correct_credentials_returns_token(client):
    email = _unique_email()
    client.post(
        "/signup",
        json={
            "name": "Test Patient",
            "email": email,
            "password": "secret123",
            "role": "patient",
            "dob": "1995-05-01",
            "gender": "female",
        },
    )

    response = client.post("/login", json={"email": email, "password": "secret123"})
    assert response.status_code == 200
    body = response.get_json()
    assert "token" in body
    assert body["user"]["email"] == email


def test_login_with_wrong_password_is_unauthorized(client):
    email = _unique_email()
    client.post(
        "/signup",
        json={
            "name": "Test Patient",
            "email": email,
            "password": "secret123",
            "role": "patient",
            "dob": "1995-05-01",
            "gender": "female",
        },
    )

    response = client.post("/login", json={"email": email, "password": "wrong-password"})
    assert response.status_code == 401


def test_login_unknown_email_is_unauthorized(client):
    response = client.post("/login", json={"email": _unique_email(), "password": "secret123"})
    assert response.status_code == 401


def test_me_endpoint_requires_authentication(client):
    response = client.get("/me")
    assert response.status_code == 401


def test_me_endpoint_returns_current_user_with_valid_token(client):
    email = _unique_email()
    signup_response = client.post(
        "/signup",
        json={
            "name": "Test Patient",
            "email": email,
            "password": "secret123",
            "role": "patient",
            "dob": "1995-05-01",
            "gender": "female",
        },
    )
    token = signup_response.get_json()["token"]

    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.get_json()
    assert body["user"]["email"] == email


def test_me_endpoint_rejects_garbage_token(client):
    response = client.get("/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401
