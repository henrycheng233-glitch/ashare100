#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 A/B/C/D 四份模块数据合并成前端唯一依赖的 data.json。

- 只做合并不改数值（唯一例外：A 的 dividend_yield 已在入库前由集成人算好）
- 统一 meta：as_of_date / report_period / schema_version / count / sources
- 任何一家缺 section 直接报错，不产出半成品
"""
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = {
    "A": ROOT / "data/A模块_修订交付_2026-10-22/data_A_identity_market.json",
    "B": ROOT / "data/B-module/data_B_financials.json",
    "C": ROOT / "data/C模块_股东分红同行_交付_v1.2_20261022/C-module/data_C_holders_dividends.json",
    "D": ROOT / "data/D/data_D_qa_notice.json",
}
EXPECT = ["identity", "market", "financials", "shareholders", "dividends", "peers", "qa", "announcements"]


def main():
    merged, owners = {}, {}
    for mod, path in SRC.items():
        doc = json.loads(path.read_text(encoding="utf-8"))
        for code, comp in doc["companies"].items():
            bucket = merged.setdefault(code, {})
            for sec, val in comp.items():
                if sec in bucket:
                    sys.exit(f"[FAIL] {code} 的 {sec} 重复出现（{owners[(code, sec)]} 与 {mod}）")
                bucket[sec] = val
                owners[(code, sec)] = mod

    bad = {c: [s for s in EXPECT if s not in v] for c, v in merged.items()}
    bad = {c: m for c, m in bad.items() if m}
    if bad:
        sys.exit(f"[FAIL] 缺 section：{list(bad.items())[:3]}")
    if len(merged) != 100:
        sys.exit(f"[FAIL] 公司数 {len(merged)} != 100")

    out = {
        "meta": {
            "collector": "集成人",
            "module": "ALL",
            "as_of_date": "2026-10-22",
            "report_period": "2026-06-30",
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "schema_version": "1.4",
            "count": len(merged),
            "sources": {k: str(v.relative_to(ROOT)) for k, v in SRC.items()},
        },
        "companies": dict(sorted(merged.items())),
    }
    dst = ROOT / "data.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK -> {dst}  {len(merged)} 家 × {len(EXPECT)} section  {dst.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
