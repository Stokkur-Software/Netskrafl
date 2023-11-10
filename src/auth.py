"""

    Authentication module for netskrafl.is

    Copyright (C) 2023 Miðeind ehf.
    Original author: Vilhjálmur Þorsteinsson

    The Creative Commons Attribution-NonCommercial 4.0
    International Public License (CC-BY-NC 4.0) applies to this software.
    For further information, see https://github.com/mideind/Netskrafl


    This module contains functions for various types of user authentication,
    originating in web or app clients.

"""

from __future__ import annotations
from functools import lru_cache

from typing import cast, Any, Optional, Dict

from datetime import datetime

import requests
import cachecontrol  # type: ignore
import jwt

from flask.wrappers import Request
from flask.globals import current_app

from google.oauth2 import id_token  # type: ignore
from google.auth.transport import requests as google_requests  # type: ignore
from google.auth.exceptions import GoogleAuthError  # type: ignore

from config import (
    CLIENT,
    DEFAULT_LOCALE,
    FACEBOOK_APP_SECRET,
    FACEBOOK_APP_ID,
    APPLE_CLIENT_ID,
    PROJECT_ID,
    DEV_SERVER,
)
from basics import jsonify, UserIdDict, ResponseType, set_session_userid, RequestData

from skrafluser import User, UserLoginDict, verify_explo_token

# URL to validate Facebook login token, in /oauth_fb endpoint
FACEBOOK_TOKEN_VALIDATION_URL = (
    "https://graph.facebook.com/debug_token?input_token={0}&access_token={1}|{2}"
)

# Apple public key and JWT stuff
APPLE_TOKEN_VALIDATION_URL = "https://appleid.apple.com/auth/token"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

# Establish a cached session to communicate with the Google API
session = requests.session()
cached_session: Any = cast(Any, cachecontrol).CacheControl(session)
google_request = google_requests.Request(session=cached_session)


