"""소유 QA 입력 하나의 빈값 여부만 반환한다. 원문과 예외는 출력하지 않는다."""
import json
import sys
import xml.etree.ElementTree as ET

IDS = {
    "email": "account-upgrade-email",
    "password": "account-upgrade-password",
    "confirm": "account-upgrade-password-confirm",
}
PACKAGE = "com.seorilabs.cyclepair.qa"
LABELS = {
    "login-email": (["Sign-in email", "로그인 이메일"], False),
    "login-password": (["Sign-in password", "로그인 비밀번호"], True),
    "reauth-password": (["Current password for verification", "재인증 비밀번호"], True),
}
try:
    requested = sys.argv[1]
    if requested not in IDS and requested not in LABELS:
        raise ValueError()
    raw = sys.stdin.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024 or "<!" in raw:
        raise ValueError()
    start, end = raw.find("<hierarchy"), raw.rfind("</hierarchy>")
    if start < 0 or end < start:
        raise ValueError()
    tree = ET.fromstring(raw[start:end + len("</hierarchy>")])
    if requested in IDS:
        field = IDS[requested]
        nodes = [node for node in tree.iter("node")
                 if node.get("resource-id") in (field, PACKAGE + ":id/" + field)]
    else:
        labels, secure = LABELS[requested]
        nodes = [node for node in tree.iter("node") if node.get("content-desc") in labels]
        if len(nodes) != 1 or nodes[0].get("class") != "android.widget.EditText" or nodes[0].get("password") != str(secure).lower():
            raise ValueError()
    if len(nodes) != 1 or nodes[0].get("package") != PACKAGE or "text" not in nodes[0].attrib:
        raise ValueError()
    print(json.dumps({"empty": nodes[0].get("text") == ""}))
except Exception:
    sys.exit(1)
