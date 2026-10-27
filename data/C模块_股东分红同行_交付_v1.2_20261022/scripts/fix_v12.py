# -*- coding: utf-8 -*-
"""v1.2 返工修复：三处必修 + schema_version。

① 控股股东剔除名义持有人后再取第一名；
② segments 按 §5.6 三条硬规则重算（剔除「其中/合计/小计」、保留负数抵消行、
   同名同额去重），断言每个 type 合计 ∈ [95, 100.5]；
③ 分红零值规则：分红=0 且当年归母净利>0 → payout_ratio / dividend_yield = 0.0。

数据来源：data_C_holders_dividends.json（现有交付）+ raw_cache.json（原始行缓存）。
可重复执行：先备份 .bak，再就地覆盖。
"""
import json
import os
import shutil
import sys


def _find(*cands):
    """按候选路径依次查找，兼容「在当前目录跑」和「在 scripts/ 子目录里跑」。"""
    for c in cands:
        if os.path.exists(c):
            return c
    return cands[0]

DATA = _find("data_C_holders_dividends.json",
             "../C-module/data_C_holders_dividends.json")
CACHE = _find("raw_cache.json")

ANNUAL_YEARS = [2021, 2022, 2023, 2024, 2025]

# ---------------------------------------------------------------- ① 控股股东
NOMINEE_PREFIX = "香港中央结算"


def _norm(name):
    """归一化：去空格、全角括号转半角、大写。用于名义持有人识别。"""
    if not name:
        return ""
    n = str(name).replace(" ", "").replace("\u3000", "")
    n = n.replace("（", "(").replace("）", ")").replace("，", ",")
    return n


def is_nominee(name):
    """名义持有人（托管/代理人），永远不会是控股股东。

    覆盖 4 种写法及其带后缀变体：
      香港中央结算有限公司                                     —— 陆股通托管
      香港中央结算(代理人)有限公司                              —— H 股代理人
      香港中央结算代理人有限公司                                —— 同上，无括号
      HKSCC NOMINEES LIMITED / 香港中央结算(代理人)有限公司(HKSCC NOMINEES LIMITED)
    """
    n = _norm(name)
    if not n:
        return False
    if n.startswith(NOMINEE_PREFIX):
        return True
    up = n.upper()
    return "HKSCC" in up and "NOMINEES" in up


def fix_holders(data, log):
    """先剔除名义持有人，再取第一名；<10% 且无实控人 → 无控股股东 / null。"""
    changed = []
    for key, co in data["companies"].items():
        sh = co["shareholders"]
        old_name = sh.get("controlling_shareholder")
        old_ratio = sh.get("controlling_ratio")

        cand = [t for t in sh.get("top10") or [] if not is_nominee(t.get("name"))]
        if not cand:
            log.append(f"  {key} 剔除后无剩余股东，保留原值")
            continue
        cand.sort(key=lambda t: (t.get("rank") or 99))
        top1 = cand[0]

        new_name, new_ratio = top1.get("name"), top1.get("hold_ratio")
        controller = sh.get("controller") or ""
        if (new_ratio is not None and new_ratio < 10
                and controller.strip() == "无实际控制人"):
            new_name, new_ratio = "无控股股东", None

        if new_name != old_name or new_ratio != old_ratio:
            sh["controlling_shareholder"] = new_name
            sh["controlling_ratio"] = new_ratio
            changed.append((key, old_name, old_ratio, new_name, new_ratio))
    log.append(f"[①] 控股股东修正 {len(changed)} 家")
    for key, o, orr, n, nr in changed:
        log.append(f"    {key}  {o} {orr} → {n} {nr}")
    return changed


# ---------------------------------------------------------------- ② segments
DROP_TOKENS = ("其中", "合计", "小计")
MAX_ITEMS = 9          # 为凑到 95% 允许超出「前 5」，硬上限 9
LOW, HIGH = 95.0, 100.5


