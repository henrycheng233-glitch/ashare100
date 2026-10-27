"""Complete the 2026-10-22 A-module market data from Tencent QFQ daily bars.

Run after ``fetch_A_market.py --date 2026-10-22 --skip-kline``. The raw
Tencent responses are retained so the interval calculations are reproducible.
"""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
AS_OF = date(2026, 10, 22)
RAW_PATH = ROOT / "A_market_tencent_qfq_raw_2026-10-22.json"
BASE_PATH = ROOT / "A_market_auto_2026-10-22.json"
DRAFT_PATH = ROOT / "data_A_identity_market.draft.json"
OUTPUT_PATH = ROOT / "data_A_identity_market.json"
SHANGHAI = timezone(timedelta(hours=8))
URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param="
POST_DATE_DIVIDENDS = {
    "600150.SH": 0.465,
    "601601.SH": 0.42,
    "601919.SH": 0.43,
    "688008.SH": 0.20,
    "601985.SH": 0.02,
    "000338.SZ": 0.517,
    "601688.SH": 0.18,
}


def fetch_bars(code: str, end: str) -> tuple[list[list[str]], str]:
    prefix = "sh" if code.endswith(".SH") else "sz"
    param = f"{prefix}{code[:6]},day,2023-01-01,{end},1000,qfq"
    req = Request(URL + quote(param, safe=","), headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://gu.qq.com/",
        "Accept": "application/json,text/plain,*/*",
    })
    last_error = None
    for attempt in range(3):
        try:
            with urlopen(req, timeout=20) as response:
                payload = json.load(response)
            if payload.get("code") != 0:
                raise ValueError(f"Tencent rejected {code}: {payload.get('msg')}")
            series = (payload.get("data") or {}).get(prefix + code[:6], {})
            kind = "qfqday" if series.get("qfqday") else "day"
            bars = series.get(kind)
            if not isinstance(bars, list) or not bars:
                raise ValueError(f"Tencent has no qfqday for {code} through {end}")
            if any(len(row) < 6 for row in bars):
                raise ValueError(f"Tencent qfqday shape changed for {code}")
            return bars, kind
        except (OSError, ValueError) as error:
            last_error = error
            time.sleep(1 + attempt * 2)
    raise RuntimeError(f"{code} through {end}: {last_error}")


def collect(code: str, need_old: bool) -> dict:
    current, current_kind = fetch_bars(code, AS_OF.isoformat())
    if current[-1][0] != AS_OF.isoformat():
        raise ValueError(f"{code}: newest qfq bar is {current[-1][0]}")
    old, old_kind = fetch_bars(code, "2024-07-01") if need_old else ([], None)
    return {"current": current, "old": old,
            "current_series": current_kind, "old_series": old_kind}


def last_close(bars: list[list[str]], cutoff: date) -> float | None:
    preceding = [float(row[2]) for row in bars if row[0] <= cutoff.isoformat()]
    return preceding[-1] if preceding else None


def exact_close(bars: list[list[str]], target: date) -> float | None:
    return next((float(row[2]) for row in bars if row[0] == target.isoformat()), None)


def interval_return(current: float, baseline: float | None) -> float | None:
    return round((current / baseline - 1) * 100, 2) if baseline and baseline > 0 else None


