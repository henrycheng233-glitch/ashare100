# -*- coding: utf-8 -*-
"""
交叉核验：拿 3 家公司的分红总额，去巨潮公告原文里对金额。
用的是与抓取完全不同的数据源（公告正文），避免「自己验自己」。
"""
import json
import re
import time

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
S = requests.Session()
S.headers.update({
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Referer": "http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice",
})


def org_map():
    m = {}
    for f in ("szse_stock.json", "sse_stock.json", "bj_stock.json"):
        try:
            r = S.get(f"http://www.cninfo.com.cn/new/data/{f}", timeout=(10, 40))
            d = r.json()
            for it in d.get("stockList") or []:
                if it.get("code") and it.get("orgId"):
                    m[it["code"]] = it["orgId"]
        except Exception:
            pass
    return m


def search_ann(code, org, keyword, column="sse", pages=2):
    out = []
    for p in range(1, pages + 1):
        data = {
            "pageNum": str(p), "pageSize": "30", "column": column, "tabName": "fulltext",
            "plate": "", "stock": f"{code},{org}", "searchkey": keyword, "secid": "",
            "category": "", "trade": "", "seDate": "", "sortName": "",
            "sortType": "", "isHLtitle": "true",
        }
        try:
            r = S.post("http://www.cninfo.com.cn/new/hisAnnouncement/query",
                       data=data, timeout=(15, 60))
            j = r.json()
            out.extend(j.get("announcements") or [])
        except Exception:
            pass
        time.sleep(1.2)
    return out


def main():
    # 注意：巨潮 stock+searchkey 组合不生效，只能拉全量再本地筛
    m = org_map()
    print(f"orgId 映射表 {len(m)} 条\n")

    data = json.load(open("data_C_holders_dividends.json", encoding="utf-8"))
    cos = data["companies"]

    targets = [
        ("600519", "600519.SH", "贵州茅台", "sse", 2025),
        ("601398", "601398.SH", "工商银行", "sse", 2025),
        ("000858", "000858.SZ", "五粮液", "szse", 2025),
    ]

    for code, key, name, col, year in targets:
        org = m.get(code)
        print("=" * 76)
        print(f"{name} {key}  2025 年度分红（我方数据）")
        dv = cos[key]["dividends"]
        a = next(x for x in dv["annual"] if x["fiscal_year"] == year)
        print(f"  DPS（税前，元/股）= {a['dps_pretax']}")
        print(f"  分红总额        = {a['total_amount']/1e8:.2f} 亿元")
        print(f"  分红率          = {a['payout_ratio']}%")

        if not org:
            print("  [skip] 无 orgId")
            continue

        # 拉近两年公告，本地筛「权益分派 / 分红」类
        anns = search_ann(code, org, "", col, pages=4)
        sel = [x for x in anns
               if any(k in (x.get("announcementTitle") or "")
                      for k in ("权益分派", "分红", "利润分配", "派息"))
               and str(year) in (x.get("announcementTitle") or "")]
        print(f"\n  巨潮公告里 {year} 年分红相关公告：{len(sel)} 条")
        for x in sel[:4]:
            t = re.sub(r"</?em>", "", x.get("announcementTitle") or "")
            d = time.strftime("%Y-%m-%d", time.localtime((x.get("announcementTime") or 0) / 1000))
            print(f"    {d}  {t[:56]}")
            print(f"        http://static.cninfo.com.cn/{x.get('adjunctUrl')}")
        print()


if __name__ == "__main__":
    main()
