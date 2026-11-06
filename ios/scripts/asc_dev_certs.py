#!/usr/bin/env python3
"""Lists or revokes Apple Development certificates through the App Store Connect API.

Used by the TestFlight workflow so that the development certificate a fresh CI
runner creates while signing is revoked again at the end of the run. Without
this, every run leaves one behind until the team hits Apple's limit.

  asc_dev_certs.py snapshot FILE   # record the ids that exist now
  asc_dev_certs.py revoke-new FILE # revoke DEVELOPMENT certs not in FILE

Only certificates created after the snapshot are ever revoked.
Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH; uses PyJWT with cryptography.
"""
import json, os, sys, time, urllib.request

import jwt  # PyJWT

API = "https://api.appstoreconnect.apple.com/v1/certificates"


def token() -> str:
    with open(os.environ["ASC_KEY_PATH"]) as f:
        key = f.read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


def call(method: str, url: str):
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"Bearer {token()}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
        return json.loads(body) if body else None


def development_certs() -> dict:
    out, url = {}, f"{API}?filter[certificateType]=DEVELOPMENT,IOS_DEVELOPMENT&limit=200"
    while url:
        page = call("GET", url)
        for c in page["data"]:
            out[c["id"]] = c["attributes"].get("name") or c["attributes"].get("displayName") or ""
        url = page.get("links", {}).get("next")
    return out


def main():
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "snapshot":
        ids = sorted(development_certs())
        with open(path, "w") as f:
            json.dump(ids, f)
        print(f"{len(ids)} development certificates before signing.")
    elif cmd == "revoke-new":
        with open(path) as f:
            before = set(json.load(f))
        new = {i: n for i, n in development_certs().items() if i not in before}
        for i, name in new.items():
            call("DELETE", f"{API}/{i}")
            print(f"Revoked the development certificate this run created ({name or i}).")
        if not new:
            print("This run created no development certificate.")
    else:
        sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
