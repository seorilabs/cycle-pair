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
try:
    field = IDS[sys.argv[1]]
    raw = sys.stdin.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024 or "<!" in raw:
        raise ValueError()
    start, end = raw.find("<hierarchy"), raw.rfind("</hierarchy>")
    if start < 0 or end < start:
        raise ValueError()
    tree = ET.fromstring(raw[start:end + len("</hierarchy>")])
    nodes = [node for node in tree.iter("node")
             if node.get("resource-id") in (field, PACKAGE + ":id/" + field)]
    if len(nodes) != 1 or nodes[0].get("package") != PACKAGE or "text" not in nodes[0].attrib:
        raise ValueError()
    print(json.dumps({"empty": nodes[0].get("text") == ""}))
except Exception:
    sys.exit(1)
