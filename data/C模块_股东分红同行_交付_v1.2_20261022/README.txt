C 模块交付包 · shareholders + dividends + peers
规范版本 v1.2　｜　100 家公司　｜　2026-10-22

【目录】
  C-module/   交付物，直接合并进 data.json
    data_C_holders_dividends.json   100 家 × 3 个 section
    peers_map.csv                   同行映射抽查表（code/name/行业/peer1..4）
    README_C.md                     完整交付说明（口径、缺口、返工记录）

  scripts/    可复现脚本，cd 到本目录直接跑
    fetch_c.py            主抓取脚本（v1.2 口径已内置）
    stocks.py             100 家名单 + 主键
    build_stocks.py       从集成人 Excel 生成名单
    make_peers_map.py     生成 peers_map.csv
    check_c.py            本地自检
    audit_vs_spec.py      逐字段对照 v1.2 核对
    fix_v12.py            v1.2 三处返工修复（幂等，自动 .bak）
    verify_consistency.py 证明「脚本重算 == 交付数据」
    dump_raw.py           缓存 MAINOP + 归母净利原始行
    market_universe.json  市值前 500 申万行业分类
    raw_cache.json        100 家原始行缓存（离线复算用，2.9MB）

  dev/        探查留档，不必运行
    probe_api.py / probe_seg_raw.py / crosscheck.py
    fix_v12.log          三处返工的逐条日志
    seg_raw.json         16 家超 100% 的原始行快照

【三条命令验证】
  cd scripts
  python check_c.py             # 0 error / 4 warning
  python audit_vs_spec.py       # 0 error / 0 warning（v1.2）
  python verify_consistency.py  # 0 差异

【本次 v1.2 改了什么】
  1. 控股股东剔除名义持有人（HKSCC 等 4 种写法）后再取第一名：16 家修正
  2. segments 按 §5.6 三条硬规则重算：18 处超 100% 全部消除，
     190 个 (公司,维度) 组合合计全部落在 [95, 100.5]
  3. 分红零值规则落地：76 条零分红中 35 条（净利>0）改为 0.0
  4. meta.schema_version → "1.2"

【需要你裁决一处】
  603259 / 603986 这两家，审计文件把它们列进了「置为无控股股东」的括号里，
  但它们的 controller 并非「无实际控制人」（分别是李革等三人、朱一明），
  且剔除名义持有人后第 1 名就是实控人本人或其持股平台。
  我按规则的条件分句执行，保留了 G&C VI Limited (4.27%) 和 朱一明 (4.94%)。
  详见 README_C.md §11.1 结尾。

【前端注意】
  segments 条数上限从 5 放宽：每类 1–11 条不等（源数据粒度决定）。
  建议按 ratio 降序展示前 N 条，或饼图按实际占比绘制。
  top10 有 6 家名次并列，rank 不能当唯一键。