def update_market(market: dict, record: dict, code: str) -> None:
    current = record["current"]
    old = record["old"]
    latest = current[-1]
    latest_close = float(latest[2])
    # Seven holdings went ex-dividend on 2026-10-23. Tencent's present QFQ
    # series subtracts those cash dividends even from 2026-10-22. Undo that
    # *additive* shift to anchor this snapshot to the target close.
    dividend_shift = market["price"] - latest_close
    if abs(dividend_shift - POST_DATE_DIVIDENDS.get(code, 0)) > 0.001:
        raise ValueError(f"{code}: unexpected Tencent/Eastmoney QFQ difference")
    target_close = latest_close + dividend_shift
    start_52w = date(2025, 10, 22).isoformat()
    year_bars = [row for row in current if start_52w <= row[0] <= AS_OF.isoformat()]
    if not year_bars:
        raise ValueError(f"{code}: no bars in 52-week window")
    market["high_52w"] = round(max(float(row[3]) for row in year_bars) + dividend_shift, 2)
    market["low_52w"] = round(min(float(row[4]) for row in year_bars) + dividend_shift, 2)
    ytd_base = exact_close(current, date(2025, 12, 31))
    one_year_base = exact_close(current, date(2025, 10, 22))
    market["ytd_return"] = interval_return(target_close, ytd_base + dividend_shift if ytd_base else None)
    market["return_1y"] = interval_return(target_close, one_year_base + dividend_shift if one_year_base else None)
    # Tencent's STAR Market daily volume is in shares; other A shares use lots.
    volume_shares = float(latest[5]) * (1 if code.startswith("688") else 100)
    market["turnover_rate"] = round(volume_shares * 100 / market["float_shares"], 2)
    market["amount"] = None  # Tencent bars have volume, but no transaction amount.
    market["dividend_yield"] = None  # To be computed from team C's dividends.
    if old:
        overlapping = set(row[0] for row in old) & set(row[0] for row in current)
        if not overlapping:
            raise ValueError(f"{code}: QFQ segments have no common trade date")
        overlap_date = min(overlapping)
        old_overlap = next(float(row[2]) for row in old if row[0] == overlap_date)
        new_overlap = next(float(row[2]) for row in current if row[0] == overlap_date)
        if abs(new_overlap - old_overlap) > 0.001:
            raise ValueError(f"{code}: QFQ segments disagree on overlap date")
        baseline = last_close(old, date(2023, 10, 22))
        market["return_3y"] = interval_return(target_close, baseline + dividend_shift if baseline else None)
    else:
        market["return_3y"] = None


def main() -> None:
    base = json.loads(BASE_PATH.read_text(encoding="utf-8"))
    draft = json.loads(DRAFT_PATH.read_text(encoding="utf-8"))
    codes = list(draft["companies"])
    if len(codes) != 100 or set(codes) != set(base["companies"]):
        raise ValueError("The fixed list and the 2026-10-22 valuations differ")
    if base["as_of_date"] != AS_OF.isoformat() or base["errors"]:
        raise ValueError("The valuation run has the wrong date or reported errors")
    needs_old = {
        code: draft["companies"][code]["identity"]["list_date"] <= "2023-10-22"
        for code in codes
    }
    raw = json.loads(RAW_PATH.read_text(encoding="utf-8")) if RAW_PATH.exists() else {}
    pending = [code for code in codes if code not in raw]
    errors = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(collect, code, needs_old[code]): code for code in pending}
        for future in as_completed(futures):
            code = futures[future]
            try:
                raw[code] = future.result()
            except Exception as error:
                errors[code] = str(error)
            print(f"Tencent QFQ {len(raw)}/{len(codes)}; errors={len(errors)}", flush=True)
            RAW_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if errors:
        raise RuntimeError(f"Tencent collection incomplete: {errors}")
    if set(raw) != set(codes):
        raise ValueError("Tencent raw cache does not match fixed list")

    for code in codes:
        market = base["companies"][code].copy()
        update_market(market, raw[code], code)
        draft["companies"][code]["market"] = market
    draft["meta"] = {
        "collector": "滕梓棋",
        "module": "A",
        "as_of_date": AS_OF.isoformat(),
        "report_period": "2026-06-30",
        "generated_at": datetime.now(SHANGHAI).isoformat(timespec="seconds"),
        "schema_version": "1.4",
        "count": 100,
    }
    OUTPUT_PATH.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Created {OUTPUT_PATH.name} with {len(codes)} companies")


if __name__ == "__main__":
    main()
