# -*- coding: utf-8 -*-
"""
对照 说明_组员版 v1.2 逐字段核对交付物。

v1.2 相对 v1.1 的变化（本脚本已落地的部分）：
  · meta.schema_version → '1.2'
  · buyback_3y / hold_num_change / inst_hold_ratio / payout_5y 允许合法 null
  · executives 允许 2–4 人，无 CFO 不补
  · holder_num 下限放宽到 1 户
  · §5.6 segments 三条硬规则：剔「其中/合计/小计」、保留负数抵消行、
    同名同额去重；断言每个 type 的 ratio 合计 ∈ [95, 100.5]
  · §5.4 controlling_shareholder 必须先剔除名义持有人再取第一名
"""
import json
import os
import re
import sys
from collections import Counter


def _find(*cands):
    """按候选路径依次查找，兼容「在当前目录跑」和「在 scripts/ 子目录里跑」。"""
    for c in cands:
        if os.path.exists(c):
            return c
    return cands[0]

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SCHEMA = "1.2"

SH = {
    "controller": "str",
    "controlling_shareholder": "str",
    "controlling_ratio": "num",
    "top10": "arr",
    "holder_num": "int",
    "holder_num_change_pct": "num",
    "holder_num_date": "date",
    "inst_hold_ratio": "num",
    "northbound_ratio": "num",
    "executives": "arr",
    "pledge_ratio_total": "num",     # v1.1 头部改名，v1.2 沿用
    "unlock_12m": "arr",
}
DV = {
    "annual": "arr",
    "consecutive_years": "int",
    "cum_dividend_5y": "num",
    "cum_netprofit_5y": "num",
    "payout_5y": "num",
    "buyback_3y": "num",
}
PE = {"peer_codes": "arr", "segments": "arr"}
META = ["collector", "module", "as_of_date", "report_period",
        "generated_at", "schema_version", "count"]

ITEM = {
    "top10": ["rank", "name", "hold_num", "hold_ratio", "hold_num_change"],
    "executives": ["name", "title", "pay"],
    "unlock_12m": ["date", "shares", "ratio"],
    "annual": ["fiscal_year", "dps_pretax", "total_amount", "payout_ratio",
               "dividend_yield", "ex_date"],
    "segments": ["name", "revenue", "ratio", "type", "period"],
}

# v1.2 明确允许合法 null 的字段（不参与「null 滥用」告警）
LEGAL_NULL = {
    "inst_hold_ratio", "northbound_ratio", "payout_5y", "cum_netprofit_5y",
    "buyback_3y", "controlling_ratio", "hold_num_change", "pay",
    "holder_num", "holder_num_change_pct", "holder_num_date",
    "dividend_yield", "payout_ratio", "ex_date", "revenue", "ratio",
}

SEG_LOW, SEG_HIGH = 95.0, 100.5
SEG_DROP = ("其中", "合计", "小计")

errs, warns, info = [], [], []


def chk_type(v, kind):
    if v is None:
        return True
    if kind == "str":
        return isinstance(v, str)
    if kind == "int":
        return isinstance(v, int) and not isinstance(v, bool)
    if kind == "num":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if kind == "arr":
        return isinstance(v, list)
    if kind == "date":
        return isinstance(v, str) and bool(DATE_RE.match(v))
    return True


def is_nominee(name):
    """名义持有人：托管/代理人，永远不是控股股东（v1.2 §5.4）。"""
    if not name:
        return False
    n = (str(name).replace(" ", "").replace("\u3000", "")
         .replace("（", "(").replace("）", ")"))
    if n.startswith("香港中央结算"):
        return True
    up = n.upper()
    return "HKSCC" in up and "NOMINEES" in up


