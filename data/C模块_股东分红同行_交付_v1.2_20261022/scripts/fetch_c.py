# -*- coding: utf-8 -*-
"""
C 模块抓取：shareholders + dividends + peers
输出 data_C_holders_dividends.json

数据源（全部东财，同模块内只用一套源，见规范 §8）
  F10 ShareholderResearch/PageAjax → sjkzr(实控人) / sdgd(十大股东含限售) / gdrs(户数) / jgcc / xsjj
  F10 CompanySurvey/PageAjax       → 董事长 / 总经理 / 董秘
  datacenter RPT_SHAREBONUS_DET    → 分红送配
  datacenter RPT_LICO_FN_CPD       → 归母净利（算分红率，不写入 B 的 section）
  datacenter RPT_F10_FN_MAINOP     → 主营构成
  datacenter RPT_CSDC_LIST_NEWEST  → 质押比例
"""
import datetime as dt
import json
import os
import random
import re
import sys
import time

import requests

from stocks import STOCKS, exchange_of

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

F10 = "https://emweb.securities.eastmoney.com/PC_HSF10/"
DC = "https://datacenter-web.eastmoney.com/api/data/v1/get"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://data.eastmoney.com/",
})

ANNUAL_YEARS = [2021, 2022, 2023, 2024, 2025]
ORG_TOKENS = ("基金", "证券", "保险", "信托", "资管", "资产管理", "社保", "QFII",
              "银行", "投资", "控股", "集团", "有限", "合伙", "中心", "公司",
              "银行", "产业", "资本", "财务", "大学", "研究院", "委员会", "政府")


# ------------------------------------------------------------------ 基础工具
def get(url, params=None, tries=3, timeout=(10, 40)):
    """带退避重试的 GET，返回 dict/None。规范 §8：失败重试 3 次（1s/2s/4s）。"""
    for i in range(tries):
        try:
            r = SESSION.get(url, params=params, timeout=timeout)
            if r.status_code != 200:
                time.sleep(2 ** i)
                continue
            txt = r.text.lstrip("\ufeff")
            if txt.startswith("{") or txt.startswith("["):
                return json.loads(txt)
            return None
        except Exception:
            time.sleep(2 ** i)
    return None


def dc_report(report, filter_="", size=100, sort="", tries=3):
    p = {"reportName": report, "columns": "ALL", "pageNumber": 1,
         "pageSize": size, "source": "WEB", "client": "WEB"}
    if filter_:
        p["filter"] = filter_
    if sort:
        p["sortColumns"] = sort
        p["sortTypes"] = "-1"
    d = get(DC, params=p, tries=tries)
    if not d or not d.get("success"):
        return []
    return (d.get("result") or {}).get("data") or []


def ymd(s):
    """'2026-06-30 00:00:00' -> '2026-06-30'"""
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(s))
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def num(x):
    """转 number，转不了返回 None。'不变'/'新进' 这类文字由调用方处理。"""
    if x is None or isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return x
    s = str(x).strip().replace(",", "")
    if not s or s in ("-", "--", "N/A", "暂无"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def r2(x, nd=2):
    return None if x is None else round(float(x), nd)


def calc_payout(num, den):
    """分红率。分母为负或零时按规范 §6.4 填 null，不产出 -0.0 这类无意义值。

    分红 0 且亏损 → 比例无意义，null；
    分红 >0 且亏损 → 保留负数（反映「亏损仍分红」，如京沪高铁 2022 的 -97.15）。
    """
    if den is None or den == 0:
        return None
    if den < 0 and not num:
        return None
    v = round(num / den * 100, 2)
    return 0.0 if v == 0 else v


def hold_change(x):
    """HOLD_NUM_CHANGE：数字字符串 / '不变' / '新进' / None"""
    if x is None:
        return None
    s = str(x).strip()
    if s in ("不变",):
        return 0
    if s in ("新进", "新进十大股东", ""):
        return None
    v = num(s)
    return int(v) if v is not None else None


def is_org(name):
    """十大股东里判断机构还是自然人。法人名称几乎必含机构词，自然人姓名不会。"""
    if not name:
        return False
    n = str(name).strip()
    if any(t in n for t in ORG_TOKENS):
        return True
    # 纯中文 2-4 字且无机构词 → 判为自然人
    if 2 <= len(n) <= 4 and re.fullmatch(r"[\u4e00-\u9fa5]{2,4}", n):
        return False
    return True


# ------------------------------------------------------------------ shareholders
_UNIVERSE = None


def universe():
    """全市场（市值前 500）代码→申万行业/市值，用于同行映射。"""
    global _UNIVERSE
    if _UNIVERSE is None:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "market_universe.json")
        _UNIVERSE = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []
    return _UNIVERSE


