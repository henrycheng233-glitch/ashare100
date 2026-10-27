"""Batch-fetch and parse company identity facts for the fixed 100-stock list.

Uses Eastmoney RPT_F10_BASIC_ORGINFO, verified to return all 100 companies in
one query on 2026-10-23.  Employee counts lack a report-year label in this
source, so they are retained only in the raw response pending annual-report
verification.  Shenwan industry is not taken from Eastmoney's own taxonomy.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from fetch_A_market import request_json


ROOT = Path(__file__).resolve().parent
URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
RAW = ROOT / "eastmoney_basic_orginfo_raw.json"
EXTRACTED = ROOT / "eastmoney_identity_extracted.json"
MUNICIPALITIES = {"北京", "上海", "天津", "重庆", "香港", "澳门"}


def city_from_address(province: str | None, address: str | None) -> str | None:
    if province in MUNICIPALITIES:
        return province
    if not province or not address:
        return None
    rest = re.sub(r"^(?:中华人民共和国|中国)", "", address.strip())
    if province in rest:
        rest = rest.split(province, 1)[1]
        rest = re.sub(r"^(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|\))", "", rest)
        match = re.match(r"(.{2,8}?)市", rest)
        if match:
            return match.group(1)
    # Some registrations omit the province and even the 市 suffix.
    for city in ("深圳", "珠海", "苏州", "杭州", "南阳", "惠州", "成都", "南京", "青岛", "西安", "潮州"):
        if city in address:
            return city
    return None


def former_names(value: str | None) -> list[str]:
    if not value:
        return []
    return list(dict.fromkeys(name.strip() for name in re.split(r"[,，;；]", value) if name.strip()))


def profile_excerpt(value: str | None, main_business: str | None = None,
                    business_scope: str | None = None) -> str | None:
    if not value:
        return None
    clean = " ".join(value.split())
    if len(clean) < 200 and main_business:
        clean += " 主营业务：" + " ".join(main_business.split()).strip(" 。") + "。"
    if len(clean) < 200 and business_scope:
        scope = " ".join(business_scope.split()).strip(" 。")
        clean += " 经营范围包括：" + scope[: max(0, 230 - len(clean))].rstrip("，,；;。") + "。"
    if len(clean) < 200:
        return None
    if len(clean) <= 500:
        return clean
    stops = [index + 1 for index, char in enumerate(clean[:500]) if char in "。！？"]
    end = max((index for index in stops if index >= 200), default=None)
    return clean[:end] if end else None


def business_summary(value: str | None) -> str | None:
    if not value:
        return None
    text = " ".join(value.split()).strip(" 。；;")
    text = re.sub(r"\([一二三四五六七八九十]+\)", "", text)
    clauses = [part.strip() for part in re.split(r"[;；]", text) if part.strip()]
    summary = "；".join(clauses[:3]) if len(clauses) > 1 else text
    if len(summary) <= 50:
        return summary
    stops = [index + 1 for index, char in enumerate(summary[:50]) if char in "，,、；;。"]
    end = max((index for index in stops if index >= 12), default=50)
    return summary[:end].rstrip("，,、；;。")


def extract(row: dict) -> dict:
    province = row.get("PROVINCE") or None
    website = (row.get("ORG_WEB") or "").replace("\u00a0", ",").split(",")[0].strip()
    quote_name = row.get("SECURITY_NAME_ABBR") or ""
    st_status = "*ST" if quote_name.startswith("*ST") else "ST" if quote_name.startswith("ST") else "正常"
    return {
        "name_en": row.get("ORG_NAME_EN") or None,
        "former_names": former_names(row.get("FORMERNAME")),
        "list_date": (row.get("LISTING_DATE") or "")[:10] or None,
        "province": province,
        "city": city_from_address(province, row.get("REG_ADDRESS")),
        "website": website or None,
        "chairman": row.get("CHAIRMAN") or None,
        "business_summary": business_summary(row.get("MAIN_BUSINESS")),
        "profile": profile_excerpt(row.get("ORG_PROFILE"), row.get("MAIN_BUSINESS"),
                                   row.get("BUSINESS_SCOPE")),
        "st_status": st_status,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, help="Parse an existing API response without a network request")
    args = parser.parse_args()
    codes = [item["code"] for item in json.loads((ROOT / "codes_top100.json").read_text(encoding="utf-8"))]
    if len(codes) != len(set(codes)) or len(codes) != 100:
        raise ValueError("Fixed company list is not exactly 100 unique codes")
    if args.raw:
        payload = json.loads(args.raw.read_text(encoding="utf-8"))
    else:
        joined = ",".join('"' + code + '"' for code in codes)
        payload = request_json(URL, {
            "reportName": "RPT_F10_BASIC_ORGINFO",
            "columns": "ALL",
            "filter": f"(SECUCODE in ({joined}))",
            "pageNumber": 1,
            "pageSize": 100,
            "source": "F10",
            "client": "PC",
        })
    result = payload.get("result") or {}
    rows = result.get("data") or []
    returned = [row.get("SECUCODE") for row in rows]
    if not payload.get("success") or len(rows) != result.get("count"):
        raise ValueError("Company overview response is incomplete or rejected")
    if set(returned) != set(codes) or len(returned) != 100:
        raise ValueError("Company overview response does not match the fixed 100-stock list")
    RAW.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    extracted = {row["SECUCODE"]: extract(row) for row in rows}
    EXTRACTED.write_text(json.dumps(extracted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    covered = {field: sum(value.get(field) not in (None, "", []) for value in extracted.values())
               for field in next(iter(extracted.values()))}
    print(f"Saved {len(extracted)} company records to {EXTRACTED.name}")
    print("Field coverage:", covered)


if __name__ == "__main__":
    main()