def oauth2callback(request: Request) -> ResponseType:
    # Note that HTTP GETs to the /oauth2callback URL are handled in web.py,
    # this route is only for HTTP POSTs

    if not CLIENT:
        # Something is wrong in the internal setup of the server
        # (missing setting in client_secret_*.json)
        # 500 - Internal server error
        return jsonify({"status": "invalid", "msg": "Missing CLIENT"}), 500

    if DEV_SERVER:
        # The 'fail' parameter is used for testing purposes only.
        # If sent by the client, we respond with the error code requested.
        fail = request.form.get("fail", "") or cast(Any, request).json.get(
            "fail", ""
        )
        if fail:
            try:
                fail_code = int(fail) if len(fail) <= 3 else 0
            except ValueError:
                fail_code = 0
            if fail_code:
                return jsonify({"status": "invalid", "msg": "Testing failure"}), fail_code

    token: str
    config = cast(Any, current_app).config
    testing: bool = config.get("TESTING", False)
    client_type: str = "web"  # Default client type

    if testing:
        # Testing only: there is no token in the request
        token = ""
    else:
        token = request.form.get("idToken", "") or cast(Any, request).json.get(
            "idToken", ""
        )
        if not token:
            # No authentication token included in the request
            # 400 - Bad Request
            return jsonify({"status": "invalid", "msg": "Missing token"}), 400
        client_type = (
            request.form.get("clientType", "")
            or (
                request.json is not None
                and cast(Dict[str, str], request.json).get("clientType", "")
            )
            or "web"
        )

    client_id = CLIENT.get(client_type, {}).get("id", "")
    if not client_id:
        # Unknown client type (should be one of 'web', 'ios', 'android')
        # 400 - Bad Request
        return jsonify({"status": "invalid", "msg": "Unknown client type"}), 400

    uld: Optional[UserLoginDict] = None
    account: Optional[str] = None
    userid: Optional[str] = None
    idinfo: Optional[UserIdDict] = None
    email: Optional[str] = None
    image: Optional[str] = None
    name: Optional[str] = None

    try:
        if testing:
            # Get the idinfo dictionary directly from the request
            f = cast(Dict[str, str], request.form)
            idinfo = UserIdDict(
                iss="accounts.google.com",
                sub=f["sub"],
                name=f["name"],
                picture=f["picture"],
                email=f["email"],
                method="Test",
                account=f["sub"],
                locale=DEFAULT_LOCALE,
                new=False,
                client_type=client_type,
            )
        else:
            # Verify the token and extract its claims
            idinfo = id_token.verify_oauth2_token(  # type: ignore
                token, google_request, client_id
            )
            if idinfo is None:
                raise ValueError("Invalid Google token")
        # ID token is valid; extract the claims
        # Get the user's Google Account ID
        account = idinfo.get("sub")
        if account:
            # Full name of user
            name = idinfo.get("name")
            # User image
            image = idinfo.get("picture")
            # Make sure that the e-mail address is in lowercase
            email = idinfo.get("email", "").lower()
            # Attempt to find an associated user record in the datastore,
            # or create a fresh user record if not found
            locale = (idinfo.get("locale") or DEFAULT_LOCALE).replace("-", "_")
            uld = User.login_by_account(
                account, name or "", email or "", image or "", locale=locale
            )
            # Store login data where we'll find it again, and return
            # some of it back to the client
            userid = uld["user_id"]
            uld["method"] = idinfo["method"] = "Google"
            idinfo["account"] = uld["account"]
            idinfo["locale"] = uld["locale"]
            idinfo["new"] = uld["new"]
            idinfo["client_type"] = client_type

    except (KeyError, ValueError) as e:
        # Invalid token
        # 401 - Unauthorized
        return jsonify({"status": "invalid", "msg": str(e)}), 401

    except GoogleAuthError as e:
        return jsonify({"status": "invalid", "msg": str(e)}), 401

    if not userid or uld is None:
        # Unable to obtain the user id for some reason
        # 401 - Unauthorized
        return jsonify({"status": "invalid", "msg": "Unable to obtain user id"}), 401

    # Authentication complete; user id obtained
    # Set a session cookie
    set_session_userid(userid, idinfo)
    # Send a bunch of login data back to the client via the UserLoginDict instance
    return jsonify(dict(status="success", **uld))


def oauth_fb(request: Request) -> ResponseType:
    """Facebook authentication"""
    # The 'fail' parameter is used for testing purposes only.
    # If sent by the client, we always respond with a 401 Not Authorized.
    if DEV_SERVER:
        # The 'fail' parameter is used for testing purposes only.
        # If sent by the client, we respond with the error code requested.
        fail = request.form.get("fail", "") or cast(Any, request).json.get(
            "fail", ""
        )
        if fail:
            try:
                fail_code = int(fail) if len(fail) <= 3 else 0
            except ValueError:
                fail_code = 0
            if fail_code:
                return jsonify({"status": "invalid", "msg": "Testing failure"}), fail_code

    rq = RequestData(request)
    user: Optional[Dict[str, str]] = rq.get("user")
    if user is None or not (account := user.get("id", "")):
        return jsonify({"status": "invalid", "msg": "Unable to obtain user id"}), 401

    token = user.get("token", "")
    # Validate the Facebook token
    if not token or len(token) > 1024 or not token.isalnum():
        return jsonify({"status": "invalid", "msg": "Invalid Facebook token"}), 401
    r = requests.get(
        FACEBOOK_TOKEN_VALIDATION_URL.format(
            token, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
        )
    )
    if r.status_code != 200:
        # Error from the Facebook API: communicate it back to the client
        msg = ""
        try:
            msg = cast(Any, r).json()["error"]["message"]
            msg = f": {msg}"
        except (KeyError, ValueError):
            pass
        return (
            jsonify(
                {"status": "invalid", "msg": f"Unable to verify Facebook token{msg}"}
            ),
            401,
        )
    # So far, so good: double check that token data are as expected
    name = user.get("full_name", "")
    image = user.get("image", "")
    email = user.get("email", "").lower()
    response: Dict[str, Any] = cast(Any, r).json()
    if not response or not (rd := response.get("data")):
        return (
            jsonify(
                {"status": "invalid", "msg": "Invalid format of Facebook token data"}
            ),
            401,
        )
    if (
        FACEBOOK_APP_ID != rd.get("app_id")
        or "USER" != rd.get("type")
        or not rd.get("is_valid")
    ):
        return (
            jsonify({"status": "invalid", "msg": "Facebook token data mismatch"}),
            401,
        )
    if account != rd.get("user_id"):
        return (
            jsonify({"status": "invalid", "msg": "Wrong user id in Facebook token"}),
            401,
        )
    # Make sure that Facebook account ids are different from Google/OAuth ones
    # by prefixing them with 'fb:'
    account = "fb:" + account
    # Login or create the user in the Explo user model
    locale = (rq.get("locale") or DEFAULT_LOCALE).replace("-", "_")
    uld = User.login_by_account(account, name, email, image, locale=locale)
    userid = uld.get("user_id") or ""
    uld["method"] = "Facebook"
    # Emulate the OAuth idinfo
    idinfo = UserIdDict(
        iss="accounts.facebook.com",
        sub=account,
        name=name,
        picture=image,
        email=email,
        method="Facebook",
        account=account,
        locale=uld.get("locale", DEFAULT_LOCALE),
        new=uld.get("new") or False,
        client_type=rq.get("clientType") or "web",
    )
    # Set the Flask session token
    set_session_userid(userid, idinfo)
    # Send a bunch of login data back to the client via the UserLoginDict instance
    return jsonify(dict(status="success", **uld))