def _key_of(x):
    return f"{x['code']}.{exchange_of(x['code'])}"


def pick_peers(code, n=4, floor=3):
    """同申万二级行业、市值降序的可比公司。

    规则（集成人 2026-10-22 定稿）：
      1. 必须排除自身；
      2. 二级行业满 4 家取 4 家；**只有 3 家就写 3 家，不再往一级补**
         （否则中国移动会被塞进中际旭创、新易盛这类光模块厂商）；
      3. 二级不足 3 家时才退到申万一级补足，最多补到 4 家；
      4. 一级也不够就如实少给（2 家也可以），绝不跨一级凑数。
    """
    uni = universe()
    me = next((x for x in uni if x["code"] == code), None)
    if not me:
        return []

    def pool_of(field):
        if not me.get(field):
            return []
        xs = [x for x in uni if x.get(field) == me[field] and x["code"] != code]
        xs.sort(key=lambda x: -(x.get("mktcap") or 0))
        return xs

    p2 = pool_of("sw2")
    if len(p2) >= n:
        return [_key_of(x) for x in p2[:n]]
    if len(p2) >= floor:
        return [_key_of(x) for x in p2]

    seen = {x["code"] for x in p2}
    merged = p2 + [x for x in pool_of("sw1") if x["code"] not in seen]
    return [_key_of(x) for x in merged[:n]]


REPORT_DAYS = ("-03-31", "-06-30", "-09-30", "-12-31")


def pick_report_period(rows, min_rows=8):
    """从股东明细里挑「报告期末」的最新一期。

    东财会为临时披露（增发、大股东变动）生成一个独立日期，如长江电力 2026-08-22、
    中国中车 2026-07-28，这类日期往往只有 1–2 个股东，直接取最新期会把十大股东
    截成 1 条。所以先只认季末/半年末/年末，且该期条数够多才用。
    """
    if not rows:
        return []
    by_date = {}
    for r in rows:
        d = ymd(r.get("END_DATE"))
        if d:
            by_date.setdefault(d, []).append(r)

    report_dates = sorted([d for d in by_date if d[4:] in REPORT_DAYS], reverse=True)
    for d in report_dates[:3]:
        if len(by_date[d]) >= min_rows:
            return by_date[d]
    if report_dates:
        return by_date[report_dates[0]]
    # 完全没有报告期末时，退回条数最多的那个日期
    d = max(by_date, key=lambda k: len(by_date[k]))
    return by_date[d]


def is_northbound_holder(name):
    """陆股通持股载体 = 「香港中央结算有限公司」。

    必须排除两类同名易混主体：
      「香港中央结算(代理人)有限公司」 —— H 股股东代理人
      「HKSCC NOMINEES LIMITED」      —— 同上，英文名
    """
    if not name:
        return False
    n = str(name).replace(" ", "")
    if "代理人" in n or "NOMINEES" in n.upper():
        return False
    return n.startswith("香港中央结算有限公司")


def _norm_name(name):
    """归一化：去空格、全角括号转半角。"""
    if not name:
        return ""
    n = str(name).replace(" ", "").replace("\u3000", "")
    return n.replace("（", "(").replace("）", ")").replace("，", ",")


