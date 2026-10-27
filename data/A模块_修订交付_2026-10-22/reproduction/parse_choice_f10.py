"""Extract verifiable identity fields from Choice F10 company-overview text.

Input is accessibility text saved from the Choice client, keyed by stock code.
Outputs a separate extracted-data file; fields absent or ambiguous are omitted.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "choice_f10_raw.json"
OUTPUT = ROOT / "choice_identity_extracted.json"


def between(text: str, left: str, right: str) -> str | None:
    match = re.search(re.escape(left) + r"\s*(.*?)\s*" + re.escape(right), text, re.S)
    return match.group(1).strip() if match else None


def extract(text: str, expected_code: str) -> dict[str, str]:
    if not text.startswith(expected_code[:6]):
        raise ValueError(f"F10 page does not match {expected_code}")
    if "基本资料 公司名称" not in text or "加载中" in text[:350]:
        raise ValueError(f"F10 overview did not finish loading for {expected_code}")

    result: dict[str, str] = {}
    patterns = {
        "name_en": ("英文名称", "A股代码"),
        "chairman": ("董事长", "证券事务代表"),
    }
    for field, (left, right) in patterns.items():
        value = between(text, left, right)
        if value and value != "--":
            result[field] = value

    date_match = re.search(r"上市日期\s*(\d{4}-\d{2}-\d{2})", text)
    if date_match:
        result["list_date"] = date_match.group(1)

    website_raw = between(text, "公司网址", "办公地址")
    if website_raw:
        website = re.search(r"(?:https?://)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", website_raw)
        if website:
            result["website"] = website.group(0)

    region = between(text, "区域", "邮政编码")
    if region and region != "--":
        result["province"] = region
        if region in {"北京", "上海", "天津", "重庆"}:
            result["city"] = region
        else:
            address = between(text, "注册地址", "区域") or ""
            rest = re.sub(r"^中国", "", address)
            rest = re.sub(r"^" + re.escape(region) + r"(?:省|自治区|壮族自治区|回族自治区|维吾尔自治区)?", "", rest)
            city = re.match(r"([^\s]{2,5}?)市", rest)
            if city:
                result["city"] = city.group(1)

    # F10 shows employee count without a report-period label. The project's
    # employees field specifically requires the latest annual-report figure.
    return result


def main() -> None:
    raw = json.loads(INPUT.read_text(encoding="utf-8"))
    output = {code: extract(text, code) for code, text in raw.items()}
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Extracted {len(output)} Choice F10 company records")
    for code, fields in output.items():
        print(code, ", ".join(fields))


if __name__ == "__main__":
    main()