@lru_cache(maxsize=1)
def _apple_key_client(day: datetime) -> jwt.PyJWKClient:
    """Return a cached Apple client secret. The secret is calculated
    once per day and is valid for 180 days (6 months),
    which is the maximum allowed."""
    return jwt.PyJWKClient(APPLE_JWKS_URL)


def oauth_apple(request: Request) -> ResponseType:
    """Apple ID token validation"""

    if DEV_SERVER:
        # The 'fail' parameter is used for testing purposes only.
        # If sent by the client, we respond with the error code requested.
        fail = request.form.get("fail", "") or cast(Any, request).json.get(
            "fail", ""
        )
        if fail:
            try:
                fail_code = int(fail) if len(fail) <= 3 else 0
            except ValueError:
                fail_code = 0
            if fail_code:
                return jsonify({"status": "invalid", "msg": "Testing failure"}), fail_code

    rq = RequestData(request)
    token = rq.get("token", "")
    if not token:
        return jsonify({"status": "invalid", "msg": "Missing token"}), 401
    now = datetime.utcnow()
    today = datetime(now.year, now.month, now.day)

    try:
        signing_key = _apple_key_client(today).get_signing_key_from_jwt(token)
        # The decode() function raises an exception if the token
        # is incorrectly signed or does not contain the required claims
        payload = jwt.decode(  # type: ignore
            token,
            cast(Any, signing_key).key,
            algorithms=["RS256"], # Apple only supports RS256
            issuer=APPLE_ISSUER,
            audience=APPLE_CLIENT_ID,
            options={"require": ["iss", "sub", "email"]},
        )
    except Exception as e:
        return (
            jsonify({"status": "invalid", "msg": "Invalid token", "error": str(e)}),
            401,
        )

    email: str = payload.get("email", "")
    uid: str = payload.get("sub", "")
    name: str = rq.get("fullName", "")  # This is populated on first sign-in
    image: str = ""  # !!! Not available from Apple token
    locale = (rq.get("locale") or DEFAULT_LOCALE).replace("-", "_")

    # Make sure that Apple account ids are different from Google/OAuth ones
    # by prefixing them with 'apple:'. Note that Firebase paths cannot contain
    # periods, so we replace those with underscores, enabling the account
    # id to be used as a part of a Firebase path.
    account = "apple:" + uid.replace(".", "_")
    # Login or create the user in the Explo user model
    uld = User.login_by_account(account, name, email, image, locale=locale)
    userid = uld.get("user_id") or ""
    uld["method"] = "Apple"
    # Emulate the OAuth idinfo
    idinfo = UserIdDict(
        iss="appleid.apple.com",
        sub=account,
        name=name,
        picture=image,
        email=email,
        method="Apple",
        account=account,
        locale=uld.get("locale", DEFAULT_LOCALE),
        new=uld.get("new") or False,
        client_type="ios",  # Assume that Apple login is always from iOS
    )
    # Set the Flask session token
    set_session_userid(userid, idinfo)
    # Send a bunch of login data back to the client via the UserLoginDict instance
    return jsonify(dict(status="success", **uld))