def is_nominee(name):
    """名义持有人（托管/代理人），**永远不是控股股东**（v1.2 §5.4）。

    覆盖 4 种写法及带后缀变体：
      香港中央结算有限公司                                     —— 陆股通托管
      香港中央结算(代理人)有限公司                              —— H 股代理人
      香港中央结算代理人有限公司                                —— 同上，无括号
      香港中央结算(代理人)有限公司(HKSCC NOMINEES LIMITED)      —— 中英文并列
    """
    n = _norm_name(name)
    if not n:
        return False
    if n.startswith("香港中央结算"):
        return True
    up = n.upper()
    return "HKSCC" in up and "NOMINEES" in up


def pick_controlling(sdgd_sorted, controller):
    """控股股东：**先剔除名义持有人**，再取第一名（v1.2 §5.4）。

    剔除后第一名 <10% 且无实际控制人 → 无控股股东 + ratio=None。
    兜底：若全部是名义持有人（极端情况），退回原第一大股东。
    """
    cand = [r for r in sdgd_sorted if not is_nominee(r.get("HOLDER_NAME"))]
    if not cand:
        cand = sdgd_sorted
    if not cand:
        return None, None
    top1 = cand[0]
    name = top1.get("HOLDER_NAME")
    ratio = r2(top1.get("HOLD_NUM_RATIO"))
    if ratio is not None and ratio < 10 and (controller or "").strip() == "无实际控制人":
        return "无控股股东", None
    return name, ratio


def fetch_holders(key):
    """十大股东（含限售），返回报告期末的最新一期。"""
    rows = dc_report("RPT_F10_EH_HOLDERS", f'(SECUCODE="{key}")', size=100,
                     sort="END_DATE")
    period = pick_report_period(rows)
    period.sort(key=lambda x: x.get("HOLDER_RANK") or 99)
    return period[:10]


FIN_ORG_TYPES = {"01", "02", "03", "04", "05"}   # 基金 / QFII / 社保或年金 / 券商 / 保险


def fetch_inst_ratio(code):
    """机构投资者合计持股比例（占流通股，%），**纯财务投资者口径**。

    只累加东财 ORG_TYPE 的金融类：01 基金 / 02 QFII / 03 社保或年金 / 04 券商 / 05 保险。
    明确排除 00（合计）与 07（一般法人，含控股股东、国有法人、员工持股平台）。
    东财没有单列「信托」（无 06），这一块无法纳入，已在 README 披露。

    若某期次只给了 00/07、没拆出任何金融类，返回 None——
    按要求「拿不到拆分就填 null」，绝不回退到含控股股东的汇总数。
    """
    rows = dc_report("RPT_MAIN_ORGHOLD", f'(SECURITY_CODE="{code}")', size=80,
                     sort="REPORT_DATE")
    if not rows:
        return None
    by_date = {}
    for r in rows:
        d = ymd(r.get("REPORT_DATE"))
        if d:
            by_date.setdefault(d, []).append(r)

    best_val, best_n = None, -1
    for d in sorted(by_date, reverse=True)[:4]:
        fin = [x for x in by_date[d] if str(x.get("ORG_TYPE")) in FIN_ORG_TYPES]
        if not fin:
            continue
        total = sum(num(x.get("FREESHARES_RATIO")) or 0 for x in fin)
        n = sum(num(x.get("HOULD_NUM")) or 0 for x in fin)
        if n > best_n:
            best_val, best_n = total, n

    val = r2(best_val)
    # 东财按「股东机构类型」分类，不是按「投资者性质」。
    # 控股股东本身就是保险公司/银行时（中国人寿集团、平安集团），会被算进 05 保险，
    # 于是「机构投资者」虚高到 60%~95%。这种拆分不可信，按要求填 null 而不是硬报一个错数。
    if val is not None and val > 60:
        return None
    return val


_PLEDGE = None


