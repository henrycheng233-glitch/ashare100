# -*- coding: utf-8 -*-
"""
生成 peers_map.csv，供集成人抽查同行映射。

列：code, name, industry_sw2, peer1..peer4
- code 用 6 位代码；同时给出带交易所后缀的 secucode 便于对齐主键
- peer 为空表示该行业确实没有更多可比公司（如通信服务Ⅱ只有 2-3 家）
"""
import csv
import json
import os

from stocks import STOCKS

HERE = os.path.dirname(os.path.abspath(__file__))
COLUMNS = ["code", "secucode", "name", "industry_sw1", "industry_sw2",
           "peer1", "peer2", "peer3", "peer4", "peer1_name", "peer2_name",
           "peer3_name", "peer4_name", "peer_count", "source"]


def main():
    data = json.load(open(os.path.join(HERE, "data_C_holders_dividends.json"), encoding="utf-8"))
    uni = {x["code"]: x for x in json.load(open(os.path.join(HERE, "market_universe.json"),
                                                encoding="utf-8"))}
    cos = data["companies"]

    rows = []
    for s in STOCKS:
        key, code = s["key"], s["code"]
        peers = (cos.get(key, {}).get("peers") or {}).get("peer_codes") or []
        me = uni.get(code) or {}
        rec = {
            "code": code,
            "secucode": key,
            "name": s["name"],
            "industry_sw1": me.get("sw1"),
            "industry_sw2": me.get("sw2"),
            "peer_count": len(peers),
            "source": "sw2优先+市值降序" if len(peers) >= 3 else "sw1补足",
        }
        for i in range(4):
            rec[f"peer{i+1}"] = peers[i] if i < len(peers) else ""
            rec[f"peer{i+1}_name"] = (
                uni.get(peers[i].split(".")[0], {}).get("abbr", "") if i < len(peers) else ""
            )
        rows.append(rec)

    out = os.path.join(HERE, "peers_map.csv")
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    print(f"已生成 {out}，{len(rows)} 行")
    from collections import Counter
    print("同行家数分布:", dict(sorted(Counter(r["peer_count"] for r in rows).items())))
    print("\n样例：")
    for r in rows[:3]:
        print(f"  {r['code']} {r['name']:<8} {r['industry_sw2']:<10} "
              f"{[r['peer1'], r['peer2'], r['peer3'], r['peer4']]}")
    # 只有 2 家的
    two = [r for r in rows if r["peer_count"] <= 2]
    if two:
        print(f"\n同行 ≤2 家的（{len(two)} 家）：")
        for r in two:
            print(f"  {r['code']} {r['name']:<8} {r['industry_sw2']:<10} {[r['peer1'], r['peer2']]}")


if __name__ == "__main__":
    main()
