"""Collect the fixed A-module market snapshot from Eastmoney after its close.

The output is an intermediate file, not the team's final JSON.  Valuation
fields come from one historical daily batch; price history uses forward
adjusted daily bars.  No missing value is inferred from another date.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
TARGET_DATE = date(2026, 10, 30)
DELAY_SECONDS = 0.4
VALUE_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
QUOTE_URL = "https://push2.eastmoney.com/api/qt/stock/get"

VALUE_FIELDS = {
    "price": "CLOSE_PRICE",
    "change_pct": "CHANGE_RATE",
    "total_mv": "TOTAL_MARKET_CAP",
    "float_mv": "NOTLIMITED_MARKETCAP_A",
    "total_shares": "TOTAL_SHARES",
    "float_shares": "FREE_SHARES_A",
    "pe_ttm": "PE_TTM",
    "pe_static": "PE_LAR",
    "pb": "PB_MRQ",
    "ps_ttm": "PS_TTM",
}


def request_json(url: str, params: dict[str, str | int], timeout: int = 15) -> dict:
    query = urlencode(params)
    request = Request(f"{url}?{query}", headers={
        "User-Agent": "Mozilla/5.0 (compatible; A-share-course-project/1.1)",
        "Referer": "https://www.eastmoney.com/",
        "Accept": "application/json,text/plain,*/*",
    })
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=timeout) as response:
                data = json.load(response)
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            time.sleep(DELAY_SECONDS)
            return data
        except (URLError, TimeoutError, OSError, ValueError) as error:
            last_error = error
            if attempt < 2:
                time.sleep((1, 2, 4)[attempt])
    raise RuntimeError(f"Request failed: {url}: {last_error}")


def load_valuation(as_of: date, path: Path | None = None) -> dict[str, dict]:
    if path:
        payload = json.loads(path.read_text(encoding="utf-8"))
        result = payload.get("result") or {}
        rows = result.get("data") or []
        expected_count = result.get("count")
    else:
        rows = []
        expected_count = None
        for page_number in range(1, 20):
            payload = request_json(VALUE_URL, {
                "reportName": "RPT_VALUEANALYSIS_DET",
                "columns": "ALL",
                "filter": f"(TRADE_DATE='{as_of.isoformat()}')",
                "pageNumber": page_number,
                "pageSize": 500,
                "source": "WEB",
                "client": "WEB",
            })
            if not payload.get("success"):
                raise ValueError(f"Valuation batch rejected page {page_number}")
            result = payload.get("result") or {}
            if expected_count is None:
                expected_count = result.get("count")
            elif result.get("count") != expected_count:
                raise ValueError("Valuation batch count changed during collection")
            rows.extend(result.get("data") or [])
            print(f"Valuation page {page_number}: {len(rows)}/{expected_count}", flush=True)
            if expected_count is None:
                raise ValueError("Valuation response has no total count")
            if len(rows) >= expected_count:
                break
    if not payload.get("success") or len(rows) != expected_count:
        raise ValueError("Valuation batch is incomplete or rejected")
    if len(rows) < 100 or len(rows) > 6000:
        raise ValueError(f"Unexpected valuation row count: {len(rows)}")
    wanted = as_of.isoformat()
    for row in rows:
        if str(row.get("TRADE_DATE", ""))[:10] != wanted:
            raise ValueError("Valuation response contains a different trade date")
    return {row["SECUCODE"]: row for row in rows}


def load_kline(code: str, as_of: date, path: Path | None = None) -> list[dict]:
    if path:
        payload = json.loads(path.read_text(encoding="utf-8"))
    else:
        first = date(as_of.year - 3, 9, 1)
        secid = f"{1 if code.endswith('.SH') else 0}.{code[:6]}"
        payload = request_json(KLINE_URL, {
            "secid": secid,
            "klt": 101,
            "fqt": 1,
            "beg": first.strftime("%Y%m%d"),
            "end": as_of.strftime("%Y%m%d"),
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        }, timeout=8)
    if payload.get("rc") != 0:
        raise ValueError(f"K-line rejected for {code}")
    raw = (payload.get("data") or {}).get("klines") or []
    bars = []
    for line in raw:
        values = line.split(",")
        if len(values) != 11:
            raise ValueError(f"K-line column count changed for {code}")
        bars.append({
            "date": date.fromisoformat(values[0]),
            "close": float(values[2]),
            "high": float(values[3]),
            "low": float(values[4]),
            "amount": float(values[6]),
            "turnover_rate": float(values[10]),
        })
    bars.sort(key=lambda bar: bar["date"])
    return bars


def load_closing_quote(code: str, as_of: date) -> dict[str, float]:
    secid = f"{1 if code.endswith('.SH') else 0}.{code[:6]}"
    payload = request_json(QUOTE_URL, {
        "secid": secid,
        "fields": "f48,f57,f86,f168",
        "fltt": 2,
    }, timeout=8)
    data = payload.get("data") or {}
    if payload.get("rc") != 0 or data.get("f57") != code[:6]:
        raise ValueError(f"Quote response mismatch for {code}")
    stamp = data.get("f86")
    if not isinstance(stamp, (int, float)):
        raise ValueError(f"Quote has no update timestamp for {code}")
    quote_date = datetime.fromtimestamp(stamp, timezone(timedelta(hours=8))).date()
    if quote_date != as_of:
        raise ValueError(f"Quote date {quote_date} differs from target {as_of}")
    amount, turnover = data.get("f48"), data.get("f168")
    return {
        "amount": round(float(amount), 2) if isinstance(amount, (int, float)) else None,
        "turnover_rate": round(float(turnover), 2) if isinstance(turnover, (int, float)) else None,
    }


def baseline_close(bars: list[dict], cutoff: date) -> float | None:
    prior = [bar["close"] for bar in bars if bar["date"] <= cutoff]
    return prior[-1] if prior else None


def percent_return(current: float, baseline: float | None) -> float | None:
    return round((current / baseline - 1) * 100, 2) if baseline else None


def market_from_valuation(valuation: dict, as_of: date) -> dict:
    market = {"as_of_date": as_of.isoformat()}
    for field, source in VALUE_FIELDS.items():
        value = valuation.get(source)
        market[field] = None if value in (None, "", "-") else (
            int(value) if field.endswith("shares") else round(float(value), 2)
        )
    for field in ("turnover_rate", "amount", "high_52w", "low_52w",
                  "ytd_return", "return_1y", "return_3y", "dividend_yield"):
        market[field] = None
    market["index_members"] = []
    return market


def market_from_sources(valuation: dict, bars: list[dict], as_of: date) -> dict:
    if not bars or bars[-1]["date"] != as_of:
        raise ValueError("Forward-adjusted K-line has no bar on the target date")
    market = market_from_valuation(valuation, as_of)
    today_bar = bars[-1]
    market["turnover_rate"] = round(today_bar["turnover_rate"], 2)
    market["amount"] = round(today_bar["amount"], 2)
    within_year = [bar for bar in bars if bar["date"] >= as_of - timedelta(days=365)]
    market["high_52w"] = round(max(bar["high"] for bar in within_year), 2)
    market["low_52w"] = round(min(bar["low"] for bar in within_year), 2)
    current = today_bar["close"]
    market["ytd_return"] = percent_return(current, baseline_close(bars, date(as_of.year - 1, 12, 31)))
    market["return_1y"] = percent_return(current, baseline_close(bars, date(as_of.year - 1, as_of.month, as_of.day)))
    market["return_3y"] = percent_return(current, baseline_close(bars, date(as_of.year - 3, as_of.month, as_of.day)))
    # These require separate verified sources; [] must not imply checked non-membership.
    return market


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=TARGET_DATE.isoformat())
    parser.add_argument("--valuation-json", type=Path, help="Offline API response for verification")
    parser.add_argument("--kline-dir", type=Path, help="Offline per-code API responses")
    parser.add_argument("--skip-kline", action="store_true", help="Collect only historical valuation fields")
    args = parser.parse_args()
    as_of = date.fromisoformat(args.date)
    now = datetime.now()
    if not args.valuation_json and (
        as_of > now.date() or (as_of == now.date() and now.hour < 16)
    ):
        parser.error("Historical closing data is available only after 16:00 on the target date")

    codes = [item["code"] for item in json.loads((ROOT / "codes_top100.json").read_text(encoding="utf-8"))]
    if len(codes) != len(set(codes)) or len(codes) != 100:
        raise ValueError("Fixed company list is not exactly 100 unique codes")
    valuations = load_valuation(as_of, args.valuation_json)
    missing = [code for code in codes if code not in valuations]
    if missing:
        raise ValueError(f"Valuation batch lacks {len(missing)} fixed-list codes: {missing[:10]}")
    output = ROOT / f"A_market_auto_{as_of.isoformat()}.json"
    payload = {
        "as_of_date": as_of.isoformat(),
        "sources": ["RPT_VALUEANALYSIS_DET"] + ([] if args.skip_kline else ["push2his/kline fqt=1"]),
        "unverified_fields": [],
        "companies": {},
        "errors": {},
    }
    kline_available = not args.skip_kline
    quote_available = as_of == now.date()
    if quote_available:
        payload["sources"].append("push2/stock/get same-day closing quote")
    for index, code in enumerate(codes, 1):
        market = market_from_valuation(valuations[code], as_of)
        try:
            if kline_available:
                path = args.kline_dir / f"{code}.json" if args.kline_dir else None
                bars = load_kline(code, as_of, path)
                market = market_from_sources(valuations[code], bars, as_of)
        except (RuntimeError, ValueError, OSError) as error:
            payload["errors"][code] = str(error)
            if index == 1 and isinstance(error, RuntimeError):
                kline_available = False
                payload["sources"].remove("push2his/kline fqt=1")
                print("K-line source unavailable; retaining verified valuation fields", flush=True)
        if quote_available:
            try:
                market.update(load_closing_quote(code, as_of))
            except (RuntimeError, ValueError, OSError) as error:
                payload["errors"][f"{code}:quote"] = str(error)
                if index == 1 and isinstance(error, RuntimeError):
                    quote_available = False
                    payload["sources"].remove("push2/stock/get same-day closing quote")
        payload["companies"][code] = market
        if index % 20 == 0 or index == len(codes):
            pending_fields = (
                "dividend_yield", "index_members", "turnover_rate", "amount",
                "high_52w", "low_52w", "ytd_return", "return_1y", "return_3y",
            )
            payload["unverified_fields"] = [
                field for field in pending_fields
                if any(company[field] in (None, []) for company in payload["companies"].values())
            ]
            output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{index}/100 processed; {len(payload['errors'])} errors; saved {output.name}")


if __name__ == "__main__":
    main()