def pledge_map():
    """全公司质押股份占总股本比例，一次拉全市场（中登周频数据）。

    返回 ({code: ratio}, ok)。ok=False 表示请求失败，此时字段应为 null；
    请求成功但股票不在列表里，说明该股无质押，填 0（中登只列有质押的公司）。
    """
    global _PLEDGE
    if _PLEDGE is not None:
        return _PLEDGE

    probe = dc_report("RPT_CSDC_LIST", size=1, sort="TRADE_DATE")
    latest = ymd(probe[0].get("TRADE_DATE")) if probe else None
    if not latest:
        _PLEDGE = ({}, False)
        return _PLEDGE

    m, page = {}, 1
    while page <= 12:
        d = get(DC, params={
            "reportName": "RPT_CSDC_LIST",
            "columns": "SECURITY_CODE,PLEDGE_RATIO,TRADE_DATE",
            "pageNumber": page, "pageSize": 500, "source": "WEB", "client": "WEB",
            "filter": f"(TRADE_DATE='{latest}')",
        })
        if not d or not d.get("success"):
            break
        rows = (d.get("result") or {}).get("data") or []
        for r in rows:
            c = str(r.get("SECURITY_CODE") or "").zfill(6)
            v = num(r.get("PLEDGE_RATIO"))
            if c and v is not None:
                m[c] = v
        if len(rows) < 500:
            break
        page += 1

    _PLEDGE = (m, bool(m))
    print(f"  [质押] 最新 {latest}，全市场 {len(m)} 家有质押", flush=True)
    return _PLEDGE


def fetch_shareholders(st):
    code, key = st["code"], st["key"]
    pref = st["exchange"] + code          # SH600519
    out = {}

    sh = get(F10 + f"ShareholderResearch/PageAjax?code={pref}") or {}
    gdrs = sh.get("gdrs") or []
    sjkzr = sh.get("sjkzr") or []
    xsjj = sh.get("xsjj") or []
    # 十大股东改走 datacenter 全历史，自行挑报告期末（PageAjax 的 sdgd 只给最新日期，
    # 遇到临时披露日会只剩 1–2 条）
    sdgd = fetch_holders(key)

    # 实控人
    ctrl = sjkzr[0].get("HOLDER_NAME") if sjkzr else None
    out["controller"] = ctrl if ctrl else "无实际控制人"

    # 控股股东：先剔除名义持有人（HKSCC 等），再取第一名；v1.2 §5.4
    sdgd_sorted = sorted(sdgd, key=lambda x: x.get("HOLDER_RANK") or 99)
    cs_name, cs_ratio = pick_controlling(sdgd_sorted, out["controller"])
    out["controlling_shareholder"] = cs_name
    out["controlling_ratio"] = cs_ratio

    # top10
    top10 = []
    for row in sdgd_sorted[:10]:
        top10.append({
            "rank": int(row.get("HOLDER_RANK") or len(top10) + 1),
            "name": row.get("HOLDER_NAME"),
            "hold_num": int(num(row.get("HOLD_NUM")) or 0),
            "hold_ratio": r2(row.get("HOLD_NUM_RATIO")),
            "hold_num_change": hold_change(row.get("HOLD_NUM_CHANGE")),
        })
    out["top10"] = top10

    # 户数：优先取报告期末，避开临时披露日期
    if gdrs:
        rep = [g for g in gdrs
               if (ymd(g.get("END_DATE")) or "")[4:] in REPORT_DAYS]
        g = sorted(rep or gdrs, key=lambda x: x.get("END_DATE") or "", reverse=True)[0]
        out["holder_num"] = int(num(g.get("HOLDER_TOTAL_NUM")) or 0)
        out["holder_num_change_pct"] = r2(g.get("TOTAL_NUM_RATIO"))
        out["holder_num_date"] = ymd(g.get("END_DATE"))
    else:
        out["holder_num"] = None
        out["holder_num_change_pct"] = None
        out["holder_num_date"] = None

    # 机构合计持股比例（东财 RPT_MAIN_ORGHOLD，ORG_TYPE='00' 为合计口径）
    out["inst_hold_ratio"] = fetch_inst_ratio(code)

    # 北向：十大股东里的「香港中央结算有限公司」才是陆股通；
    # 「(代理人)有限公司」「HKSCC NOMINEES」是 H 股股东，排除
    nb = None
    for row in sdgd_sorted:
        if is_northbound_holder(row.get("HOLDER_NAME")):
            nb = r2(row.get("HOLD_NUM_RATIO"))
            break
    out["northbound_ratio"] = nb

    # 高管：公司概况里有董事长/总经理/董秘；薪酬接口不可用，pay 填 null
    survey = get(F10 + f"CompanySurvey/PageAjax?code={pref}") or {}
    jbzl = (survey.get("jbzl") or [{}])[0] if survey.get("jbzl") else {}
    execs = []
    for field, title in (("CHAIRMAN", "董事长"), ("PRESIDENT", "总经理"), ("SECRETARY", "董事会秘书")):
        nm = (jbzl.get(field) or "").strip()
        if nm:
            execs.append({"name": nm, "title": title, "pay": None})
    out["executives"] = execs

    # 质押：全公司质押股份 ÷ 总股本（中登口径，批量取，见 pledge_map）
    pm, pok = pledge_map()
    out["pledge_ratio_total"] = r2(pm.get(code, 0)) if pok else None

    # 未来 12 个月解禁（东财字段：LIFT_DATE / LIFT_NUM / TOTAL_SHARES_RATIO）
    today = dt.date.today()
    horizon = today + dt.timedelta(days=365)
    unlocks = []
    for row in xsjj:
        d = ymd(row.get("LIFT_DATE"))
        if not d:
            continue
        dd = dt.date.fromisoformat(d)
        if today <= dd <= horizon:
            unlocks.append({
                "date": d,
                "shares": int(num(row.get("LIFT_NUM")) or 0),
                "ratio": r2(row.get("TOTAL_SHARES_RATIO")),
            })
    unlocks.sort(key=lambda x: x["date"])
    out["unlock_12m"] = unlocks

    return out


