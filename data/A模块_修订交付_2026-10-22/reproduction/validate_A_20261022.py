"""Local audit for the A-module delivery when the team's validate.py is absent."""

import json
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
official_bytes = (ROOT / "data_A_identity_market.json").read_bytes()
assert not official_bytes.startswith(b"\xef\xbb\xbf"), "UTF-8 BOM is forbidden"
official = json.loads(official_bytes.decode("utf-8"))
draft = json.loads((ROOT / "data_A_identity_market.draft.json").read_text(encoding="utf-8"))
source = json.loads((ROOT / "A_market_auto_2026-10-22.json").read_text(encoding="utf-8"))
raw = json.loads((ROOT / "A_market_tencent_qfq_raw_2026-10-22.json").read_text(encoding="utf-8"))

meta = official["meta"]
assert meta["collector"] == "滕梓棋"
assert meta["schema_version"] == "1.4"
assert meta["as_of_date"] == "2026-10-22"
assert meta["report_period"] == "2026-06-30"
assert meta["count"] == 100
assert meta["generated_at"].endswith("+08:00")

companies = official["companies"]
assert len(companies) == 100
assert set(companies) == set(draft["companies"]) == set(source["companies"]) == set(raw)
market_fields = {
    "as_of_date", "price", "change_pct", "total_mv", "float_mv",
    "total_shares", "float_shares", "pe_ttm", "pe_static", "pb",
    "ps_ttm", "dividend_yield", "turnover_rate", "amount", "high_52w",
    "low_52w", "ytd_return", "return_1y", "return_3y", "index_members",
}
valuation_fields = (
    "price", "change_pct", "total_mv", "float_mv", "total_shares",
    "float_shares", "pe_ttm", "pe_static", "pb", "ps_ttm",
)
null_counts = Counter()
day_series = []
rebased = []
for code, company in companies.items():
    assert company["identity"] == draft["companies"][code]["identity"], code
    market = company["market"]
    assert set(market) == market_fields, code
    assert market["as_of_date"] == "2026-10-22", code
    assert market["index_members"] == [], code
    assert all(market[field] == source["companies"][code][field] for field in valuation_fields), code
    assert all(not isinstance(value, str) or value not in ("", "-") for value in market.values()), code
    assert market["price"] > 0 and market["total_shares"] > 0 and market["float_shares"] > 0, code
    assert 0 <= market["turnover_rate"] <= 100, code
    assert market["low_52w"] <= market["price"] <= market["high_52w"], code
    assert market["amount"] is None and market["dividend_yield"] is None, code
    listing = date.fromisoformat(company["identity"]["list_date"])
    for field, cutoff in (
        ("ytd_return", date(2025, 12, 31)),
        ("return_1y", date(2025, 10, 22)),
    ):
        has_bar = any(row[0] == cutoff.isoformat() for row in raw[code]["current"])
        assert (market[field] is None) == (not has_bar), (code, field)
    assert (market["return_3y"] is None) == (listing > date(2023, 10, 22)), code
    latest = raw[code]["current"][-1]
    assert latest[0] == "2026-10-22", code
    shift = market["price"] - float(latest[2])
    window = [row for row in raw[code]["current"] if "2025-10-22" <= row[0] <= "2026-10-22"]
    assert market["high_52w"] == round(max(float(row[3]) for row in window) + shift, 2), code
    assert market["low_52w"] == round(min(float(row[4]) for row in window) + shift, 2), code
    volume_shares = float(latest[5]) * (1 if code.startswith("688") else 100)
    assert market["turnover_rate"] == round(volume_shares * 100 / market["float_shares"], 2), code
    for field, cutoff, bars, exact in (
        ("ytd_return", "2025-12-31", raw[code]["current"], True),
        ("return_1y", "2025-10-22", raw[code]["current"], True),
        ("return_3y", "2023-10-22", raw[code]["old"], False),
    ):
        candidates = [row for row in bars if row[0] == cutoff] if exact else [row for row in bars if row[0] <= cutoff]
        baseline = float(candidates[-1][2]) + shift if candidates else None
        expected = round((market["price"] / baseline - 1) * 100, 2) if baseline else None
        assert market[field] == expected, (code, field, market[field], expected)
    if raw[code].get("current_series") == "day":
        day_series.append(code)
    if abs(float(latest[2]) - market["price"]) > 0.001:
        rebased.append(code)
    for field, value in market.items():
        if value is None:
            null_counts[field] += 1

print("PASS: 100 codes; 20 market fields; unchanged identity; meta, dates and units checked")
print("Null counts:", dict(null_counts))
print("Tencent day fallback:", day_series)
assert set(rebased) == {
    "600150.SH", "601601.SH", "601919.SH", "688008.SH", "601985.SH",
    "000338.SZ", "601688.SH",
}
print("Post-date cash dividends added back to QFQ:", rebased)
