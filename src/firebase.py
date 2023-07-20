"""

    Firebase wrapper for Netskrafl

    Copyright (C) 2023 Miðeind ehf.
    Original author: Vilhjálmur Þorsteinsson

    The Creative Commons Attribution-NonCommercial 4.0
    International Public License (CC-BY-NC 4.0) applies to this software.
    For further information, see https://github.com/mideind/Netskrafl

    This module implements a thin wrapper around the Google Firebase
    functionality used to send push notifications to clients.

"""

from __future__ import annotations

from typing import (
    Any,
    Mapping,
    Optional,
    Sequence,
    List,
    TypedDict,
    Union,
    Tuple,
    Set,
    Dict,
    cast,
)

import json
import threading
import logging
import socket
from datetime import datetime, timedelta

import httplib2  # type: ignore

from oauth2client.client import GoogleCredentials  # type: ignore

from firebase_admin import App, initialize_app, auth, messaging  # type: ignore
from firebase_admin.exceptions import FirebaseError  # type: ignore

from config import PROJECT_ID, FIREBASE_DB_URL
from cache import memcache


ResponseType = Tuple[httplib2.Response, bytes]


class PushMessageDict(TypedDict, total=False):

    """A message to be sent to a device via a push notification"""

    title: str
    body: str
    image: str  # Image URL


_FIREBASE_SCOPES: Sequence[str] = [
    "https://www.googleapis.com/auth/firebase.database",
    "https://www.googleapis.com/auth/userinfo.email",
]
_TIMEOUT: int = 15  # Seconds

_LIFETIME_MEMORY_CACHE = 1  # Minutes
_LIFETIME_REDIS_CACHE = 5  # Minutes

_HEADERS: Mapping[str, str] = {
    "Connection": "keep-alive",
    "Content-Type": "application/json",
}

_USERLIST_LOCK = threading.Lock()

# Initialize thread-local storage
_tls = threading.local()

_firebase_app: Optional[App] = None
_firebase_app_lock = threading.Lock()


def _get_http() -> Optional[httplib2.Http]:
    """Provides an authorized HTTP object, one per thread"""
    http: Optional[httplib2.Http] = getattr(_tls, "_HTTP", None)
    if http is None:
        http = cast(Any, httplib2).Http(timeout=_TIMEOUT)
        # Use application default credentials to make the Firebase calls
        # https://firebase.google.com/docs/reference/rest/database/user-auth
        creds = (
            cast(Any, GoogleCredentials)
            .get_application_default()
            .create_scoped(_FIREBASE_SCOPES)
        )
        creds.authorize(http)
        creds.refresh(http)
        _tls._HTTP = http
    return http


def _request(*args: Any, **kwargs: Any) -> ResponseType:
    """Attempt to post a Firebase request, with recovery on a ConnectionError"""
    MAX_ATTEMPTS = 2
    attempts = 0
    response: httplib2.Response
    content: bytes
    while attempts < MAX_ATTEMPTS:
        try:
            if (http := _get_http()) is None:
                raise ValueError("Unable to obtain http object")
            response, content = cast(
                ResponseType, cast(Any, http).request(*args, headers=_HEADERS, **kwargs)
            )
            assert isinstance(content, bytes)
            return response, content
        except ConnectionError:
            # Note that BrokenPipeError is a subclass of ConnectionError
            if attempts == MAX_ATTEMPTS - 1:
                # Give up and re-raise the original exception
                raise
            # Attempt recovery by creating a new httplib2.Http object and
            # forcing re-generation of the credentials
            _tls._HTTP = None
        except socket.timeout:
            # socket.timeout is not a subclass of ConnectionError
            # Make another attempt, then give up
            if attempts == MAX_ATTEMPTS - 1:
                # Give up and re-raise the original exception
                raise
        # Try again
        attempts += 1
    # Should not get here
    assert False, "Unexpected fall out of loop in firebase._request()"


def _init_firebase_app():
    """Initialize a global Firebase app instance"""
    global _firebase_app
    with _firebase_app_lock:
        if _firebase_app is None:
            _firebase_app = initialize_app(
                options=dict(projectId=PROJECT_ID, databaseURL=FIREBASE_DB_URL)
            )


def _firebase_put(path: str, message: Optional[str] = None) -> ResponseType:
    """Writes data to Firebase.
    An HTTP PUT writes an entire object at the given database path. Updates to
    fields cannot be performed without overwriting the entire object
    Args:
        path - the url to the Firebase object to write.
        value - a json string.
    """
    return _request(path, method="PUT", body=message)


def _firebase_get(path: str) -> ResponseType:
    """Read the data at the given path.
    An HTTP GET request allows reading of data at a particular path.
    A successful request will be indicated by a 200 OK HTTP status code.
    The response will contain the data being retrieved.
    Args:
        path - the url to the Firebase object to read.
    """
    return _request(path, method="GET")


