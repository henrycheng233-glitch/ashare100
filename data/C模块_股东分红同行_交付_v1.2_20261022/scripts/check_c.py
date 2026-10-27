# -*- coding: utf-8 -*-
"""
C 模块本地自检（不替代集成人的 validate.py，只在自己交付前挡一遍低级错误）。

检查项对应规范 §5、§6、§7 的硬约束：
  主键格式 / 字段齐全 / 类型 / 单位量级 / 日期格式 / null 用法 / 分年度归集
用法：python check_c.py data_C_holders_dividends.json
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

KEY_RE = re.compile(r"^\d{6}\.(SH|SZ|BJ)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
YEAR_RE = re.compile(r"^\d{4}$")

SH_FIELDS = ["controller", "controlling_shareholder", "controlling_ratio", "top10",
             "holder_num", "holder_num_change_pct", "holder_num_date",
             "inst_hold_ratio", "northbound_ratio", "executives",
             "pledge_ratio_total", "unlock_12m"]
DV_FIELDS = ["annual", "consecutive_years", "cum_dividend_5y",
             "cum_netprofit_5y", "payout_5y", "buyback_3y"]
PEER_FIELDS = ["peer_codes", "segments"]
YEARS = [2021, 2022, 2023, 2024, 2025]

errors, warns = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def check_shareholders(key, sh):
    for f in SH_FIELDS:
        if f not in sh:
            err(f"{key} shareholders 缺字段 {f}")

    for f in ("controller", "controlling_shareholder"):
        v = sh.get(f)
        if v is not None and not isinstance(v, str):
            err(f"{key} shareholders.{f} 应为 string，实际 {type(v).__name__}")

    for f in ("controlling_ratio", "holder_num_change_pct", "inst_hold_ratio",
              "northbound_ratio", "pledge_ratio_total"):
        v = sh.get(f)
        if v is not None and not is_num(v):
            err(f"{key} shareholders.{f} 应为 number/null，实际 {type(v).__name__}({v!r})")
        if v is not None and is_num(v) and not (-100 <= v <= 100):
            warn(f"{key} shareholders.{f}={v} 超出 ±100，疑似百分数/小数口径错")

    hn = sh.get("holder_num")
    if hn is not None:
        if not isinstance(hn, int):
            err(f"{key} holder_num 应为整数，实际 {hn!r}")
        elif hn < 1:
            err(f"{key} holder_num={hn}，下限 1 户")

    # v1.2：无控股股东 → ratio 必为 null；有控股股东 → ratio 应 > 0
    cs = sh.get("controlling_shareholder")
    cr = sh.get("controlling_ratio")
    if cs == "无控股股东" and cr is not None:
        err(f"{key} controlling_shareholder=无控股股东 但 ratio={cr}，应为 null")
    if cs and cs != "无控股股东" and cr is None:
        warn(f"{key} 有控股股东「{cs}」但 ratio 为 null")

    # inst_hold_ratio 是纯金融口径（基金/QFII/社保/券商/保险），
    # 超过 60% 基本说明把产业资本也加进来了
    ih = sh.get("inst_hold_ratio")
    if ih is not None and is_num(ih) and ih > 60:
        warn(f"{key} inst_hold_ratio={ih}% 偏高，纯金融口径通常 <40%，疑似混入一般法人")

    hd = sh.get("holder_num_date")
    if hd is not None and not DATE_RE.match(str(hd)):
        err(f"{key} holder_num_date 格式错：{hd!r}")

    t10 = sh.get("top10")
    if not isinstance(t10, list):
        err(f"{key} top10 应为 array")
    else:
        if len(t10) != 10:
            warn(f"{key} top10 只有 {len(t10)} 条（正常 10 条）")
        ranks = []
        for i, x in enumerate(t10):
            for f in ("rank", "name", "hold_num", "hold_ratio", "hold_num_change"):
                if f not in x:
                    err(f"{key} top10[{i}] 缺字段 {f}")
            if not isinstance(x.get("rank"), int):
                err(f"{key} top10[{i}].rank 应为 int")
            else:
                ranks.append(x["rank"])
            if x.get("hold_ratio") is not None and not is_num(x["hold_ratio"]):
                err(f"{key} top10[{i}].hold_ratio 应为 number")
        if ranks != sorted(ranks):
            warn(f"{key} top10 未按 rank 升序")
        ratios = [x.get("hold_ratio") or 0 for x in t10]
        if ratios != sorted(ratios, reverse=True):
            warn(f"{key} top10 未按持股比例降序")

    ex = sh.get("executives")
    if not isinstance(ex, list):
        err(f"{key} executives 应为 array")
    else:
        # v1.2：允许 2–4 人，无 CFO 不补
        if not ex:
            warn(f"{key} executives 为空")
        elif not (2 <= len(ex) <= 4):
            warn(f"{key} executives 有 {len(ex)} 人（规范 2–4 人）")
        for i, x in enumerate(ex):
            for f in ("name", "title", "pay"):
                if f not in x:
                    err(f"{key} executives[{i}] 缺字段 {f}")
            if x.get("pay") is not None and not is_num(x["pay"]):
                err(f"{key} executives[{i}].pay 应为 number/null")

    ul = sh.get("unlock_12m")
    if not isinstance(ul, list):
        err(f"{key} unlock_12m 应为 array（缺失写 []，不要 null）")
    else:
        for i, x in enumerate(ul):
            for f in ("date", "shares", "ratio"):
                if f not in x:
                    err(f"{key} unlock_12m[{i}] 缺字段 {f}")
            if x.get("date") and not DATE_RE.match(str(x["date"])):
                err(f"{key} unlock_12m[{i}].date 格式错：{x['date']!r}")


def check_dividends(key, dv):
    for f in DV_FIELDS:
        if f not in dv:
            err(f"{key} dividends 缺字段 {f}")

    ann = dv.get("annual")
    if not isinstance(ann, list):
        err(f"{key} dividends.annual 应为 array")
        return
    if len(ann) != 5:
        err(f"{key} dividends.annual 应为 5 条，实际 {len(ann)}")
    years = [a.get("fiscal_year") for a in ann]
    if years != YEARS:
        err(f"{key} dividends.annual 年份应为 2021-2025 升序，实际 {years}")
    for i, a in enumerate(ann):
        for f in ("fiscal_year", "dps_pretax", "total_amount", "payout_ratio",
                  "dividend_yield", "ex_date"):
            if f not in a:
                err(f"{key} annual[{i}] 缺字段 {f}")
        amt = a.get("total_amount")
        if amt is not None and is_num(amt) and 0 < amt < 1e4:
            warn(f"{key} annual[{i}].total_amount={amt} 量级可疑（单位应为元）")
        ed = a.get("ex_date")
        if ed is not None and not DATE_RE.match(str(ed)):
            err(f"{key} annual[{i}].ex_date 格式错：{ed!r}")

    for f in ("cum_dividend_5y", "cum_netprofit_5y", "payout_5y"):
        v = dv.get(f)
        if v is not None and not is_num(v):
            err(f"{key} dividends.{f} 应为 number/null")
    if not isinstance(dv.get("consecutive_years"), int):
        err(f"{key} dividends.consecutive_years 应为整数")

    bb = dv.get("buyback_3y")
    if bb is not None and not is_num(bb):
        err(f"{key} dividends.buyback_3y 应为 number/null")


def check_peers(key, pe):
    for f in PEER_FIELDS:
        if f not in pe:
            err(f"{key} peers 缺字段 {f}")
    pc = pe.get("peer_codes")
    if not isinstance(pc, list):
        err(f"{key} peer_codes 应为 array")
    else:
        if not (2 <= len(pc) <= 5):
            warn(f"{key} peer_codes 有 {len(pc)} 家（规范 2–5 家）")
        for c in pc:
            if not KEY_RE.match(str(c)):
                err(f"{key} peer_codes 格式错：{c!r}")
            if c == key:
                err(f"{key} peer_codes 含自己")
    segs = pe.get("segments")
    if not isinstance(segs, list):
        err(f"{key} segments 应为 array")
    else:
        # v1.2 §5.6 三条硬规则：剔「其中/合计/小计」、保留负数抵消行、同名同额去重；
        # 硬约束是每个 type 的 ratio 合计 ∈ [95, 100.5]。为此单个 type 允许超过 5 条
        # （源数据只有 1 条时也可能是 1 条），上限 11 条。
        for i, s in enumerate(segs):
            for f in ("name", "revenue", "ratio", "type", "period"):
                if f not in s:
                    err(f"{key} segments[{i}] 缺字段 {f}")
            if s.get("type") not in ("product", "region"):
                err(f"{key} segments[{i}].type 只能是 product/region，实际 {s.get('type')!r}")
            nm = str(s.get("name") or "")
            if any(t in nm for t in ("其中:", "其中：", "合计", "小计")):
                err(f"{key} segments[{i}] 残留子项/汇总行「{nm}」")
        for t in ("product", "region"):
            ss = [x for x in segs if x.get("type") == t]
            if not ss:
                continue
            if len(ss) > 11:
                err(f"{key} segments[{t}] 有 {len(ss)} 条，超出单类上限 11")
            tot = round(sum(x.get("ratio") or 0 for x in ss), 2)
            if not (95 <= tot <= 100.5):
                err(f"{key} segments[{t}] 合计 {tot}% 不在 [95, 100.5]")
            rs = [x.get("ratio") or 0 for x in ss]
            if rs != sorted(rs, reverse=True):
                warn(f"{key} segments[{t}] 未按收入降序")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else _find(
        "data_C_holders_dividends.json",
        "../C-module/data_C_holders_dividends.json")
    d = json.load(open(path, encoding="utf-8"))

    meta = d.get("meta") or {}
    for f in ("collector", "module", "as_of_date", "report_period",
              "generated_at", "schema_version", "count"):
        if f not in meta:
            err(f"meta 缺字段 {f}")
    if meta.get("as_of_date") != "2026-10-30":
        warn(f"meta.as_of_date={meta.get('as_of_date')}，规范固定 2026-10-30")
    if meta.get("report_period") != "2026-09-30":
        warn(f"meta.report_period={meta.get('report_period')}，规范固定 2026-09-30")
    if meta.get("schema_version") != "1.2":
        warn(f"meta.schema_version={meta.get('schema_version')!r}，v1.2 应为 '1.2'")

    cos = d.get("companies") or {}
    if meta.get("count") != len(cos):
        err(f"meta.count={meta.get('count')} 与实际 {len(cos)} 家不符")
    if len(cos) != 100:
        warn(f"companies 只有 {len(cos)} 家（应为 100）")

    for key, c in cos.items():
        if not KEY_RE.match(key):
            err(f"主键格式错：{key!r}（应 6 位代码.交易所）")
        if set(c.keys()) - {"shareholders", "dividends", "peers"}:
            err(f"{key} 出现越界 section：{set(c.keys())}")
        if "shareholders" in c:
            check_shareholders(key, c["shareholders"])
        if "dividends" in c:
            check_dividends(key, c["dividends"])
        if "peers" in c:
            check_peers(key, c["peers"])
        # 缺失值检查：不许用 "" / "-" / "N/A" 冒充
        for sec in c.values():
            for k, v in sec.items() if isinstance(sec, dict) else []:
                if isinstance(v, str) and v.strip() in ("", "-", "N/A", "暂无", "—"):
                    err(f"{key} 字段 {k} 用了占位符 {v!r}，应写 null")

    print("=" * 70)
    print(f"文件：{path}")
    print(f"公司数：{len(cos)}")
    print("=" * 70)

    if warns:
        print(f"\nWARNING（{len(warns)} 条）")
        for w in warns[:40]:
            print("  ! " + w)
        if len(warns) > 40:
            print(f"  ... 另有 {len(warns)-40} 条")

    if errors:
        print(f"\nERROR（{len(errors)} 条）")
        cnt = Counter(re.sub(r"^\S+ ", "", e) for e in errors)
        for e, n in cnt.most_common(30):
            print(f"  x {e}  ×{n}")
        print(f"\n结论：不通过（{len(errors)} error）")
        sys.exit(1)

    print(f"\n结论：通过（0 error，{len(warns)} warning）")


if __name__ == "__main__":
    main()