# ------------------------------------------------------------------ dividends
def fetch_dividends(st):
    code = st["code"]
    key = st["key"]
    rows = dc_report("RPT_SHAREBONUS_DET", f'(SECUCODE="{key}")', size=100, sort="REPORT_DATE")

    # 归母净利润（按年报）
    prof = dc_report("RPT_LICO_FN_CPD", f'(SECUCODE="{key}")', size=40, sort="REPORTDATE")
    np_by_year = {}
    for p in prof:
        d = ymd(p.get("REPORTDATE"))
        if d and d.endswith("12-31"):
            y = int(d[:4])
            if y in ANNUAL_YEARS:
                v = num(p.get("PARENT_NETPROFIT"))
                if v is not None:
                    np_by_year[y] = v

    # 按 REPORT_DATE 年度归集（规范 §5.5：同一年度多次分红合并成一条）
    buckets = {}
    for r in rows:
        d = ymd(r.get("REPORT_DATE"))
        if not d:
            continue
        y = int(d[:4])
        if y not in ANNUAL_YEARS:
            continue
        per10 = num(r.get("PRETAX_BONUS_RMB"))
        if per10 is None:
            continue
        shares = num(r.get("TOTAL_SHARES")) or 0
        amount = per10 / 10.0 * shares
        dy = num(r.get("DIVIDENT_RATIO"))
        bucket = buckets.setdefault(y, {
            "per10": 0.0, "amount": 0.0, "dy_weight": 0.0, "dy_amount": 0.0,
            "ex_dates": [],
        })
        bucket["per10"] += per10
        bucket["amount"] += amount
        if dy is not None:
            bucket["dy_weight"] += dy * amount
            bucket["dy_amount"] += amount
        ed = ymd(r.get("EX_DIVIDEND_DATE"))
        if ed:
            bucket["ex_dates"].append(ed)

    annual = []
    for y in ANNUAL_YEARS:
        b = buckets.get(y)
        npy = np_by_year.get(y)
        if not b:
            # 当年无分红方案。v1.2 §5.5 零值规则：分红=0 且净利>0 → 0.0，
            # 只有分母为负/缺失（亏损或未披露）时才允许 null。
            pv = calc_payout(0, npy)
            annual.append({
                "fiscal_year": y, "dps_pretax": 0, "total_amount": 0,
                "payout_ratio": pv,
                "dividend_yield": 0.0 if pv == 0.0 else None,
                "ex_date": None,
            })
            continue
        dps = r2(b["per10"] / 10.0, 4)
        amount = b["amount"]
        payout_val = calc_payout(amount, npy)
        dy = (r2(b["dy_weight"] / b["dy_amount"] * 100)
              if b["dy_amount"] else None)
        if dy is None and payout_val == 0.0:
            dy = 0.0
        annual.append({
            "fiscal_year": y,
            "dps_pretax": dps,
            "total_amount": r2(amount),
            "payout_ratio": payout_val,
            "dividend_yield": dy,
            "ex_date": min(b["ex_dates"]) if b["ex_dates"] else None,
        })

    cum_div = sum(a["total_amount"] or 0 for a in annual)
    cum_np = sum(np_by_year.get(y) or 0 for y in ANNUAL_YEARS)
    payout_5y = calc_payout(cum_div, cum_np)

    # 连续分红年数：从 2025 往前数，遇到 0 分红即停；若 2026 中期已分红则 +1
    consecutive = 0
    for a in sorted(annual, key=lambda x: -x["fiscal_year"]):
        if a["total_amount"] and a["total_amount"] > 0:
            consecutive += 1
        else:
            break
    has_2026_mid = any(ymd(r.get("REPORT_DATE")) and ymd(r.get("REPORT_DATE")).startswith("2026")
                       and (num(r.get("PRETAX_BONUS_RMB")) or 0) > 0
                       for r in rows)
    if has_2026_mid:
        consecutive += 1

    return {
        "annual": annual,
        "consecutive_years": consecutive,
        "cum_dividend_5y": r2(cum_div),
        "cum_netprofit_5y": r2(cum_np) if cum_np else None,
        "payout_5y": payout_5y,
        "buyback_3y": None,
    }


