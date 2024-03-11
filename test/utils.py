"""

    Utility functions for testing Netskrafl / Explo Word Game
    Copyright (C) 2024 Miðeind ehf.

    This module contains utility functions for the test suite.

"""

from typing import Any, Dict, Generator

import sys
import os
import zlib

import pytest

from flask.testing import FlaskClient
from werkzeug.test import TestResponse
from itsdangerous import base64_decode


# Make sure that we can run this test from the ${workspaceFolder}/test directory
SRC_PATH = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.append(SRC_PATH)
THIS_PATH = os.path.dirname(__file__)
sys.path.append(THIS_PATH)

# Bearer token for testing
TEST_SECRET = "testsecret"

# Set up the environment for Explo-dev testing
os.environ["PROJECT_ID"] = "explo-dev"
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = (
    "resources/Explo Development-414318fa79b8.json"
)
os.environ["SERVER_SOFTWARE"] = "Development"
os.environ["REDISHOST"] = "127.0.0.1"
os.environ["REDISPORT"] = "6379"


# Create a custom test client class that can optionally
# include authorization headers in the requests
class CustomClient(FlaskClient):

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.send_authorization = False
        super().__init__(*args, **kwargs)

    def open(self, *args: Any, **kwargs: Any) -> TestResponse:
        hcopy = kwargs.copy()
        if self.send_authorization:
            if "headers" not in hcopy:
                hcopy["headers"] = {}
            # Add the Authorization header to the request
            hcopy["headers"]["Authorization"] = "Bearer " + TEST_SECRET
        return super().open(*args, **hcopy)

    def set_authorization(self, send_authorization: bool) -> None:
        self.send_authorization = send_authorization


@pytest.fixture
def client() -> Generator[CustomClient, Any, Any]:
    """Flask client fixture"""
    import main

    main.app.config["TESTING"] = True
    main.app.config["AUTH_SECRET"] = TEST_SECRET
    main.app.testing = True

    main.app.test_client_class = CustomClient

    with main.app.test_client() as client:
        assert isinstance(client, CustomClient)
        yield client


def create_user(idx: int, locale: str = "en_US") -> str:
    """Create a user instance for testing, if it doesn't already exist"""
    from skrafldb import UserModel, ChatModel, Client
    from skraflgame import PrefsDict

    with Client.get_context():
        nickname = f"testuser{idx}"
        email = f"test{idx}@user.explo"
        name = f"Test user {idx}"
        account = f"999999{idx}"
        image = ""
        prefs: PrefsDict = {"newbag": True, "email": email, "full_name": name}
        # Delete chat messages for this user
        ChatModel.delete_for_user(account)
        # Create a new user, if required
        return UserModel.create(
            user_id=account,
            account=account,
            email=email,
            nickname=nickname,
            image=image,
            preferences=prefs,
            locale=locale,
        )


@pytest.fixture
def u1() -> str:
    """Create a test user with no chat messages"""
    return create_user(1)


@pytest.fixture
def u2() -> str:
    """Create a test user with no chat messages"""
    return create_user(2)


@pytest.fixture
def u3_gb() -> str:
    """Create a test user in the en_GB locale"""
    return create_user(3, "en_GB")


def login_user(
    client: CustomClient, idx: int, client_type: str = "web"
) -> TestResponse:
    rq: Dict[str, Any] = dict(
        sub=f"999999{idx}",
        # Full name of user
        name=f"Test user {idx}",
        # User image
        picture="",
        # Make sure that the e-mail address is in lowercase
        email=f"test{idx}@user.explo",
        # Client type
        clientType=client_type,
    )
    return client.post("/oauth2callback", data=rq)


def login_anonymous_user(
    client: CustomClient,
    idx: int,
    client_type: str = "web",
    locale: str = "en_US",
) -> TestResponse:
    """Log in an anonymous user with the specified client type and locale, associated with a
    device ID of the form 'device999999N', where N is the user index."""
    rq: Dict[str, Any] = dict(
        sub=f"device999999{idx}",
        # Client type
        clientType=client_type,
        # Locale
        locale=locale,
    )
    # POST the rq dictionary to the /oauth_anon endpoint as JSON
    return client.post("/oauth_anon", json=rq)


def decode_cookie(cookie: str) -> str:
    """Decode a Flask cookie string"""
    payload = cookie
    if compressed := payload.startswith("."):
        payload = payload[1:]
    data = payload.split(".")[0]
    data = base64_decode(data)
    if compressed:
        data = zlib.decompress(data)
    return data.decode("utf-8")
