# Ashare100 · 公司全景图谱

A 股市值前 100 家公司的档案库：一份数据、一个前端、一条可复现的生成链路。

- 行情基准日：2026-10-22 收盘
- 财务口径：2021–2025 年报 + 2026 年中报
- 规模：100 家 × 8 个数据维度，静态页面，无后端

## 目录

| 路径                              | 内容                           |
| ------------------------------- | ---------------------------- |
| `web/`                          | 前端源码（`index.html` 双击即开）      |
| `Ashare100_离线版.html`            | 单文件离线版，5.6 MB，可直接发人          |
| `data.json`                     | 合并后的数据（前端唯一数据源）              |
| `data/`                         | 四个模块的原始交付与采集证据（A 的 K 线原始响应等） |
| `scripts/merge_all.py`          | 四模块 → `data.json`            |
| `scripts/build_web.py`          | `data.json` → `web/data.js`  |
| `scripts/fetch_B_financials.py` | B 模块（财务）抓取                   |
| `validate.py`                   | 字段、类型、单位、口径校验                |

## 打开

- 离线：双击 `Ashare100_离线版.html`
- 源码：打开 `web/index.html`，或在本目录 `python3 -m http.server 8787` 后访问

## 更新数据

```bash
python3 scripts/merge_all.py     # 合并 -> data.json
python3 scripts/build_web.py     # -> web/data.js
python3 validate.py data.json    # 校验，目标 0 error
```

## 数据说明

- 金额单位「元」，比率存百分数数值；缺失为 `null`，`0` 表示真实为零
- 字段定义见 `字段说明_前端.md`，组员采集规范见 `说明_组员版.md`
- 已知限制：成交额来自补充采集；指数成分未覆盖全部（93 家）；高管薪酬部分缺失

## 分工

数据 A 滕梓棋 · B 程建诚 · C 崔扬 · D 沈亦冰；前端 施页川、胡源、程建诚、滕梓棋；集成与校验：程建诚
