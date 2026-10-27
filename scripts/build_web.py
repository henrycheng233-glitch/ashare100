#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""data.json -> web/data.js（window.__DATA__），让页面可以 file:// 直接打开，无需服务器。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
doc = json.loads((ROOT / "data.json").read_text(encoding="utf-8"))
out = ROOT / "web/data.js"
out.write_text("window.__DATA__=" + json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + ";\n",
               encoding="utf-8")
print(f"{out}  {out.stat().st_size/1024/1024:.1f} MB  {len(doc['companies'])} 家")
