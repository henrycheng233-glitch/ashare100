#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A股百强报告 · 数据自检 / 合并工具

用法：
  python3 validate.py data_A_identity_market.json          # 单文件自检
  python3 validate.py --merge data.json a.json b.json ...  # 合并 + 全局校验
  python3 validate.py --template A                         # 打印空白骨架（A/B/C/D）

规则来源：说明_组员版.md v1.0，改规则请同步改本文件并升版本号。
"""
import argparse
import json
import re
import sys
from datetime import datetime

SCHEMA_VERSION = "1.4"
MODULES = {
    "A": ["identity", "market"],
    "B": ["financials"],
    "C": ["shareholders", "dividends", "peers"],
    "D": ["qa", "announcements"],
    "ALL": ["identity", "market", "financials", "shareholders",
            "dividends", "peers", "qa", "announcements"],
}
CODE_RE = re.compile(r"^\d{6}\.(SH|SZ|BJ)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# type: str / num / int / date / arr / obj / arr_str / arr_obj
IDENTITY = [
    ("code", "str", 1), ("exchange", "str", 1), ("board", "str", 1),
    ("name_full", "str", 1), ("name_abbr", "str", 1), ("name_en", "str", 0),
    ("pinyin_abbr", "str", 1), ("aliases", "arr_str", 1), ("former_names", "arr_str", 0),
    ("industry_sw1", "str", 1), ("industry_sw2", "str", 1), ("list_date", "date", 1),
    ("province", "str", 1), ("city", "str", 1), ("website", "str", 0),
    ("chairman", "str", 0), ("employees", "int", 1),
    ("business_summary", "str", 1), ("profile", "str", 1),
    ("st_status", "str", 1), ("audit_opinion", "str", 1),
]
MARKET = [
    ("as_of_date", "date", 1), ("price", "num", 1), ("change_pct", "num", 1),
    ("total_mv", "num", 1), ("float_mv", "num", 1), ("total_shares", "num", 1),
    ("float_shares", "num", 1), ("pe_ttm", "num", 1), ("pe_static", "num", 1),
    ("pb", "num", 1), ("ps_ttm", "num", 1), ("dividend_yield", "num", 1),
    ("turnover_rate", "num", 1), ("amount", "num", 0),
    ("high_52w", "num", 1), ("low_52w", "num", 1),
    ("ytd_return", "num", 0), ("return_1y", "num", 0), ("return_3y", "num", 0),
    ("index_members", "arr_str", 1),
]
ANNUAL = [
    ("fiscal_year", "int", 1), ("report_date", "date", 1),  # 下面数值字段允许 null（上市前年份）
    ("revenue", "num", 0), ("revenue_yoy", "num", 0),
    ("net_profit", "num", 0), ("net_profit_yoy", "num", 0), ("net_profit_deducted", "num", 0),
    ("gross_margin", "num", 0), ("net_margin", "num", 0),
    ("selling_expense_ratio", "num", 0), ("admin_expense_ratio", "num", 0),
    ("finance_expense_ratio", "num", 0), ("rd_expense", "num", 0), ("rd_ratio", "num", 0),
    ("eps", "num", 0), ("bvps", "num", 0), ("roe", "num", 0), ("roa", "num", 0),
    ("total_assets", "num", 0), ("total_liab", "num", 0), ("debt_ratio", "num", 0),
    ("cash", "num", 0), ("receivables", "num", 0), ("inventory", "num", 0),
    ("goodwill", "num", 0), ("interest_debt", "num", 0), ("equity_parent", "num", 0),
    ("ocf", "num", 0), ("capex", "num", 0), ("fcf", "num", 0), ("ocf_to_np", "num", 0),
]
LATEST = [
    ("report_period", "date", 1), ("report_type", "str", 1),
    ("revenue", "num", 1), ("revenue_yoy", "num", 1),
    ("net_profit", "num", 1), ("net_profit_yoy", "num", 1), ("net_profit_deducted", "num", 1),
    ("gross_margin", "num", 0), ("net_margin", "num", 0), ("roe", "num", 0),
    ("eps", "num", 1), ("debt_ratio", "num", 1), ("ocf", "num", 1),
]
DERIVED = [
    ("revenue_cagr_3y", "num", 0), ("net_profit_cagr_3y", "num", 0),
    ("receivables_to_revenue", "num", 0), ("goodwill_to_equity", "num", 0),
]
SHAREHOLDERS = [
    ("controller", "str", 1), ("controlling_shareholder", "str", 1), ("controlling_ratio", "num", 0),
    ("top10", "arr_obj", 1), ("holder_num", "int", 1), ("holder_num_change_pct", "num", 0),
    ("holder_num_date", "date", 1), ("inst_hold_ratio", "num", 0), ("northbound_ratio", "num", 0),
    ("executives", "arr_obj", 1), ("pledge_ratio_total", "num", 1), ("unlock_12m", "arr_obj", 1),
]
DIVIDENDS = [
    ("annual", "arr_obj", 1), ("consecutive_years", "int", 1),
    ("cum_dividend_5y", "num", 1), ("cum_netprofit_5y", "num", 1),
    ("payout_5y", "num", 0), ("buyback_3y", "num", 0),
]
PEERS = [("peer_codes", "arr_str", 1), ("segments", "arr_obj", 1)]
QA = [("items", "arr_obj", 1), ("count_12m", "int", 0)]
ANNOUNCEMENTS = [("items", "arr_obj", 1), ("count_12m", "int", 0)]

SECTIONS = {
    "identity": IDENTITY, "market": MARKET, "shareholders": SHAREHOLDERS,
    "dividends": DIVIDENDS, "peers": PEERS, "qa": QA,
    "announcements": ANNOUNCEMENTS,
}
NESTED = {
    "financials.annual": ANNUAL,
    "financials.latest": LATEST,
    "financials.derived": DERIVED,
    "shareholders.top10": [
        ("rank", "int", 1), ("name", "str", 1), ("hold_num", "num", 1),
        ("hold_ratio", "num", 1), ("hold_num_change", "num", 0)],
    "shareholders.executives": [("name", "str", 1), ("title", "str", 1), ("pay", "num", 0)],
    "shareholders.unlock_12m": [("date", "date", 1), ("shares", "num", 1), ("ratio", "num", 1)],
    "dividends.annual": [
        ("fiscal_year", "int", 1), ("dps_pretax", "num", 1), ("total_amount", "num", 1),
        ("payout_ratio", "num", 0), ("dividend_yield", "num", 0), ("ex_date", "date", 0)],
    "peers.segments": [
        ("name", "str", 1), ("revenue", "num", 1), ("ratio", "num", 1),
        ("type", "str", 1), ("period", "str", 1)],
    "qa.items": [
        ("question", "str", 0), ("answer", "str", 0), ("ask_date", "date", 1),
        ("answer_date", "date", 0), ("source", "str", 1), ("url", "str", 1)],
    "announcements.items": [
        ("title", "str", 1), ("date", "date", 1), ("url", "str", 1), ("type", "str", 0)],
}

# 量级 sanity（宽松，只挡明显错误：单位写错/漏乘 1e8）
RANGES = {
    "market.price": (0.5, 1e5), "market.total_mv": (1e8, 1e14),
    "market.float_mv": (1e8, 1e14), "market.amount": (1e3, 1e12),
    "market.turnover_rate": (0, 100), "market.dividend_yield": (0, 100),
    "market.pe_ttm": (-1e5, 1e5), "market.pb": (-1e4, 1e4),
    "identity.employees": (1, 1e7),
    "financials.latest.revenue": (-5e13, 5e13),
    "financials.latest.net_profit": (-1e12, 1e12),
    "shareholders.holder_num": (1, 1e8),
    "shareholders.controlling_ratio": (0, 100),
    "shareholders.pledge_ratio_total": (0, 100),
}

errors, warnings = [], []


def err(where, msg):
    errors.append(f"ERROR  {where}: {msg}")


def warn(where, msg):
    warnings.append(f"WARN   {where}: {msg}")


def check_type(val, typ):
    if val is None:
        return True
    if typ == "str":
        return isinstance(val, str)
    if typ == "num":
        return isinstance(val, (int, float)) and not isinstance(val, bool)
    if typ == "int":
        return isinstance(val, int) and not isinstance(val, bool)
    if typ == "date":
        return isinstance(val, str) and bool(DATE_RE.match(val))
    if typ == "arr":
        return isinstance(val, list)
    if typ == "arr_str":
        return isinstance(val, list) and all(isinstance(x, str) for x in val)
    if typ == "arr_obj":
        return isinstance(val, list) and all(isinstance(x, dict) for x in val)
    if typ == "obj":
        return isinstance(val, dict)
    return True


def check_fields(obj, spec, where, code=None):
    for key, typ, required in spec:
        if key not in obj:
            if required:
                err(where, f"缺少字段 `{key}`")
            continue
        val = obj[key]
        if val is None:
            if required:
                err(where, f"`{key}` 为 null（必填）")
            continue
        if not check_type(val, typ):
            err(where, f"`{key}` 类型错误，期望 {typ}，实际 {type(val).__name__}")
            continue
        if typ == "date":
            try:
                datetime.strptime(val, "%Y-%m-%d")
            except ValueError:
                err(where, f"`{key}` 日期非法：{val}")
        if key == "url" and isinstance(val, str):
            if not val.startswith("http"):
                warn(where, f"`{key}` 不是完整 URL：{val[:60]}")
            elif "/ajax/" in val:
                err(where, f"`{key}` 指向 AJAX 接口，必须改成可阅读页面：{val[:70]}")
        if code and key == "code" and val != code[:6]:
            err(where, f"`code`={val} 与主键 {code} 不一致")


def check_unit_scale(val, where, key):
    """金额字段必须是「元」。绝对值 < 1e8（1 亿）基本可以断定是把「亿元」当「元」填了。"""
    if val is None or not isinstance(val, (int, float)):
        return
    if 0 < abs(val) < 1e6:
        warn(where, f"`{key}`={val} 偏小，确认不是把「万元」当「元」填了")


def check_range(val, lo, hi, where, key):
    if val is None:
        return
    if not isinstance(val, (int, float)):
        return
    if not (lo <= val <= hi):
        err(where, f"`{key}`={val} 超出合理量级（{lo}~{hi}），疑似单位写错")


def validate_company(code, comp, module):
    base = f"{code}"
    have = [s for s in MODULES[module] if s in comp]
    if not have:
        err(base, f"文件声明 module={module}，但这家公司没有 {MODULES[module]} 任何一个 section")
        return 0
    extra = [s for s in comp if s not in MODULES[module]]
    if extra:
        warn(base, f"出现不属于本模块的 section：{extra}（合并时会冲突）")
    nulls = 0

    for sec in have:
        if sec == "financials":
            fin = comp[sec]
            if "unit" not in fin or fin.get("unit") != "CNY":
                warn(base, "financials.unit 缺失或不是 CNY")
            annual = fin.get("annual")
            if not isinstance(annual, list) or len(annual) != 5:
                err(base, f"financials.annual 必须是 5 条，实际 {len(annual) if isinstance(annual, list) else 'N/A'}")
            else:
                years = [x.get("fiscal_year") for x in annual]
                if years != sorted(years):
                    warn(base, f"financials.annual 未按年份升序：{years}")
                if annual[4].get("revenue") is None:
                    err(base, "financials.annual[4]（2025 年报）的 revenue 为空")
                if years and years[-1] != 2025:
                    warn(base, f"financials.annual 最后一年应为 2025，实际 {years[-1]}")
                for i, row in enumerate(annual):
                    check_fields(row, ANNUAL, f"{base}.annual[{i}]")
                    where = f"{base}.annual[{i}]"
                    check_unit_scale(row.get("revenue"), where, "revenue")
                    check_range(row.get("net_profit"), -1e12, 1e12, where, "net_profit")
                    check_range(row.get("total_assets"), 0, 1e14, where, "total_assets")
            for sub, spec in [("latest", LATEST), ("derived", DERIVED)]:
                if sub not in fin or not isinstance(fin.get(sub), dict):
                    err(base, f"financials.{sub} 缺失或不是对象")
                    continue
                check_fields(fin[sub], spec, f"{base}.{sub}")
                if sub == "latest":
                    check_unit_scale(fin[sub].get("revenue"), f"{base}.latest", "revenue")
            continue

        if not isinstance(comp[sec], dict):
            err(base, f"{sec} 必须是对象")
            continue
        check_fields(comp[sec], SECTIONS[sec], f"{base}.{sec}", code)
        if sec == "shareholders":
            cs = str(comp[sec].get("controlling_shareholder") or "")
            if "香港中央结算" in cs or "HKSCC" in cs.upper():
                err(f"{base}.shareholders", f"控股股东填成了名义持有人：{cs[:36]}")
        if sec == "peers":
            seg = comp[sec].get("segments") or []
            for tp in ("product", "region"):
                ssum = sum(float(x.get("ratio") or 0) for x in seg if x.get("type") == tp)
                if ssum > 100.5:
                    err(f"{base}.peers", f"{tp} 占比合计 {ssum:.1f}% > 100（重复计算或缺抵消行）")
        if sec == "dividends":
            for i, x in enumerate(comp[sec].get("annual") or []):
                if (x.get("total_amount") or 0) > 0 and x.get("payout_ratio") is None:
                    err(f"{base}.dividends.annual[{i}]", "已分红但 payout_ratio 为 null")
        if sec == "identity":
            if (comp[sec].get("chairman") in (None, "")):
                warn(f"{base}.identity", "`chairman` 为空（需在报告里注明“董事长空缺/待核实”）")
            al = comp[sec].get("aliases")
            if isinstance(al, list) and not al:
                err(f"{base}.identity", "aliases 不能为空（至少 1 条，见说明 5.1）")
            bs = comp[sec].get("business_summary")
            if isinstance(bs, str) and len(bs) > 50:
                warn(f"{base}.identity", f"business_summary 超 50 字（{len(bs)}）")
            pf = comp[sec].get("profile")
            if isinstance(pf, str) and not (150 <= len(pf) <= 700):
                warn(f"{base}.identity", f"profile 长度 {len(pf)}，建议 200–500 字")

        for nested, spec in NESTED.items():
            if not nested.startswith(sec + "."):
                continue
            arr = comp[sec].get(nested.split(".")[1])
            if not isinstance(arr, list):
                continue
            for i, item in enumerate(arr):
                if not isinstance(item, dict):
                    err(f"{base}.{nested}[{i}]", "不是对象")
                    continue
                check_fields(item, spec, f"{base}.{nested}[{i}]")
                if nested == "qa.items":
                    ans, ad = item.get("answer"), item.get("answer_date")
                    if ans is None and ad is not None:
                        err(f"{base}.qa.items[{i}]", "answer 为 null 但 answer_date 有值")
                    if ans is not None and ad is None:
                        err(f"{base}.qa.items[{i}]", "answer 有值但 answer_date 为 null")
                    if ans and ad and item.get("ask_date") and ad < item["ask_date"]:
                        err(f"{base}.qa.items[{i}]", f"answer_date {ad} 早于 ask_date {item['ask_date']}")

    if "market" in comp and "identity" in comp:
        ld = str((comp.get("identity") or {}).get("list_date") or "")
        for fld, ref in (("ytd_return", "2025-12-31"),
                         ("return_1y", "2025-10-22"),
                         ("return_3y", "2023-10-22")):
            if (comp.get("market") or {}).get(fld) is None and ld and ld <= ref:
                warn(base, f"`{fld}` 为空，但上市日 {ld} 早于 {ref}，理论上应能算出")

    # 量级检查（只对存在的路径）
    for path, (lo, hi) in RANGES.items():
        sec, key = path.split(".", 1)
        if sec in comp and isinstance(comp[sec], dict) and key in comp[sec]:
            check_range(comp[sec][key], lo, hi, base, path)
    return nulls


def validate_file(path, module=None):
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            err(path, f"JSON 解析失败：{e}")
            return None
    if not isinstance(data, dict):
        err(path, "顶层必须是对象")
        return None
    meta = data.get("meta")
    if not isinstance(meta, dict):
        err(path, "缺少 meta")
        return None
    mod = str(meta.get("module", "")).strip().upper()
    if mod not in MODULES:
        err(path, f"meta.module 必须是 A/B/C/D，实际 {meta.get('module')!r}")
        return None
    if module and mod != module:
        err(path, f"meta.module={mod} 与声明不符")
    for k, typ in [("collector", "str"), ("as_of_date", "date"), ("report_period", "date"),
                   ("generated_at", "str"), ("schema_version", "str"), ("count", "int")]:
        check_fields(meta, [(k, typ, 1)], f"{path}.meta")
    if str(meta.get("schema_version")) != SCHEMA_VERSION:
        warn(path, f"schema_version={meta.get('schema_version')}，当前规范是 {SCHEMA_VERSION}")

    companies = data.get("companies")
    if not isinstance(companies, dict):
        err(path, "缺少 companies 对象")
        return data
    if not companies:
        err(path, "companies 为空")
    for code, comp in companies.items():
        if not CODE_RE.match(code):
            err(path, f"主键格式错误：{code}（应为 600519.SH）")
            continue
        if not isinstance(comp, dict):
            err(path, f"{code} 不是对象")
            continue
        validate_company(code, comp, mod)
    if meta.get("count") != len(companies):
        warn(path, f"meta.count={meta.get('count')} 与实际 {len(companies)} 家不一致")
    return data


def merge(paths, out):
    merged, seen = {}, {}
    meta_ref = None
    for p in paths:
        data = validate_file(p)
        if not data:
            continue
        if meta_ref is None:
            meta_ref = dict(data["meta"])
        for code, comp in (data.get("companies") or {}).items():
            bucket = merged.setdefault(code, {})
            for sec, val in comp.items():
                if sec in bucket:
                    err(f"merge:{code}", f"section `{sec}` 重复（{seen.get((code, sec))} 与 {p}）")
                    continue
                bucket[sec] = val
                seen[(code, sec)] = p
    for code, comp in merged.items():
        missing = [s for s in ["identity", "market", "financials", "shareholders",
                               "dividends", "peers", "qa", "announcements"] if s not in comp]
        if missing:
            warn(f"merge:{code}", f"缺少 section：{missing}")
    meta_out = {
        "collector": "集成人",
        "module": "ALL",
        "as_of_date": (meta_ref or {}).get("as_of_date"),
        "report_period": (meta_ref or {}).get("report_period"),
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "schema_version": SCHEMA_VERSION,
        "count": len(merged),
        "sources": [os.path.basename(p) for p in paths],
    }
    result = {"meta": meta_out, "companies": merged}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n已写出 {out}：{len(merged)} 家公司，{len(errors)} error / {len(warnings)} warning")
    return result


TEMPLATES = {
    "A": {"identity": {k: None for k, _, _ in IDENTITY}, "market": {k: None for k, _, _ in MARKET}},
    "B": {"financials": {"unit": "CNY",
                         "annual": [{k: None for k, _, _ in ANNUAL} for _ in range(5)],
                         "latest": {k: None for k, _, _ in LATEST},
                         "derived": {k: None for k, _, _ in DERIVED}}},
    "C": {"shareholders": {k: [] if t == "arr_obj" else None for k, t, _ in SHAREHOLDERS},
          "dividends": {"annual": [], "consecutive_years": None, "cum_dividend_5y": None,
                        "cum_netprofit_5y": None, "payout_5y": None, "buyback_3y": None},
          "peers": {"peer_codes": [], "segments": []}},
    "D": {"qa": {"items": [], "count_12m": None},
          "announcements": {"items": [], "count_12m": None}},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--merge", metavar="OUT")
    ap.add_argument("--template", choices=list(TEMPLATES))
    args = ap.parse_args()

    if args.template:
        mod = args.template
        skeleton = {
            "meta": {"collector": "", "module": mod, "as_of_date": "2026-10-30",
                     "report_period": "2026-09-30",
                     "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                     "schema_version": SCHEMA_VERSION, "count": 0},
            "companies": {"600519.SH": json.loads(json.dumps(TEMPLATES[mod]))},
        }
        print(json.dumps(skeleton, ensure_ascii=False, indent=2))
        return 0

    if not args.files:
        ap.print_help()
        return 1

    if args.merge:
        merge(args.files, args.merge)
    else:
        for p in args.files:
            data = validate_file(p)
            if data:
                print(f"{p}: {len(data.get('companies', {}))} 家公司")

    for line in errors:
        print(line)
    for line in warnings[:40]:
        print(line)
    if len(warnings) > 40:
        print(f"... 另有 {len(warnings) - 40} 条 warning")
    print(f"\n结果：{len(errors)} error, {len(warnings)} warning")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