# ------------------------------------------------------------------ peers
SEG_DROP_TOKENS = ("其中", "合计", "小计")
SEG_LOW, SEG_HIGH = 95.0, 100.5
SEG_MAX_PER_TYPE = 11


def _seg_scale(rows):
    """MBI_RATIO 是小数(0.8134)还是百分数(81.34)？

    必须用**带符号**合计：紫金/中石油有 -67% 抵消行，正项+绝对负数会超 2.0，
    用绝对值会被误判。完整拆分下小数口径合计≈1、百分数≈100。
    """
    vals = [num(r.get("MBI_RATIO")) for r in rows]
    vals = [v for v in vals if v is not None]
    if not vals:
        return 1.0
    return 100.0 if abs(sum(vals)) <= 2.0 else 1.0


def _clean_seg_rows(rows):
    """§5.6 前两条：剔「其中/合计/小计」子项；同名同额去重（保留非「补充」的那条）。

    负数抵消行**必须保留**，它是让合计回到 100% 的关键。
    """
    kept = [r for r in rows
            if not any(t in str(r.get("ITEM_NAME") or "") for t in SEG_DROP_TOKENS)]

    out, seen = [], {}
    for r in kept:
        sig = (num(r.get("MAIN_BUSINESS_INCOME")), num(r.get("MBI_RATIO")))
        if sig == (None, None):
            out.append(r)
            continue
        if sig in seen:
            prev = seen[sig]
            cur_nm = str(r.get("ITEM_NAME") or "")
            prev_nm = str(prev.get("ITEM_NAME") or "")
            if "补充" in cur_nm and "补充" not in prev_nm:
                continue
            continue
        seen[sig] = r
        out.append(r)
    return out