def _firebase_patch(path: str, message: str) -> ResponseType:
    """Update the data at the given path.
    An HTTP GET request allows reading of data at a particular path.
    A successful request will be indicated by a 200 OK HTTP status code.
    The response will contain the data being retrieved.
    Args:
        path - the url to the Firebase object to read.
    """
    return _request(path, method="PATCH", body=message)


def _firebase_delete(path: str) -> ResponseType:
    """Delete the data at the given path.
    An HTTP DELETE request allows deleting of the data at the given path.
    A successful request will be indicated by a 200 OK HTTP status code.
    Args:
        path - the url to the Firebase object to delete.
    """
    return _request(path, method="DELETE")


def send_message(message: Optional[Mapping[str, Any]], *args: str) -> bool:
    """Updates data in Firebase. If a message object is provided, then it updates
    the data at the given location (whose path is built as a concatenation
    of the *args list) with the message using the PATCH http method.
    If no message is provided, the data at this location is deleted
    using the DELETE http method.
    """
    try:
        if args:
            url = "/".join((FIREBASE_DB_URL,) + args) + ".json"
        else:
            url = f"{FIREBASE_DB_URL}/.json"
        if message is None:
            response, _ = _firebase_delete(path=url)
        else:
            response, _ = _firebase_patch(
                path=f"{url}?print=silent", message=json.dumps(message)
            )
        # If all is well and good, "200" (OK) or "204" (No Content)
        # is returned in the status field
        return response["status"] in ("200", "204")
    except httplib2.HttpLib2Error as e:
        logging.warning(f"Exception [{repr(e)}] in firebase.send_message()")
        return False


def put_message(message: Optional[Mapping[str, Any]], *args: str) -> bool:
    """Updates data in Firebase. If a message object is provided, then it sets
    the data at the given location (whose path is built as a concatenation
    of the *args list) with the message using the PUT http method.
    If no message is provided, the data at this location is deleted
    using the DELETE http method.
    """
    try:
        if args:
            url = "/".join((FIREBASE_DB_URL,) + args) + ".json"
        else:
            url = f"{FIREBASE_DB_URL}/.json"
        if message is None:
            response, _ = _firebase_delete(path=url)
        else:
            response, _ = _firebase_put(
                path=f"{url}?print=silent", message=json.dumps(message)
            )
        # If all is well and good, "200" (OK) or "204" (No Content)
        # is returned in the status field
        return response["status"] in ("200", "204")
    except httplib2.HttpLib2Error as e:
        logging.warning(f"Exception [{repr(e)}] in firebase.put_message()")
        return False


def send_update(*args: str) -> bool:
    """Updates the path endpoint to contain the current UTC timestamp"""
    if not args:
        return False
    endpoint = args[-1]
    value = {endpoint: datetime.utcnow().isoformat()}
    return send_message(value, *args[:-1])


def check_wait(user_id: str, opp_id: str, key: Optional[str]) -> bool:
    """Return True if the user user_id is waiting for the opponent opponent_id,
    on the challenge key, if given."""
    try:
        url = f"{FIREBASE_DB_URL}/user/{user_id}/wait/{opp_id}.json"
        response, body = _firebase_get(path=url)
        if response["status"] != "200":
            return False
        msg = json.loads(body) if body else None
        if msg is True:
            # The Firebase endpoint is set to True, meaning the user is waiting
            return True
        # Alternatively, the firebase endpoint may contain a key of the original challenge.
        # However, if it also contains a game id, the game has already been started
        # and the user is no longer waiting.
        if key is not None and isinstance(msg, dict):
            msg_dict = cast(Dict[str, str], msg)
            if "game" not in msg_dict and key == msg_dict.get("key"):
                return True
        return False
    except (httplib2.HttpLib2Error, ValueError) as e:
        logging.warning(f"Exception [{repr(e)}] raised in firebase.check_wait()")
        return False


def check_presence(user_id: str, locale: str) -> bool:
    """Check whether the given user has at least one active connection"""
    try:
        url = f"{FIREBASE_DB_URL}/connection/{locale}/{user_id}.json"
        response, body = _firebase_get(path=url)
        if response["status"] != "200":
            return False
        msg = json.loads(body) if body else None
        return bool(msg)
    except (httplib2.HttpLib2Error, ValueError) as e:
        logging.warning(f"Exception [{repr(e)}] raised in firebase.check_presence()")
        return False


