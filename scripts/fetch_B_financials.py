#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
B 模块（financials）抓取脚本 —— A股百强报告

产出：
  data_B_financials.json   合并/前端用
  data_B_financials.csv    人工抽查用

防"静默降级"的四道闸（东财在请求过密时会返回 success=false / 空结果，且不报错）：
  1. 只请求需要的列（不是 columns=ALL），单次响应从 ~700KB 降到 ~20KB；
  2. 每次批量请求都用"应到代码集合"校验覆盖率，缺一条就重试；
  3. 返回 0 行一律视为异常（这些公司该期一定有数据），退避 15/30/60s 后重试；
  4. 每个 (报表, 报告期) 成功后落盘缓存，中断可续跑，不会重复打接口。

用法：
  python3 fetch_B_financials.py                      # 2021-2025 年报 + 2026 中报
  python3 fetch_B_financials.py --latest 2026-09-30   # 三季报披露后重跑
  python3 fetch_B_financials.py --refresh             # 忽略缓存
"""
import argparse
import csv
import gzip
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

API = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Referer": "https://data.eastmoney.com/",
    "Accept": "application/json, text/plain, */*",
}
ANNUAL_PERIODS = ["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"]
REPORT_TYPE = {"03-31": "一季报", "06-30": "中报", "09-30": "三季报", "12-31": "年报"}

TEMPLATES = {
    "G": ("RPT_F10_FINANCE_GINCOME", "RPT_F10_FINANCE_GBALANCE", "RPT_F10_FINANCE_GCASHFLOW"),
    "B": (None, "RPT_F10_FINANCE_BBALANCE", "RPT_F10_FINANCE_BCASHFLOW"),
    "I": (None, "RPT_F10_FINANCE_IBALANCE", "RPT_F10_FINANCE_ICASHFLOW"),
    "S": (None, "RPT_F10_FINANCE_SBALANCE", "RPT_F10_FINANCE_SCASHFLOW"),
}
MI = "RPT_F10_FINANCE_MAINFINADATA"

BAL_NEEDED = ["TOTAL_ASSETS", "TOTAL_LIABILITIES", "TOTAL_PARENT_EQUITY", "MONETARYFUNDS",
              "ACCOUNTS_RECE", "INVENTORY", "GOODWILL", "SHORT_LOAN",
              "NONCURRENT_LIAB_1YEAR", "LONG_LOAN", "BOND_PAYABLE", "LEASE_LIAB"]
INC_NEEDED = ["TOTAL_OPERATE_INCOME", "OPERATE_INCOME", "SALE_EXPENSE", "MANAGE_EXPENSE",
              "FINANCE_EXPENSE", "RESEARCH_EXPENSE"]
CF_NEEDED = ["NETCASH_OPERATE", "CONSTRUCT_LONG_ASSET"]
MI_NEEDED = ["TOTALOPERATEREVE", "PARENTNETPROFIT", "KCFJCXSYJLR", "TOTALOPERATEREVETZ",
             "PARENTNETPROFITTZ", "XSMLL", "XSJLL", "ROEJQ", "ZZCJLL", "ZCFZL",
             "EPSJB", "BPS", "RDEXPEND"]

ANNUAL_VALUE_FIELDS = [
    "revenue", "revenue_yoy", "net_profit", "net_profit_yoy", "net_profit_deducted",
    "gross_margin", "net_margin", "selling_expense_ratio", "admin_expense_ratio",
    "finance_expense_ratio", "rd_expense", "rd_ratio", "eps", "bvps", "roe", "roa",
    "total_assets", "total_liab", "debt_ratio", "cash", "receivables", "inventory",
    "goodwill", "interest_debt", "equity_parent", "ocf", "capex", "fcf", "ocf_to_np",
]

CACHE_DIR = ".cache"
_gap = 1.0
_last = 0.0
_cols_cache = {}


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", file=sys.stderr, flush=True)


def _throttle():
    global _last
    wait = _gap - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.time()


def _get(url, timeout=40):
    _throttle()
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _query(report, filt, columns, page=1, size=200):
    return (f"{API}?reportName={report}&columns={urllib.parse.quote(columns)}"
            f"&filter={urllib.parse.quote(filt)}&pageNumber={page}&pageSize={size}")


def resolve_columns(report, sample_code, needed):
    """用一只股票探出该报表实际存在哪些列（银行/保险/券商缺字段，写死会 400）。"""
    key = (report, tuple(needed))
    if key in _cols_cache:
        return _cols_cache[key]
    data = _get(_query(report, f'(SECUCODE="{sample_code}")(REPORT_DATE=\'2025-12-31\')',
                       "ALL", 1, 1))
    rows = (data.get("result") or {}).get("data") or []
    if not rows:
        raise RuntimeError(f"{report} 探列失败（{sample_code} 无数据）")
    have = set(rows[0].keys())
    cols = ["SECUCODE", "REPORT_DATE"] + [c for c in needed if c in have]
    missing = [c for c in needed if c not in have]
    if missing:
        log(f"   {report} 无这些列（按 null 处理）：{missing}")
    _cols_cache[key] = ",".join(cols)
    return _cols_cache[key]


def fetch_pages(report, filt, columns, size=200, max_pages=5):
    rows = {}
    for pn in range(1, max_pages + 1):
        data = _get(_query(report, filt, columns, pn, size))
        if data.get("success") is False:
            raise RuntimeError(f"{report} 接口返回失败：{data.get('message')}")
        batch = (data.get("result") or {}).get("data") or []
        if not batch:
            break
        for r in batch:
            rows[r.get("SECUCODE")] = r
        if len(batch) < size:
            break
    if not rows:
        raise RuntimeError(f"{report} 返回 0 行（疑似降级）")
    return rows


def _cache_path(report, period):
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{report}__{period}.json.gz")


def load_cache(report, period):
    p = _cache_path(report, period)
    if not os.path.exists(p):
        return None
    try:
        with gzip.open(p, "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def save_cache(report, period, rows):
    with gzip.open(_cache_path(report, period), "wt", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)


def fetch_checked(report, codes, period, columns, allow_missing=frozenset(),
                  refresh=False, retries=5):
    """覆盖率校验 + 缓存 + 长冷却重试。缺一家都算失败。"""
    codes = set(codes)
    allow = set(allow_missing)
    got = None if refresh else load_cache(report, period)
    if got:
        got = {k: v for k, v in got.items() if k in codes}
    if not got or ((codes - set(got)) - allow):
        inlist = "(" + ",".join(f'"{c}"' for c in sorted(codes)) + ")"
        filt = f"(SECUCODE in {inlist})(REPORT_DATE='{period}')"
        for attempt in range(retries):
            try:
                fresh = fetch_pages(report, filt, columns)
                msg = ""
            except Exception as e:  # noqa: BLE001
                fresh, msg = {}, str(e)
            merged = dict(got or {})
            merged.update(fresh)
            got = merged
            missing = (codes - set(got)) - allow
            if not missing:
                break
            cool = min(15 * (2 ** attempt), 120) + random.uniform(0, 3)
            log(f"   ! {report} {period} 缺 {len(missing)}/{len(codes)} 家"
                f"{'（' + msg + '）' if msg else ''}，冷却 {cool:.0f}s 后重试 "
                f"({attempt + 1}/{retries})")
            time.sleep(cool)
        missing = (codes - set(got)) - allow
        if missing:
            raise RuntimeError(f"{report} {period} 覆盖不足：缺 {len(missing)} 家 "
                               f"{sorted(missing)[:5]}")
        save_cache(report, period, got)
    return {k: v for k, v in got.items() if k in codes}


def num(x, nd=2):
    if x is None or x in ("", "--"):
        return None
    try:
        return round(float(x), nd)
    except (TypeError, ValueError):
        return None


def pct(a, b, nd=2):
    if a is None or b in (None, 0):
        return None
    return round(float(a) / float(b) * 100.0, nd)


def div(a, b, nd=2):
    if a is None or b in (None, 0):
        return None
    return round(float(a) / float(b), nd)


def detect_templates(codes, period):
    groups, remaining = {}, set(codes)
    for tag in ["G", "B", "I", "S"]:
        report = TEMPLATES[tag][1]
        if not remaining:
            break
        inlist = "(" + ",".join(f'"{c}"' for c in sorted(remaining)) + ")"
        try:
            got = fetch_pages(report, f"(SECUCODE in {inlist})(REPORT_DATE='{period}')",
                              "SECUCODE,REPORT_DATE")
        except Exception:  # noqa: BLE001
            got = {}
        hit = remaining & set(got)
        if hit:
            groups[tag] = sorted(hit)
            remaining -= hit
        log(f"   模板 {tag}: 命中 {len(hit)} 家，剩 {len(remaining)} 家")
    if remaining:
        raise RuntimeError(f"这些公司没匹配到任何报表模板：{sorted(remaining)}")
    return groups


def build(raw_by_period, latest_period, group):
    annual = []
    for period in ANNUAL_PERIODS:
        year = int(period[:4])
        r = raw_by_period.get(period)
        if not r:
            annual.append({"fiscal_year": year, "report_date": period,
                           **{k: None for k in ANNUAL_VALUE_FIELDS}})
            continue
        bal, cf, inc, mi = r["bal"], r["cf"], r.get("inc") or {}, r["mi"]
        revenue = num(mi.get("TOTALOPERATEREVE"))
        net_profit = num(mi.get("PARENTNETPROFIT"))
        ocf = num(cf.get("NETCASH_OPERATE"))
        capex = num(cf.get("CONSTRUCT_LONG_ASSET"))
        interest = None
        if group == "G":
            parts = [bal.get(k) for k in ("SHORT_LOAN", "NONCURRENT_LIAB_1YEAR",
                                          "LONG_LOAN", "BOND_PAYABLE", "LEASE_LIAB")]
            if any(p is not None for p in parts):
                interest = round(sum(float(p or 0) for p in parts), 2)
        base = inc.get("TOTAL_OPERATE_INCOME") or inc.get("OPERATE_INCOME")
        annual.append({
            "fiscal_year": year,
            "report_date": period,
            "revenue": revenue,
            "revenue_yoy": num(mi.get("TOTALOPERATEREVETZ")),
            "net_profit": net_profit,
            "net_profit_yoy": num(mi.get("PARENTNETPROFITTZ")),
            "net_profit_deducted": num(mi.get("KCFJCXSYJLR")),
            "gross_margin": num(mi.get("XSMLL")),
            "net_margin": num(mi.get("XSJLL")),
            "selling_expense_ratio": pct(inc.get("SALE_EXPENSE"), base),
            "admin_expense_ratio": pct(inc.get("MANAGE_EXPENSE"), base),
            "finance_expense_ratio": pct(inc.get("FINANCE_EXPENSE"), base),
            "rd_expense": num(inc.get("RESEARCH_EXPENSE")),
            "rd_ratio": pct(inc.get("RESEARCH_EXPENSE"), base),
            "eps": num(mi.get("EPSJB")),
            "bvps": num(mi.get("BPS")),
            "roe": num(mi.get("ROEJQ")),
            "roa": num(mi.get("ZZCJLL")),
            "total_assets": num(bal.get("TOTAL_ASSETS")),
            "total_liab": num(bal.get("TOTAL_LIABILITIES")),
            "debt_ratio": num(mi.get("ZCFZL")),
            "cash": num(bal.get("MONETARYFUNDS")),
            "receivables": num(bal.get("ACCOUNTS_RECE")),
            "inventory": num(bal.get("INVENTORY")),
            "goodwill": num(bal.get("GOODWILL")),
            "interest_debt": interest,
            "equity_parent": num(bal.get("TOTAL_PARENT_EQUITY")),
            "ocf": ocf,
            "capex": capex,
            "fcf": None if (ocf is None or capex is None) else round(ocf - capex, 2),
            "ocf_to_np": div(ocf, net_profit),
        })

    latest = None
    r = raw_by_period.get(latest_period)
    if r:
        mi, bal, cf = r["mi"], r["bal"], r["cf"]
        latest = {
            "report_period": latest_period,
            "report_type": f"{latest_period[:4]}年{REPORT_TYPE.get(latest_period[5:], '报告期')}",
            "revenue": num(mi.get("TOTALOPERATEREVE")),
            "revenue_yoy": num(mi.get("TOTALOPERATEREVETZ")),
            "net_profit": num(mi.get("PARENTNETPROFIT")),
            "net_profit_yoy": num(mi.get("PARENTNETPROFITTZ")),
            "net_profit_deducted": num(mi.get("KCFJCXSYJLR")),
            "gross_margin": num(mi.get("XSMLL")),
            "net_margin": num(mi.get("XSJLL")),
            "roe": num(mi.get("ROEJQ")),
            "eps": num(mi.get("EPSJB")),
            "debt_ratio": num(mi.get("ZCFZL")),
            "ocf": num(cf.get("NETCASH_OPERATE")),
        }

    r22, r25 = annual[1].get("revenue"), annual[4].get("revenue")
    n22, n25 = annual[1].get("net_profit"), annual[4].get("net_profit")
    derived = {
        "revenue_cagr_3y": (round(((r25 / r22) ** (1 / 3) - 1) * 100, 2)
                            if r22 and r25 and r22 > 0 and r25 > 0 else None),
        "net_profit_cagr_3y": (round(((n25 / n22) ** (1 / 3) - 1) * 100, 2)
                               if n22 and n25 and n22 > 0 and n25 > 0 else None),
        "receivables_to_revenue": pct(annual[4].get("receivables"), r25),
        "goodwill_to_equity": pct(annual[4].get("goodwill"), annual[4].get("equity_parent")),
    }
    return {"unit": "CNY", "annual": annual, "latest": latest, "derived": derived}


def group_of(groups, code):
    for tag, lst in groups.items():
        if code in lst:
            return tag
    return "G"


def write_csv(out, name_of, path):
    cols = ["code", "name", "period_type", "report_date"] + ANNUAL_VALUE_FIELDS
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for code, comp in out.items():
            fin = comp["financials"]
            for row in fin["annual"]:
                w.writerow([code, name_of.get(code), "年报", row["report_date"]]
                           + [row.get(k) for k in ANNUAL_VALUE_FIELDS])
            lat = fin["latest"]
            if lat:
                w.writerow([code, name_of.get(code), lat["report_type"], lat["report_period"]]
                           + [lat.get(k) for k in ANNUAL_VALUE_FIELDS])


def main():
    global _gap
    ap = argparse.ArgumentParser()
    ap.add_argument("--latest", default="2026-06-30")
    ap.add_argument("--codes", default="codes_top100.json")
    ap.add_argument("--out", default="data_B_financials.json")
    ap.add_argument("--csv", default="data_B_financials.csv")
    ap.add_argument("--gap", type=float, default=1.0)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    _gap = args.gap

    meta_list = json.load(open(args.codes, encoding="utf-8"))["companies"]
    codes = [c["code"] for c in meta_list]
    name_of = {c["code"]: c["name_abbr"] for c in meta_list}
    log(f"{len(codes)} 家公司；最新期={args.latest}；请求间隔={_gap}s")

    order = [args.latest] + list(reversed(ANNUAL_PERIODS))
    groups = detect_templates(codes, "2025-12-31")

    mi_cols = resolve_columns(MI, codes[0], MI_NEEDED)
    mi_all, known = {}, set()
    for period in order:
        mi_all[period] = fetch_checked(MI, codes, period, mi_cols,
                                       allow_missing=known, refresh=args.refresh)
        known |= set(mi_all[period])
    avail = {p: set(v) for p, v in mi_all.items()}
    for p in reversed(order):
        miss = [c for c in codes if c not in avail[p]]
        if miss:
            log(f"  {p}: {len(miss)} 家无数据（上市晚于该期），将留空")

    companies = {}
    for tag, group_codes in groups.items():
        inc_rpt, bal_rpt, cf_rpt = TEMPLATES[tag]
        sample = group_codes[0]
        bal_cols = resolve_columns(bal_rpt, sample, BAL_NEEDED)
        cf_cols = resolve_columns(cf_rpt, sample, CF_NEEDED)
        inc_cols = resolve_columns(inc_rpt, sample, INC_NEEDED) if inc_rpt else None
        log(f"== 模板 {tag}：{len(group_codes)} 家")
        for period in order:
            allow = {c for c in group_codes if c not in avail[period]}
            bal = fetch_checked(bal_rpt, group_codes, period, bal_cols, allow, args.refresh)
            cf = fetch_checked(cf_rpt, group_codes, period, cf_cols, allow, args.refresh)
            inc = (fetch_checked(inc_rpt, group_codes, period, inc_cols, allow, args.refresh)
                   if inc_rpt else {})
            for code in group_codes:
                if code not in bal:
                    continue
                companies.setdefault(code, {})[period] = {
                    "bal": bal[code], "cf": cf[code], "inc": inc.get(code),
                    "mi": mi_all[period].get(code) or {},
                }
            log(f"  {period} 完成（{len(bal)} 家）")

    out = {}
    for code in codes:
        raw = companies.get(code, {})
        out[code] = {"financials": build(raw, args.latest, group_of(groups, code))}

    bad = [c for c in codes if out[c]["financials"]["latest"] is None]
    if bad:
        raise RuntimeError(f"缺最新期数据：{bad}")
    no_2025 = [c for c in codes if out[c]["financials"]["annual"][4]["revenue"] is None]
    if no_2025:
        raise RuntimeError(f"缺 2025 年报：{no_2025}")

    doc = {
        "meta": {
            "collector": "B",
            "module": "B",
            "as_of_date": "2026-10-30",
            "report_period": args.latest,
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "schema_version": "1.0",
            "count": len(out),
            "source": "eastmoney datacenter RPT_F10_FINANCE_G*/B*/I*/S* + MAINFINADATA",
        },
        "companies": out,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    write_csv(out, name_of, args.csv)
    log(f"完成：{args.out} / {args.csv}")


if __name__ == "__main__":
    main()
