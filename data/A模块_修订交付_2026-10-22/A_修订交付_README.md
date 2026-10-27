# A 模块修订交付（行情截至 2026-10-22 收盘）

正式交付文件是根目录的 `data_A_identity_market.json`，UTF-8 无 BOM、2 空格缩进。100 家固定名单未变；`identity` 与 2026-10-23 草稿逐字段一致，包括 Choice 截至 2025-12-31 的员工数和中国神华 `chairman: null`。十大股东与公司概况补充文件没有并入正式 JSON，作为独立核查证据存于 `evidence/`。

## 本次改动

- `meta.as_of_date` 与全部 `market.as_of_date`：`2026-10-22`。
- `meta.collector`：滕梓棋；`schema_version`：`1.4`；`report_period`：`2026-06-30`；`count`：100；`generated_at` 是实际生成时刻，含 `+08:00` 时区。
- 10 项估值字段（收盘价、涨跌幅、市值、股本、PE TTM、静态 PE、PB、PS TTM）来自东方财富 `RPT_VALUEANALYSIS_DET` 的 2026-10-22 全量快照。`pe_static` 对应 `PE_LAR`，没有代用 `PE_TTM`。金额单位为元，股本单位为股，比例为百分数数值。
- 52 周高低、年初至今、近 1 年与近 3 年涨幅由腾讯日线计算。优先使用 `qfqday`；腾讯对 8 家返回 `day` 而无 `qfqday`，按该接口可得序列计算。年初至今和近 1 年要求基准日有日线记录；近 3 年基准为不晚于 2023-10-22 的最近交易日。没有适用基准价时保留 `null`。
- 换手率由当日成交量与东方财富同日流通股本计算。腾讯的科创板（`688`）日线成交量按股处理，其余按手处理。
- 有 7 家股票在 2026-10-23 除息，腾讯当前前复权序列已扣除该日现金红利。逐家用东财 2026-10-22 收盘价与腾讯同日价的差额校验后，将这笔现金红利**加回** 52 周高低价和区间涨幅的分子、分母，使价格基准回到 2026-10-22。7 家为 `600150.SH`、`601601.SH`、`601919.SH`、`688008.SH`、`601985.SH`、`000338.SZ`、`601688.SH`。

## 明确缺失项

| 字段 | `null` 家数 | 说明 |
| --- | ---: | --- |
| `amount` | 100 | 腾讯日线仅给成交量，历史成交额未取得；没有用成交量乘收盘价冒充成交额。 |
| `dividend_yield` | 100 | 留给团队用 C 模块分红数据及当日收盘价计算。 |
| `ytd_return` | 6 | 5 家在 2025-12-31 后上市；`688012.SH` 当日没有日线记录，最近一次成交为 2025-12-18，未以该日替代指定基准日。 |
| `return_1y` | 7 | 2025-10-22 后上市，无近 1 年基准价。 |
| `return_3y` | 8 | 2023-10-22 后上市，无近 3 年基准价。 |

`index_members` 依反馈统一为 `[]`，不代表已经逐一核对指数归属。

## 文件与校验

- `data_A_identity_market.json`：唯一正式 A 模块数据。
- `evidence/A_market_auto_2026-10-22.json`：东财估值提取结果，固定 100 家。
- `evidence/A_market_tencent_qfq_raw_2026-10-22.json`：腾讯日线原始数组，含 `qfqday`/`day` 类型标识。
- `evidence/data_A_identity_market.draft.json`：仅用于证明 identity 未变，不可作为交付数据。
- `evidence/A_top10_shareholders_supplement_2026-10-23.json` 与 `evidence/A_company_overview_supplement_2026-10-23.json`：独立补充资料。
- `reproduction/`：行情采集、合成及本地校验脚本；运行前将文件放回同一目录。
- `SHA256SUMS.txt`：包内文件校验值，不含清单自身。

本地 `validate_A_20261022.py` 已通过：100 家、20 个 market 字段、identity 不变、全部日期与估值源一致。反馈提到的团队 `ashare100/validate.py` 尚未提供到本目录，因此无法声称已通过该脚本的 `0 error` 验收。

数据接口：

- 东方财富：`https://datacenter-web.eastmoney.com/api/data/v1/get`（`reportName=RPT_VALUEANALYSIS_DET`，`TRADE_DATE=2026-10-22`）
- 腾讯：`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`（`qfq` 日线）