def get_connected_users(locale: str) -> Set[str]:
    """Return a set of all presently connected users"""
    with _USERLIST_LOCK:
        # Serialize access to the connected user list
        url = f"{FIREBASE_DB_URL}/connection/{locale}.json?shallow=true"
        try:
            response, body = _firebase_get(path=url)
        except httplib2.HttpLib2Error as e:
            logging.warning(
                f"Exception [{repr(e)}] raised in firebase.get_connected_users()"
            )
            return set()
        if response["status"] != "200":
            return set()
        msg = json.loads(body) if body else None
        if not msg:
            return set()
        return set(msg.keys())


def create_custom_token(uid: str, valid_minutes: int = 60) -> str:
    """Create a secure token for the given id.
    This method is used to create secure custom JWT tokens to be passed to
    clients. It takes a unique id that will be used by Firebase's
    security rules to prevent unauthorized access."""
    # Make sure that the Firebase app instance has been initialized
    _init_firebase_app()
    attempts = 0
    MAX_ATTEMPTS = 2
    while attempts < MAX_ATTEMPTS:
        try:
            return cast(Any, auth).create_custom_token(uid).decode()
        except:
            # It appears that ConnectionResetError exceptions can
            # propagate (wrapped in an obscure Firebase object) from
            # the call to create_custom_token()
            if attempts == MAX_ATTEMPTS - 1:
                raise
        attempts += 1
    assert False, "Unexpected fall out of loop in firebase.create_custom_token()"


_online_cache: Dict[str, Set[str]] = dict()
_online_ts: Dict[str, datetime] = dict()


def online_users(locale: str) -> Set[str]:
    """Obtain a set of online users, by their user ids"""

    global _online_cache, _online_ts

    # First, use a per-process in-memory cache, having a lifetime of 1 minute
    now = datetime.utcnow()
    if (
        locale in _online_ts
        and locale in _online_cache
        and _online_ts[locale] > now - timedelta(minutes=_LIFETIME_MEMORY_CACHE)
    ):
        return _online_cache[locale]

    # Second, use the distributed Redis cache, having a lifetime of 5 minutes
    online: Union[Set[str], List[str]] = memcache.get(
        "live:" + locale, namespace="userlist"
    )

    if not online:
        # Not found: do a Firebase query, which returns a set
        online = get_connected_users(locale)
        # Store the result as a list in the Redis cache, with a timeout
        memcache.set(
            "live:" + locale,
            list(online),
            time=_LIFETIME_REDIS_CACHE * 60,
            namespace="userlist",
        )
    else:
        # Convert the cached list back into a set
        online = set(online)

    _online_cache[locale] = online
    _online_ts[locale] = now
    return online


def push_notification(device_token: str, message: PushMessageDict) -> bool:
    """Send a Firebase push notification to a particular device,
    identified by device token. The message is a dictionary that
    contains a title and a body."""
    if not device_token:
        return False
    if _firebase_app is None:
        _init_firebase_app()

    # Construct the message
    msg = messaging.Message(
        notification=messaging.Notification(**message),
        token=device_token,
    )

    # Send the message
    try:
        message_id: str = cast(Any, messaging).send(msg, app=_firebase_app)
        # The response is a message ID string
        return bool(message_id)
    except (FirebaseError, ValueError) as e:
        logging.warning(f"Exception [{repr(e)}] raised in firebase.push_notification()")

    return False


def push_to_user(user_id: str, message: PushMessageDict) -> bool:
    """Send a Firebase push notification to a particular user,
    identified by user id. The message is a dictionary that
    contains a title and a body."""
    if not user_id:
        return False
    # A user's sessions are found under the /session/<user_id> path,
    # containing 0..N sessions. Each session has a token as its key,
    # and contains a dictionary with the OS and the timestamp of the session.
    # We need to iterate over all sessions and send the message to each
    # device token.
    try:
        url = f"{FIREBASE_DB_URL}/session/{user_id}.json"
        response, body = _firebase_get(path=url)
        if response["status"] != "200":
            return False
        msg = json.loads(body) if body else None
        if not msg:
            return False
        # We don't send notifications to sessions that are older than 7 days
        cutoff = datetime.utcnow() - timedelta(days=7)
        # msg is a dictionary of device tokens : { os, utc }
        device_token: str
        device_info: Mapping[str, str]
        for device_token, device_info in msg.items():
            # os = device_info.get("os") or ""
            if not isinstance(device_info, dict):
                continue
            utc = device_info.get("utc") or ""
            if not utc:
                continue
            # Format the string so that Python can parse it
            utc = utc[0:19]
            if datetime.fromisoformat(utc) < cutoff:
                # The device token is too old
                logging.info("Skipping notification, session token is too old")
                # continue
            push_notification(device_token, message)
        return True
    except (httplib2.HttpLib2Error, ValueError) as e:
        logging.warning(f"Exception [{repr(e)}] raised in firebase.push_to_user()")
        return False