def _pick_seg_type(pool, t, label, latest):
    """单个 type 的取值：按收入降序，取够 5 条；不足 95% 继续补。

    硬约束是**每个 type 的 ratio 合计 ∈ [95, 100.5]**，所以条数允许超过 5。
    负数抵消行无论排第几都必须保留。
    """
    rows = [r for r in pool if str(r.get("MAINOP_TYPE")) == t]
    if not rows:
        return []
    rows = _clean_seg_rows(rows)
    if not rows:
        return []
    f = _seg_scale(rows)

    for r in rows:
        r["_inc"] = num(r.get("MAIN_BUSINESS_INCOME"))
        ra = num(r.get("MBI_RATIO"))
        r["_ratio"] = None if ra is None else round(ra * f, 2)

    neg = [r for r in rows if (r["_inc"] or 0) < 0]
    pos = sorted([r for r in rows if (r["_inc"] or 0) >= 0],
                 key=lambda r: -(r["_inc"] or 0))

    slots = max(1, 5 - len(neg))
    sel, rest = pos[:slots], pos[slots:]
    total = sum(r["_ratio"] or 0 for r in sel + neg)
    while total < SEG_LOW and rest:
        r = rest.pop(0)
        sel.append(r)
        total += r["_ratio"] or 0
    sel = sel[:SEG_MAX_PER_TYPE - len(neg)]

    out = []
    for r in sorted(sel + neg, key=lambda r: -(r["_inc"] or 0)):
        out.append({
            "name": r.get("ITEM_NAME"),
            "revenue": r2(r["_inc"]),
            "ratio": r["_ratio"],
            "type": label,
            "period": latest,
        })
    return out


def fetch_segments(st):
    """最新年报主营构成。type=2 产品 / type=3 地区（东财口径）。"""
    key = st["key"]
    rows = dc_report("RPT_F10_FN_MAINOP", f'(SECUCODE="{key}")', size=200, sort="REPORT_DATE")
    if not rows:
        return []

    # 取最新「年报」：REPORT_NAME 形如 '2025年报'
    annual_rows = [r for r in rows if (r.get("REPORT_NAME") or "").endswith("年报")]
    pool = annual_rows or rows
    latest_name = max((r.get("REPORT_NAME") or "") for r in pool)
    pool = [r for r in pool if r.get("REPORT_NAME") == latest_name]

    # product 与 region 是两套独立拆分，分别成组、各自校验合计区间
    return (_pick_seg_type(pool, "2", "product", latest_name)
            + _pick_seg_type(pool, "3", "region", latest_name))


# ------------------------------------------------------------------ 单家组装
def build_one(st):
    sh = fetch_shareholders(st)
    time.sleep(random.uniform(0.3, 0.5))
    dv = fetch_dividends(st)
    time.sleep(random.uniform(0.3, 0.5))
    seg = fetch_segments(st)
    return {"shareholders": sh, "dividends": dv, "segments": seg}


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    targets = [s for s in STOCKS if not only or s["code"] == only or s["key"] == only]

    companies = {}
    seg_map = {}
    for i, st in enumerate(targets, 1):
        t0 = time.time()
        try:
            r = build_one(st)
            companies[st["key"]] = {
                "shareholders": r["shareholders"],
                "dividends": r["dividends"],
                "peers": {
                    "peer_codes": pick_peers(st["code"]),
                    "segments": r["segments"],
                },
            }
            seg_map[st["key"]] = r["segments"]
            sh = r["shareholders"]
            print(f"[{i:>3}/{len(targets)}] {st['key']} {st['name']:<8} "
                  f"股东{len(sh['top10']):>2} 户数={sh['holder_num']} "
                  f"北向={sh['northbound_ratio']} 质押={sh['pledge_ratio_total']} "
                  f"分红{sum(1 for a in r['dividends']['annual'] if a['total_amount'])}/5年 "
                  f"主营{len(r['segments'])} ({time.time()-t0:.1f}s)", flush=True)
        except Exception as e:
            print(f"[{i:>3}/{len(targets)}] {st['key']} FAIL {type(e).__name__}: {e}", flush=True)

        if i % 20 == 0:
            save(companies, seg_map, f".partial_{i}.json")
            print(f"    --- 已落盘 {i} 家 ---", flush=True)

    save(companies, seg_map, "data_C_holders_dividends.json")
    print(f"\n完成 {len(companies)} 家")


def save(companies, seg_map, path):
    payload = {
        "meta": {
            "collector": "C",
            "module": "C",
            "as_of_date": "2026-10-30",
            "report_period": "2026-09-30",
            "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "schema_version": "1.2",
            "count": len(companies),
        },
        "companies": companies,
    }
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
