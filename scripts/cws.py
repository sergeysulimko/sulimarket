"""Chrome Web Store API v2 for SuliMarket: status | upload <zip> | publish. Key and ids: sulimko-com docs/products/sulimarket/STORES.md.

Run: CWS_KEY=<key file> uv run --no-project --with google-auth --with requests python scripts/cws.py status
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2 import service_account

KEY = Path(os.environ["CWS_KEY"])  # the service-account key file; where it lives - STORES.md
PUB = "b920efe2-ef83-452d-9f22-858ea0757076"
ITEM = "deagbpofnljefkmkaacpfcegbcgpajjo"
BASE = f"https://chromewebstore.googleapis.com/v2/publishers/{PUB}/items/{ITEM}"
UPLOAD = f"https://chromewebstore.googleapis.com/upload/v2/publishers/{PUB}/items/{ITEM}:upload"

creds = service_account.Credentials.from_service_account_file(
    str(KEY), scopes=["https://www.googleapis.com/auth/chromewebstore"])
creds.refresh(Request())


def call(method, url, data=None, ctype="application/json"):
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": f"Bearer {creds.token}", "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:2000]


cmd = sys.argv[1]
if cmd == "status":
    print(call("GET", BASE + ":fetchStatus"))
elif cmd == "upload":
    print(call("POST", UPLOAD, Path(sys.argv[2]).read_bytes(), "application/zip"))
elif cmd == "publish":
    print(call("POST", BASE + ":publish", b"{}"))
