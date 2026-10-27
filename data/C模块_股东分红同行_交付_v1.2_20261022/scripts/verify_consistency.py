# -*- coding: utf-8 -*-
"""一致性验证：用 fetch_c.py 的新逻辑从原始数据重算，与交付 JSON 逐条比对。

不访问网络，只用 raw_cache.json。目的是证明「脚本重跑 = 当前交付」，
避免出现「手工修的数据和脚本对不上」这种最容易被集成人抓的问题。
"""
import json
import os
import sys

import fetch_c as F


def _find(*cands):
    """按候选路径依次查找，兼容「在当前目录跑」和「在 scripts/ 子目录里跑」。"""
    for c in cands:
        if os.path.exists(c):
            return c
    return cands[0]

DATA = _find("data_C_holders_dividends.json",
             "../C-module/data_C_holders_dividends.json")
CACHE = _find("raw_cache.json")


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    cache = json.load(open(CACHE, encoding="utf-8"))

    seg_diff, dv_diff = [], []
    for key, co in data["companies"].items():
        raw = cache[key]["mainop"]
        # 还原成东财字段名，喂给 fetch_c 的取值函数
        pool = [{"REPORT_NAME": r["period"], "MAINOP_TYPE": r["type"],
                 "ITEM_NAME": r["item"], "MAIN_BUSINESS_INCOME": r["income"],
                 "MBI_RATIO": r["ratio"]} for r in raw]
        # 与 fetch_segments 同序：先只留「年报」，再取最新一期
        annual = [r for r in pool if (r["REPORT_NAME"] or "").endswith("年报")]
        pool = annual or pool
        latest = max((r["REPORT_NAME"] or "") for r in pool)
        pool = [r for r in pool if r["REPORT_NAME"] == latest]
        recalc = (F._pick_seg_type(pool, "2", "product", latest)
                  + F._pick_seg_type(pool, "3", "region", latest))
        if recalc != co["peers"]["segments"]:
            seg_diff.append(key)

        # 分红：用缓存净利 + 现有分红总额重算 payout_ratio
        np_by_year = {int(k): v for k, v in cache[key]["netprofit"].items()}
        for a in co["dividends"]["annual"]:
            y = a["fiscal_year"]
            pv = F.calc_payout(a["total_amount"] or 0, np_by_year.get(y))
            if pv != a["payout_ratio"]:
                dv_diff.append((key, y, a["payout_ratio"], pv))

    print(f"segments 与脚本重算不一致：{len(seg_diff)} 家 {seg_diff[:5]}")
    print(f"payout_ratio 与脚本重算不一致：{len(dv_diff)} 条")
    for d in dv_diff[:10]:
        print("   ", d)
    ok = not seg_diff and not dv_diff
    print("\n结论：" + ("脚本逻辑与交付数据完全一致" if ok else "存在不一致，需排查"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
