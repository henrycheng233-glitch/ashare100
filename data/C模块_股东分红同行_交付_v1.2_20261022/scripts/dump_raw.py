# -*- coding: utf-8 -*-
"""一次性缓存 100 家的 MAINOP（主营构成）与 LICO（归母净利）原始行 → raw_cache.json

只读接口、只写本地缓存，不碰交付文件。后续修复全部离线进行。
"""
import json
import random
import time

from fetch_c import dc_report, ymd
from stocks import STOCKS

ANNUAL_YEARS = [2021, 2022, 2023, 2024, 2025]


def main():
    cache = {}
    for i, st in enumerate(STOCKS, 1):
        key = st["key"]
        seg = dc_report("RPT_F10_FN_MAINOP", f'(SECUCODE="{key}")', size=200,
                        sort="REPORT_DATE")
        time.sleep(random.uniform(0.3, 0.5))
        prof = dc_report("RPT_LICO_FN_CPD", f'(SECUCODE="{key}")', size=40,
                         sort="REPORTDATE")
        time.sleep(random.uniform(0.3, 0.5))

        np_by_year = {}
        for p in prof:
            d = ymd(p.get("REPORTDATE"))
            if d and d.endswith("12-31"):
                y = int(d[:4])
                if y in ANNUAL_YEARS:
                    v = p.get("PARENT_NETPROFIT")
                    if v is not None:
                        np_by_year[y] = float(v)

        cache[key] = {
            "name": st["name"],
            "mainop": [
                {"period": r.get("REPORT_NAME"),
                 "type": str(r.get("MAINOP_TYPE")),
                 "item": r.get("ITEM_NAME"),
                 "income": r.get("MAIN_BUSINESS_INCOME"),
                 "ratio": r.get("MBI_RATIO")}
                for r in seg
            ],
            "netprofit": np_by_year,
        }
        print(f"[{i:>3}/100] {key} {st['name']:<8} mainop={len(seg):>3} "
              f"np={len(np_by_year)}", flush=True)
        if i % 20 == 0:
            json.dump(cache, open("raw_cache.json", "w", encoding="utf-8"),
                      ensure_ascii=False)

    json.dump(cache, open("raw_cache.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"\n缓存完成 {len(cache)} 家 → raw_cache.json")


if __name__ == "__main__":
    main()
