"""Validate the user's Choice batch export and extract four A-module fields.

The workbook remains untouched.  This intermediate JSON is keyed by the
fixed stock code so later draft generation does not depend on row order.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "AB100_20261021_申万行业&员工人数.xlsx"
OUTPUT = ROOT / "choice_batch_extracted.json"
EXPECTED_HEADERS = (
    "证券代码",
    "证券名称",
    "所属申万行业名称(2021)\n[行业类别]1级\n[截止日期]最新",
    "所属申万行业名称(2021)\n[行业类别]2级\n[截止日期]最新",
    "审计意见类别\n[报告期]去年年报\n[地域类别]境内",
    "员工总数(截止日期)\n[截止日期]2025-12-31",
)


def main() -> None:
    expected = {
        item["code"] for item in json.loads(
            (ROOT / "codes_top100.json").read_text(encoding="utf-8")
        )
    }
    if len(expected) != 100:
        raise ValueError("Fixed list does not contain 100 unique codes")

    workbook = load_workbook(SOURCE, read_only=True, data_only=True)
    if len(workbook.worksheets) != 1:
        raise ValueError("Expected one Choice worksheet")
    rows = list(workbook.active.values)
    tables = [row for row in rows if len(row) == 6]
    if not tables or tuple(tables[0]) != EXPECTED_HEADERS:
        raise ValueError("Choice columns or parameter periods have changed")
    if len(tables) != 101:
        raise ValueError(f"Expected 100 data rows, found {len(tables) - 1}")

    codes = [str(row[0]).strip() for row in tables[1:]]
    duplicate = [code for code, count in Counter(codes).items() if count != 1]
    if duplicate or set(codes) != expected:
        raise ValueError(
            f"Choice list mismatch; duplicates={duplicate}; "
            f"missing={sorted(expected - set(codes))}; extra={sorted(set(codes) - expected)}"
        )

    extracted = {}
    for row in tables[1:]:
        code, _name, sw1, sw2, audit, employees = row
        if any(not isinstance(value, str) or not value.strip() for value in (sw1, sw2, audit)):
            raise ValueError(f"Missing industry or audit opinion for {code}")
        if isinstance(employees, bool) or not isinstance(employees, int) or employees < 0:
            raise ValueError(f"Invalid 2025-12-31 employee count for {code}: {employees}")
        extracted[code] = {
            "industry_sw1": sw1.strip(),
            "industry_sw2": sw2.strip(),
            "audit_opinion": audit.strip(),
            "employees": employees,
        }

    OUTPUT.write_text(json.dumps(extracted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(extracted)} Choice records to {OUTPUT.name}")
    print("Industry version: SW 2021; employees as of 2025-12-31; audit: last annual report (2025)")


if __name__ == "__main__":
    main()
