# type: ignore

"""

    Tests for Netskrafl
    Copyright (C) 2021 Miðeind ehf.

    This module tests the chat functionality.

"""

import sys
import os
from typing import Any, Dict

import pytest

from flask import Response



# Make sure that we can run this test from the ${workspaceFolder}/test directory

SRC_PATH = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.append(SRC_PATH)

# Set up the environment for Explo-dev testing

os.environ[
    "GOOGLE_APPLICATION_CREDENTIALS"
] = "resources/Explo Development-414318fa79b8.json"
os.environ["SERVER_SOFTWARE"] = "Development"
os.environ["PROJECT_ID"] = "explo-dev"
os.environ["REDISHOST"] = "127.0.0.1"
os.environ["REDISPORT"] = "6379"
os.environ[
    "CLIENT_ID"
] = "970204261331-758cjav6i4lbiq1nemm6j8215omefqg3.apps.googleusercontent.com"
os.environ["FIREBASE_API_KEY"] = "AIzaSyCsNVCzDnAXo_cbViXl7fa5BYr_Wz6lFEc"
os.environ["FIREBASE_SENDER_ID"] = "970204261331"


@pytest.fixture
def client():
    """ Flask client fixture """
    import main

    main.app.config['TESTING'] = True
    main.app.testing = True

    with main.app.test_client() as client:
        yield client


def create_user(idx: int, locale: str = "en_US") -> str:
    """ Create a user instance for testing, if it doesn't already exist """
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
    """ Create a test user with no chat messages """
    return create_user(1)


@pytest.fixture
def u2() -> str:
    """ Create a test user with no chat messages """
    return create_user(2)


@pytest.fixture
def u3_uk() -> str:
    """ Create a test user in the en_UK locale """
    return create_user(3, "en_UK")


def login_user(client, idx: int) -> Response:
    idinfo: Dict[str, Any] = dict(
        sub=f"999999{idx}",
        # Full name of user
        name=f"Test user {idx}",
        # User image
        picture="",
        # Make sure that the e-mail address is in lowercase
        email=f"test{idx}@user.explo",
    )
    return client.post("/oauth2callback", data=idinfo)


def test_chat(client, u1, u2) -> None:
    """ Test the chat functionality """

    # Chat messages from user 1 to user 2

    resp = login_user(client, 1)
    resp = client.post(
        "/chatmsg", data=dict(channel="user:" + u2, msg="First chat message")
    )
    resp = client.post(
        "/chatmsg", data=dict(channel="user:" + u2, msg="Second chat message")
    )

    resp = client.post("/chatload", data=dict(channel="user:" + u2))
    assert resp.json["ok"]
    assert "messages" in resp.json
    messages = resp.json["messages"]
    len_1 = len(messages)
    assert len_1 == 2
    resp = client.post("/logout")

    # Chat messages from user 2 to user 1

    resp = login_user(client, 2)
    resp = client.post(
        "/chatmsg", data=dict(channel="user:" + u1, msg="First chat message")
    )
    resp = client.post(
        "/chatmsg", data=dict(channel="user:" + u1, msg="Second chat message")
    )

    resp = client.post("/chatload", data=dict(channel="user:" + u1))
    assert resp.json["ok"]
    assert "messages" in resp.json
    messages = resp.json["messages"]
    len_2 = len(messages)
    assert len_2 == len_1 + 2

    for m in messages:
        assert "from_userid" in m
        assert "name" in m
        assert "msg" in m
        assert "ts" in m
        assert "image" in m
        if m["from_userid"] == u1:
            assert m["name"] == "Test user 1"
        else:
            assert m["name"] == "Test user 2"

    resp = client.post("/chathistory")

    assert resp.json["ok"]
    assert "history" in resp.json
    history = resp.json["history"]

    for h in history:
        assert "user" in h
        assert "name" in h
        assert "image" in h
        assert "ts" in h
        assert "unread" in h


def test_locale_assets(client, u1, u3_uk):

    # Test default en_US user
    resp = login_user(client, 1)
    resp = client.post("/locale_asset", data=dict(asset="test_english.html"))
    assert resp.status_code == 200
    assert resp.content_type == "text/html; charset=utf-8"
    assert "American English" in resp.data.decode("utf-8")
    resp = client.post("/logout")

    # Test en_UK user
    resp = login_user(client, 3)
    resp = client.post("/locale_asset", data=dict(asset="test_english.html"))
    assert resp.status_code == 200
    assert resp.content_type == "text/html; charset=utf-8"
    assert "generic English" in resp.data.decode("utf-8")
    resp = client.post("/logout")