def _num(x):
    if x is None or isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    try:
        return float(str(x).replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _scale(rows):
    """判断 MBI_RATIO 是小数(0.8134)还是百分数(81.34)，按组判断更稳。

    必须用**带符号**合计：紫金/中石油这类有 -67% 抵消行的公司，正项+绝对负数
    会超过 2.0，用绝对值会被误判成百分数。完整拆分下小数口径合计≈1、百分数≈100。
    """
    vals = [_num(r.get("ratio")) for r in rows if _num(r.get("ratio")) is not None]
    if not vals:
        return 1.0
    return 100.0 if abs(sum(vals)) <= 2.0 else 1.0


def clean_rows(rows, log, key, label):
    """三条硬规则的前两条半：剔「其中/合计/小计」、保留负数、同名同额去重。"""
    kept = []
    for r in rows:
        nm = str(r.get("item") or "")
        if any(t in nm for t in DROP_TOKENS):
            continue
        kept.append(r)

    # 同名同额去重：同 type 内 income 与 ratio 完全相同的两行只留一条，
    # 优先留名字不含「补充」的那条（如中国移动「其他主营业务」vs「其他(补充)」）。
    out, seen = [], {}
    for r in kept:
        sig = (_num(r.get("income")), _num(r.get("ratio")))
        if sig == (None, None):
            out.append(r)
            continue
        if sig in seen:
            prev = seen[sig]
            if "补充" in str(r.get("item")) and "补充" not in str(prev.get("item")):
                log.append(f"  {key}/{label} 同名同额去重，丢弃「{r.get('item')}」")
                continue
            log.append(f"  {key}/{label} 同额重复，丢弃「{r.get('item')}」")
            continue
        seen[sig] = r
        out.append(r)
    return out


def build_segments(cache_rows, log, key):
    """按 type 组装 segments。"""
    annual = [r for r in cache_rows if (r.get("period") or "").endswith("年报")]
    pool = annual or cache_rows
    if not pool:
        return []
    latest = max((r.get("period") or "") for r in pool)
    pool = [r for r in pool if r.get("period") == latest]

    result = []
    for t, label in (("2", "product"), ("3", "region")):
        rows = [r for r in pool if str(r.get("type")) == t]
        if not rows:
            continue
        rows = clean_rows(rows, log, key, label)
        f = _scale(rows)
        for r in rows:
            inc = _num(r.get("income"))
            ra = _num(r.get("ratio"))
            r["_inc"] = inc
            r["_ratio"] = None if ra is None else round(ra * f, 2)
        if not rows:
            continue

        neg = [r for r in rows if (r["_inc"] or 0) < 0]
        pos = sorted([r for r in rows if (r["_inc"] or 0) >= 0],
                     key=lambda r: -(r["_inc"] or 0))

        slots = max(1, 5 - len(neg))
        sel = pos[:slots]
        rest = pos[slots:]
        total = sum(r["_ratio"] or 0 for r in sel + neg)
        while total < LOW and rest:
            r = rest.pop(0)
            sel.append(r)
            total += r["_ratio"] or 0
        if len(sel) + len(neg) > MAX_ITEMS:
            log.append(f"  {key}/{label} 需 {len(sel)+len(neg)} 条才够 95%，"
                       f"超出建议上限 {MAX_ITEMS}，为保证合计≥95 予以保留")

        chosen = sorted(sel + neg, key=lambda r: -(r["_inc"] or 0))
        for r in chosen:
            result.append({
                "name": r.get("item"),
                "revenue": round(r["_inc"], 2) if r["_inc"] is not None else None,
                "ratio": r["_ratio"],
                "type": label,
                "period": latest,
            })
    return result


def fix_segments(data, cache, log):
    """重算全部 segments 并断言区间。"""
    bad = []
    for key, co in data["companies"].items():
        rows = (cache.get(key) or {}).get("mainop") or []
        seg = build_segments(rows, log, key)
        co["peers"]["segments"] = seg
        for t in ("product", "region"):
            s = sum(x["ratio"] or 0 for x in seg if x["type"] == t)
            if not s:
                continue
            if not (LOW <= s <= HIGH):
                bad.append((key, t, round(s, 2), len([x for x in seg if x["type"] == t])))
    log.append(f"[②] segments 重算完成；越界 {len(bad)} 处")
    for b in bad:
        log.append(f"    {b[0]} {b[1]} 合计={b[2]} 条数={b[3]}")
    return bad


# ---------------------------------------------------------------- ③ 分红零值
def fix_dividends(data, cache, log):
    """分红=0 且当年归母净利>0 → payout_ratio / dividend_yield 填 0.0。"""
    fixed, still = 0, 0
    detail = []
    for key, co in data["companies"].items():
        np_by_year = (cache.get(key) or {}).get("netprofit") or {}
        for a in co["dividends"]["annual"]:
            if a.get("total_amount"):
                continue
            npv = np_by_year.get(str(a["fiscal_year"])) or np_by_year.get(a["fiscal_year"])
            if npv is not None and npv > 0:
                if a.get("payout_ratio") != 0.0 or a.get("dividend_yield") != 0.0:
                    fixed += 1
                    detail.append((key, a["fiscal_year"], round(npv / 1e8, 2)))
                a["payout_ratio"] = 0.0
                a["dividend_yield"] = 0.0
            else:
                still += 1
    log.append(f"[③] 零分红填 0.0：{fixed} 条；净利<=0 或缺净利保留 null：{still} 条")
    for d in detail[:40]:
        log.append(f"    {d[0]} {d[1]} 净利={d[2]}亿")
    return fixed, still


# ---------------------------------------------------------------- 主流程
def main():
    data = json.load(open(DATA, encoding="utf-8"))
    cache = json.load(open(CACHE, encoding="utf-8"))
    log = []

    shutil.copy(DATA, DATA + ".bak")
    log.append(f"已备份 {DATA}.bak")

    fix_holders(data, log)
    bad = fix_segments(data, cache, log)
    fix_dividends(data, cache, log)

    data["meta"]["schema_version"] = "1.2"
    log.append("[④] meta.schema_version → 1.2")

    with open(DATA, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    text = "\n".join(log)
    open("fix_v12.log", "w", encoding="utf-8").write(text + "\n")
    print(text)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
