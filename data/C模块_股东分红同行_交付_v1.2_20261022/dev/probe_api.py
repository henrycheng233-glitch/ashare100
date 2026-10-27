# -*- coding: utf-8 -*-
"""C 模块接口摸底：shareholders / dividends / peers 全部字段的来源确认。"""
import json
import time

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
S = requests.Session()
S.headers.update({"User-Agent": UA, "Referer": "https://data.eastmoney.com/"})
DC = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def dc(report, filter_="", page=1, size=50, columns="ALL", sort="", extra=None):
    p = {"reportName": report, "columns": columns, "pageNumber": page,
         "pageSize": size, "source": "WEB", "client": "WEB"}
    if filter_:
        p["filter"] = filter_
    if sort:
        p["sortColumns"] = sort
        p["sortTypes"] = "-1"
    if extra:
        p.update(extra)
    for i in range(3):
        try:
            r = S.get(DC, params=p, timeout=(10, 40))
            d = r.json()
            return d
        except Exception:
            time.sleep(1 + i)
    return {"success": False, "message": "request failed"}


def show(report, filter_="", size=5, note=""):
    d = dc(report, filter_, size=size)
    ok = d.get("success")
    res = d.get("result") or {}
    rows = res.get("data") or []
    print(f"\n--- {report} {note}")
    print(f"    filter={filter_ or '(空)'}  success={ok}  count={res.get('count')}  rows={len(rows)}")
    if not ok:
        print(f"    msg: {str(d.get('message'))[:80]}")
        return rows
    if rows:
        print(f"    字段: {list(rows[0].keys())}")
        print(f"    首行: {json.dumps(rows[0], ensure_ascii=False)[:600]}")
    return rows


if __name__ == "__main__":
    CODE, SECU = "600519", "600519.SH"

    print("=" * 80)
    print("一、股东类")
    print("=" * 80)
    # 前十股东（含限售）vs 前十流通股东
    show("RPT_F10_EH_HOLDERS", f'(SECUCODE="{SECU}")', 12, "【含限售】")
    show("RPT_F10_EH_FREEHOLDERS", f'(SECUCODE="{SECU}")', 12, "【仅流通】")
    show("RPT_F10_EH_FREEHOLDERS", "", 3, "【批量：不筛股票】")

    print("\n" + "=" * 80)
    print("二、户数与持股集中度")
    print("=" * 80)
    show("RPT_HOLDERNUMLATEST", f'(SECURITY_CODE="{CODE}")', 3, "单只")
    show("RPT_HOLDERNUMLATEST", "(SECURITY_CODE=\"600519\")", 3, "单只-同义")
    show("RPT_HOLDERNUM_DETAIL", f'(SECURITY_CODE="{CODE}")', 3, "明细")

    print("\n" + "=" * 80)
    print("三、分红送配")
    print("=" * 80)
    show("RPT_SHAREBONUS_DET", f'(SECURITY_CODE="{CODE}")', 10, "单只全部")
    show("RPT_SHAREBONUS_DET", "", 3, "批量")

    print("\n" + "=" * 80)
    print("四、主营构成（peers.segments）")
    print("=" * 80)
    show("RPT_F10_FN_MAINOP", f'(SECUCODE="{SECU}")', 20, "单只")
    show("RPT_F10_FN_MAINOP", f'(SECURITY_CODE="{CODE}")', 20, "单只-code")

    print("\n" + "=" * 80)
    print("五、实控人 / 控股股东 / 高管 / 质押 / 解禁 / 机构持股")
    print("=" * 80)
    for rn in ("RPT_F10_BASIC_ORGINFO", "RPT_F10_EH_RIGHTHOLDER",
               "RPT_F10_PLEDGE_STATISTICS", "RPT_F10_EH_EXECUTIVE",
               "RPT_F10_EH_HOLDERNUM", "RPT_F10_EH_SHUMMARY",
               "RPT_F10_EH_STOCKHOLDER", "RPT_F10_EH_HOLDERS_NEW",
               "RPT_F10_EH_RESTRICTED", "RPT_F10_EH_UNLOCK",
               "RPT_PLEDGE_STATISTICS", "RPT_PLEDGE_DETAIL",
               "RPT_F10_BASIC_HOLDERNUM", "RPT_F10_BASIC_PLEDGE"):
        d = dc(rn, f'(SECUCODE="{SECU}")', size=2)
        ok = d.get("success")
        res = d.get("result") or {}
        rows = res.get("data") or []
        flag = "OK " if ok else "-- "
        keys = list(rows[0].keys())[:6] if rows else []
        print(f"  {flag}{rn:<30} count={str(res.get('count')):<10} {keys}")
        time.sleep(0.2)
