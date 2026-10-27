"""Create an explicitly incomplete module-A draft from the supplied top-100 list."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from identity_lookup import (
    EXTRA_ALIASES,
    PINYIN_BY_CODE,
    PROFILE_OVERRIDES,
    REGISTERED_LOCALITY_OVERRIDES,
)


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "codes_top100.json"
EXTRACTED = ROOT / "choice_identity_extracted.json"
EASTMONEY_IDENTITY = ROOT / "eastmoney_identity_extracted.json"
CHOICE_BATCH = ROOT / "choice_batch_extracted.json"
AUTO_MARKET = ROOT / "A_market_auto_2026-10-30.json"
OUTPUT = ROOT / "data_A_identity_market.draft.json"

IDENTITY_FIELDS = (
    "name_en",
    "pinyin_abbr",
    "former_names",
    "industry_sw1",
    "industry_sw2",
    "list_date",
    "province",
    "city",
    "website",
    "chairman",
    "employees",
    "business_summary",
    "profile",
    "st_status",
    "audit_opinion",
)

MARKET_FIELDS = (
    "price",
    "change_pct",
    "total_mv",
    "float_mv",
    "total_shares",
    "float_shares",
    "pe_ttm",
    "pe_static",
    "pb",
    "ps_ttm",
    "dividend_yield",
    "turnover_rate",
    "amount",
    "high_52w",
    "low_52w",
    "ytd_return",
    "return_1y",
    "return_3y",
)

# Verified on Choice > 工商银行 > 基本资料 > 公司概况 on 2026-10-23.
# Employees is deliberately omitted: that page does not label its report year.
PILOT_IDENTITY = {
    "601398.SH": {
        "name_en": "Industrial And Commercial Bank Of China Limited",
        "pinyin_abbr": "GSYH",
        "aliases": ["工行", "gsyh"],
        "list_date": "2006-10-27",
        "province": "北京",
        "city": "北京",
        "website": "www.icbc.com.cn",
        "chairman": "廖林",
        "business_summary": "提供公司金融、普惠金融、机构金融、个人金融、投资银行、资产管理等综合金融服务",
    }
}


def board(code: str) -> str:
    if code.startswith("688"):
        return "科创板"
    if code.startswith("300"):
        return "创业板"
    return "主板"


def abbreviation(row: dict) -> str:
    # The source spreadsheet has transient ex-dividend quote labels for these two.
    replacements = {"601398.SH": "工商银行", "601288.SH": "农业银行"}
    return replacements.get(row["code"], row["name_abbr_source"]).replace(" ", "")


def main() -> None:
    rows = json.loads(SOURCE.read_text(encoding="utf-8"))
    extracted = json.loads(EXTRACTED.read_text(encoding="utf-8")) if EXTRACTED.exists() else {}
    em_identity = json.loads(EASTMONEY_IDENTITY.read_text(encoding="utf-8")) if EASTMONEY_IDENTITY.exists() else {}
    choice_batch = json.loads(CHOICE_BATCH.read_text(encoding="utf-8")) if CHOICE_BATCH.exists() else {}
    market_auto = json.loads(AUTO_MARKET.read_text(encoding="utf-8")) if AUTO_MARKET.exists() else None
    if market_auto and market_auto.get("as_of_date") != "2026-10-30":
        raise ValueError("Automatic market data has a different as-of date")
    codes = [row["code"] for row in rows]
    assert len(codes) == len(set(codes)) == 100
    assert Counter(code.split(".")[1] for code in codes) == {"SH": 70, "SZ": 30}
    assert set(codes) == set(PINYIN_BY_CODE), "Pinyin lookup must match the fixed 100-stock list"
    if choice_batch and set(choice_batch) != set(codes):
        raise ValueError("Choice batch keys do not match the fixed 100-stock list")

    companies = {}
    for row in rows:
        key = row["code"]
        code, exchange = key.split(".")
        identity = {
            "code": code,
            "exchange": exchange,
            "board": board(code),
            "name_full": row["name_full"],
            "name_abbr": abbreviation(row),
            "aliases": [],
        }
        identity.update({field: [] if field == "former_names" else None for field in IDENTITY_FIELDS})
        identity.update(em_identity.get(key, {}))
        identity.update(choice_batch.get(key, {}))
        identity.update(PILOT_IDENTITY.get(key, {}))
        identity.update(extracted.get(key, {}))
        if key in PROFILE_OVERRIDES:
            identity["profile"] = PROFILE_OVERRIDES[key]
        if key in REGISTERED_LOCALITY_OVERRIDES:
            identity["city"] = REGISTERED_LOCALITY_OVERRIDES[key]
        identity["pinyin_abbr"] = PINYIN_BY_CODE[key]
        identity["aliases"] = list(dict.fromkeys([
            *identity["aliases"], PINYIN_BY_CODE[key].lower(),
            *EXTRA_ALIASES.get(key, []),
        ]))
        market = {"as_of_date": "2026-10-30"}
        market.update({field: None for field in MARKET_FIELDS})
        market["index_members"] = []
        if market_auto and key in market_auto.get("companies", {}):
            values = market_auto["companies"][key]
            if values.get("as_of_date") != "2026-10-30":
                raise ValueError(f"Wrong market date for {key}")
            market.update({field: values[field] for field in MARKET_FIELDS if field in values})
            if "index_members" not in market_auto.get("unverified_fields", []):
                market["index_members"] = values["index_members"]
        companies[key] = {"identity": identity, "market": market}

    # The draft filename and note distinguish this from the eventual submission.
    payload = {
        "meta": {
            "collector": None,
            "module": "A",
            "as_of_date": "2026-10-30",
            "report_period": "2026-09-30",
            "generated_at": None,
            "schema_version": "1.1",
            "count": 100,
        },
        "companies": companies,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Created {OUTPUT.name}: {len(companies)} companies; market values await 2026-10-30 close")


if __name__ == "__main__":
    main()
