# -*- coding: utf-8 -*-
"""回源探测：16 家超 100% 的 MAINOP 原始行，看清成因。只读，不写数据。"""
import json
import sys

from fetch_c import dc_report, num

BAD = ['000725.SZ', '002352.SZ', '002714.SZ', '600030.SH', '600183.SH', '600941.SH',
       '601066.SH', '601211.SH', '601225.SH', '601319.SH', '601857.SH', '601898.SH',
       '601899.SH', '603993.SH', '688808.SH', '688825.SH']

def main():
    out = {}
    for key in BAD:
        rows = dc_report("RPT_F10_FN_MAINOP", f'(SECUCODE="{key}")', size=200,
                         sort="REPORT_DATE")
        annual = [r for r in rows if (r.get("REPORT_NAME") or "").endswith("年报")]
        pool = annual or rows
        latest = max((r.get("REPORT_NAME") or "") for r in pool)
        pool = [r for r in pool if r.get("REPORT_NAME") == latest]
        rec = {"period": latest, "types": {}}
        for t, label in (("1", "industry"), ("2", "product"), ("3", "region")):
            items = [r for r in pool if str(r.get("MAINOP_TYPE")) == t]
            # 原本的排序口径
            items.sort(key=lambda x: num(x.get("MAIN_BUSINESS_INCOME")) or 0, reverse=True)
            rec["types"][label] = [
                {"name": r.get("ITEM_NAME"),
                 "rev": num(r.get("MAIN_BUSINESS_INCOME")),
                 "ratio": num(r.get("MBI_RATIO"))}
                for r in items
            ]
        out[key] = rec
        print(f"{key} {latest}  rows={len(pool)}", flush=True)
        for label, items in rec["types"].items():
            tot = sum((x["ratio"] or 0) for x in items)
            print(f"  [{label}] n={len(items)} rawsum={tot:.2f}", flush=True)
            for x in items:
                r = x["ratio"]
                r = r * 100 if r is not None and abs(r) <= 1.5 else r
                print(f"      {str(x['name'])[:28]:<30} {r:>8.2f}  "
                      f"{(x['rev'] or 0)/1e8:>12.2f}亿", flush=True)
    json.dump(out, open("seg_raw.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

if __name__ == "__main__":
    sys.exit(main())