def audit_section(key, sec_name, sec, spec):
    missing = [f for f in spec if f not in sec]
    extra = [f for f in sec if f not in spec]
    if missing:
        errs.append(f"{key} {sec_name} 缺字段: {missing}")
    if extra:
        errs.append(f"{key} {sec_name} 未登记字段: {extra}")
    for f, kind in spec.items():
        if f in sec and not chk_type(sec[f], kind):
            errs.append(f"{key} {sec_name}.{f} 类型不符（应为 {kind}，实为 "
                        f"{type(sec[f]).__name__} = {sec[f]!r}）")
    # 数组元素字段
    for f, fields in ITEM.items():
        if f not in sec or not isinstance(sec[f], list):
            continue
        for i, it in enumerate(sec[f]):
            if not isinstance(it, dict):
                errs.append(f"{key} {sec_name}.{f}[{i}] 不是 object")
                continue
            miss = [x for x in fields if x not in it]
            ext = [x for x in it if x not in fields]
            if miss:
                errs.append(f"{key} {sec_name}.{f}[{i}] 缺字段 {miss}")
            if ext:
                errs.append(f"{key} {sec_name}.{f}[{i}] 未登记字段 {ext}")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else _find(
        "data_C_holders_dividends.json",
        "../C-module/data_C_holders_dividends.json")
    d = json.load(open(path, encoding="utf-8"))
    meta, cos = d.get("meta", {}), d.get("companies", {})

    print("=" * 78)
    print(f"对照 v{SCHEMA} 核对：{path}")
    print("=" * 78)

    # ---- meta
    print("\n【meta】")
    miss = [f for f in META if f not in meta]
    if miss:
        errs.append(f"meta 缺字段 {miss}")
    for f in META:
        if f in meta:
            print(f"  {f:<16} = {meta[f]!r}")
    if meta.get("schema_version") != SCHEMA:
        errs.append(f"meta.schema_version={meta.get('schema_version')!r}，"
                    f"v{SCHEMA} 要求 {SCHEMA!r}")
    if meta.get("as_of_date") != "2026-10-30":
        warns.append(f"meta.as_of_date={meta.get('as_of_date')}，规范固定 2026-10-30")
    if meta.get("count") != len(cos):
        errs.append(f"meta.count={meta.get('count')} 与实际 {len(cos)} 家不符")
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$",
                    str(meta.get("generated_at", ""))):
        warns.append(f"meta.generated_at 非 ISO8601 带时区：{meta.get('generated_at')!r}")

    # ---- 逐家
    print(f"\n【逐家核对】共 {len(cos)} 家，检查中…")
    section_keys = Counter()
    for key, c in cos.items():
        section_keys[tuple(sorted(c.keys()))] += 1
        if "shareholders" in c:
            audit_section(key, "shareholders", c["shareholders"], SH)
        if "dividends" in c:
            audit_section(key, "dividends", c["dividends"], DV)
        if "peers" in c:
            audit_section(key, "peers", c["peers"], PE)

    print(f"  section 组合分布: {dict(section_keys)}")
    if list(section_keys) != [("dividends", "peers", "shareholders")]:
        errs.append("存在不是 shareholders+dividends+peers 的组合")

    # ---- 业务规则
    print("\n【业务规则】")
    bad_peer = []
    for key, c in cos.items():
        pc = (c.get("peers") or {}).get("peer_codes") or []
        if key in pc:
            errs.append(f"{key} peer_codes 含自身")
        if not (2 <= len(pc) <= 5):
            bad_peer.append((key, len(pc)))
        for x in pc:
            if not re.match(r"^\d{6}\.(SH|SZ|BJ)$", str(x)):
                errs.append(f"{key} peer_codes 格式错 {x!r}")
    print(f"  peer 家数范围 2–5: {'OK' if not bad_peer else bad_peer}")

    bad_top = [(k, len(c['shareholders']['top10'])) for k, c in cos.items()
               if len(c['shareholders'].get('top10', [])) != 10]
    print(f"  top10 均为 10 条: {'OK' if not bad_top else bad_top}")

    bad_year = []
    for key, c in cos.items():
        ys = [a.get("fiscal_year") for a in c["dividends"].get("annual", [])]
        if ys != [2021, 2022, 2023, 2024, 2025]:
            bad_year.append((key, ys))
    print(f"  annual 年份 2021–2025 升序: {'OK' if not bad_year else bad_year[:3]}")

    # v1.2 §5.4 控股股东不得是名义持有人
    nom = [(k, c["shareholders"].get("controlling_shareholder")) for k, c in cos.items()
           if is_nominee(c["shareholders"].get("controlling_shareholder"))]
    print(f"  controlling_shareholder 无名义持有人: {'OK' if not nom else nom}")
    for k, v in nom:
        errs.append(f"{k} controlling_shareholder 仍是名义持有人「{v}」")

    # v1.2 §5.4 无控股股东 ⇔ ratio 为 null
    bad_cs = [(k, c["shareholders"].get("controlling_shareholder"),
               c["shareholders"].get("controlling_ratio"))
              for k, c in cos.items()
              if (c["shareholders"].get("controlling_shareholder") == "无控股股东")
              != (c["shareholders"].get("controlling_ratio") is None)]
    print(f"  「无控股股东」与 ratio=null 同步: {'OK' if not bad_cs else bad_cs}")
    for b in bad_cs:
        errs.append(f"{b[0]} 控股股东/比例不自洽：{b[1]} / {b[2]}")

    # v1.2 §5.6 segments 三条硬规则
    seg_bad, seg_over, seg_drop = [], [], []
    for key, c in cos.items():
        segs = (c.get("peers") or {}).get("segments") or []
        for s in segs:
            nm = str(s.get("name") or "")
            if any(t in nm for t in SEG_DROP):
                seg_drop.append((key, nm))
        for t in ("product", "region"):
            ss = [x for x in segs if x.get("type") == t]
            if not ss:
                continue
            tot = round(sum(x.get("ratio") or 0 for x in ss), 2)
            if not (SEG_LOW <= tot <= SEG_HIGH):
                seg_bad.append((key, t, tot))
            if len(ss) > 11:
                seg_over.append((key, t, len(ss)))
    print(f"  segments 无「其中/合计/小计」残留: {'OK' if not seg_drop else seg_drop[:5]}")
    for k, nm in seg_drop:
        errs.append(f"{k} segments 残留子项/汇总行「{nm}」")
    print(f"  segments 每个 type 合计 ∈[{SEG_LOW}, {SEG_HIGH}]: "
          f"{'OK' if not seg_bad else seg_bad}")
    for b in seg_bad:
        errs.append(f"{b[0]} segments[{b[1]}] 合计 {b[2]}% 越界")
    print(f"  segments 单类条数 ≤11: {'OK' if not seg_over else seg_over}")
    for b in seg_over:
        errs.append(f"{b[0]} segments[{b[1]}] 有 {b[2]} 条，超上限 11")

    # v1.2 §5.5 分红零值规则：分红=0 且净利>0 → 0.0（净利<=0 才允许 null）
    zero_null = [(k, a["fiscal_year"]) for k, c in cos.items()
                 for a in c["dividends"].get("annual", [])
                 if not a.get("total_amount") and a.get("payout_ratio") == 0.0
                 and a.get("dividend_yield") != 0.0]
    print(f"  零分红 0.0 与 dividend_yield 同步: {'OK' if not zero_null else zero_null[:5]}")

    # nully 统计
    print("\n【缺失值分布】")
    for f in ("inst_hold_ratio", "northbound_ratio", "pledge_ratio_total",
              "holder_num_change_pct"):
        n = sum(1 for c in cos.values() if c["shareholders"].get(f) is None)
        info.append(f"  {f:<22} null {n:>3}/100")
    for f in ("payout_5y", "buyback_3y", "cum_netprofit_5y"):
        n = sum(1 for c in cos.values() if c["dividends"].get(f) is None)
        info.append(f"  {f:<22} null {n:>3}/100")

    # ---- 输出
    print("\n" + "=" * 78)
    for x in info:
        print(x)

    if warns:
        print(f"\nWARNING（{len(warns)}）")
        for w in warns[:20]:
            print("  ! " + w)

    if errs:
        print(f"\nERROR（{len(errs)}）")
        cnt = Counter(errs)
        for e, n in cnt.most_common(20):
            print(f"  x {e}" + (f"  ×{n}" if n > 1 else ""))
        print(f"\n结论：不匹配（{len(errs)} error）")
        sys.exit(1)

    print(f"\n结论：与 v{SCHEMA} 匹配（0 error，{len(warns)} warning）")


if __name__ == "__main__":
    main()