def oauth_explo(request: Request) -> ResponseType:
    """Login via a previously issued Explo token. The token is generated
    in any of the other login methods and is returned to the client in the
    UserLoginDict instance. The client can then use that token for subsequent
    logins, without having to go through the third party OAuth flow again.
    The token is by default valid for 30 days."""
    if DEV_SERVER:
        # The 'fail' parameter is used for testing purposes only.
        # If sent by the client, we respond with the error code requested.
        fail = request.form.get("fail", "") or cast(Any, request).json.get(
            "fail", ""
        )
        if fail:
            try:
                fail_code = int(fail) if len(fail) <= 3 else 0
            except ValueError:
                fail_code = 0
            if fail_code:
                return jsonify({"status": "invalid", "msg": "Testing failure"}), fail_code

    token: Optional[str] = None
    config = cast(Any, current_app).config
    testing: bool = config.get("TESTING", False)
    client_type: str = "web"  # Default client type

    if not testing:
        token = request.form.get("token", "") or cast(Any, request).json.get(
            "token", ""
        )
        if not token:
            # No authentication token included in the request
            # 400 - Bad Request
            return jsonify({"status": "invalid", "msg": "Missing token"}), 400
        client_type = (
            request.form.get("clientType", "")
            or (
                request.json is not None
                and cast(Dict[str, str], request.json).get("clientType", "")
            )
            or "web"
        )

    client_id = CLIENT.get(client_type, {}).get("id", "")
    if not client_id:
        # Unknown client type (should be one of 'web', 'ios', 'android')
        # 400 - Bad Request
        return jsonify({"status": "invalid", "msg": "Unknown client type"}), 400

    uld: Optional[UserLoginDict] = None
    userid: Optional[str] = None
    idinfo: Optional[UserIdDict] = None

    try:
        if testing:
            # Get the idinfo dictionary directly from the request
            f = cast(Dict[str, str], request.form)
            sub = f.get("sub", "")
        else:
            # Verify the basics of the JWT-compliant token
            claims = verify_explo_token(token) if token else None
            if claims is None:
                raise ValueError("Unable to verify token")
            # Claims successfully extracted, which means that the token
            # is valid and not expired
            sub = claims.get("sub", "")
        if not sub:
            raise ValueError("Missing user id")
        # Note that we return the original token to the client,
        # as we want to re-use it until it expires
        t = User.login_by_id(sub, previous_token=token)
        if t is None:
            raise ValueError("User id not found")
        uld, udd = t
        idinfo = UserIdDict(
            iss=PROJECT_ID,
            sub=sub,
            name=udd["name"],  # Not available from Explo token
            picture=udd["picture"],  # Not available from Explo token
            email=udd["email"],  # Not available from Explo token
            account=uld["account"],  # Not available from Explo token
            locale=uld["locale"],  # Not available from Explo token
            method="Explo",
            new=False,
            client_type=client_type,
        )
        userid = uld["user_id"]
        uld["method"] = idinfo["method"]

    except (KeyError, ValueError) as e:
        # Invalid token
        # 401 - Unauthorized
        return jsonify({"status": "invalid", "msg": str(e)}), 401

    # Authentication complete; token was valid and user id was found
    # Set a session cookie
    set_session_userid(userid, idinfo)
    # Send a bunch of login data back to the client via the UserLoginDict instance
    return jsonify(dict(status="success", **uld))
