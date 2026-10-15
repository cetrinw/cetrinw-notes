"""Probes the market-data libraries that are actually installed, so index and
benchmark sources are added from evidence rather than from assumption.

    .venv/bin/python scripts/probe_market_sources.py
    .venv/bin/python scripts/probe_market_sources.py --json output/market-probe.json

Prints one line per candidate: OK / EMPTY / FAIL, with the row count and the
first/last observation date. Reads nothing from the personal library and writes
nothing to it; the only output is stdout and the optional JSON file.
"""

import argparse
import datetime as dt
import importlib
import json
import sys

# Candidates are grouped by what they would let a dashboard compare. Symbols use
# the spelling each upstream source expects; a miss is reported, never guessed at.
A_SHARE_INDICES = [
    ("sh000001", "上证指数"),
    ("sz399001", "深证成指"),
    ("sz399006", "创业板指"),
    ("sh000300", "沪深300"),
    ("sh000905", "中证500"),
    ("sh000016", "上证50"),
    ("sh000688", "科创50"),
    ("sz399005", "中小100"),
]
US_INDICES = [
    (".INX", "标普500"),
    (".DJI", "道琼斯工业"),
    (".IXIC", "纳斯达克综合"),
    (".NDX", "纳斯达克100"),
]
HK_INDICES = [("HSI", "恒生指数")]


def probe(label, fn, symbol):
    """Runs one upstream call and reduces it to a reportable fact."""
    try:
        frame = fn(symbol=symbol)
    except Exception as exc:  # noqa: BLE001 - every upstream failure is reportable
        return {"label": label, "symbol": symbol, "status": "FAIL",
                "detail": f"{type(exc).__name__}: {str(exc)[:160]}"}
    try:
        rows = len(frame)
        if not rows:
            return {"label": label, "symbol": symbol, "status": "EMPTY",
                    "detail": "0 rows"}
        date_column = next(
            (c for c in ("date", "日期", "trade_date") if c in frame.columns), None
        )
        first = last = None
        if date_column:
            values = sorted(str(v)[:10] for v in frame[date_column].tolist())
            first, last = values[0], values[-1]
        return {"label": label, "symbol": symbol, "status": "OK", "rows": rows,
                "first": first, "last": last,
                "columns": [str(c) for c in frame.columns][:12]}
    except Exception as exc:  # noqa: BLE001
        return {"label": label, "symbol": symbol, "status": "FAIL",
                "detail": f"shape: {type(exc).__name__}: {str(exc)[:160]}"}


def collect():
    try:
        import akshare as ak
    except Exception as exc:  # noqa: BLE001
        print(f"akshare 未安装，无法探测：{type(exc).__name__}: {exc}")
        return None, []

    installed = {}
    for name in ("akshare", "tushare", "pandas"):
        try:
            installed[name] = getattr(importlib.import_module(name), "__version__", "?")
        except Exception:  # noqa: BLE001
            installed[name] = None
    index_functions = sorted(
        f for f in dir(ak) if not f.startswith("_") and "index" in f.lower()
    )

    attempts = []
    daily = getattr(ak, "stock_zh_index_daily", None)
    if daily:
        for symbol, label in A_SHARE_INDICES:
            attempts.append(probe(f"A股 · {label}", daily, symbol))
    em = getattr(ak, "stock_zh_index_daily_em", None)
    if em:
        for symbol, label in A_SHARE_INDICES:
            attempts.append(probe(f"A股(东财) · {label}", em, symbol))
    us = getattr(ak, "index_us_stock_sina", None) or getattr(
        ak, "stock_us_index_daily", None
    )
    if us:
        for symbol, label in US_INDICES:
            attempts.append(probe(f"美股 · {label}", us, symbol))
    hk = getattr(ak, "stock_hk_index_daily_sina", None)
    if hk:
        for symbol, label in HK_INDICES:
            attempts.append(probe(f"港股 · {label}", hk, symbol))

    return {"installed": installed, "indexFunctions": index_functions,
            "probedAt": dt.datetime.now().isoformat(timespec="seconds")}, attempts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", help="把完整结果写入该文件")
    args = parser.parse_args()

    meta, attempts = collect()
    if meta is None:
        return 1

    print("已安装：", ", ".join(
        f"{k} {v}" if v else f"{k} 缺失" for k, v in meta["installed"].items()
    ))
    print(f"akshare 指数类函数 {len(meta['indexFunctions'])} 个：")
    for name in meta["indexFunctions"]:
        print(f"  - {name}")
    print()
    for item in attempts:
        if item["status"] == "OK":
            print(f"OK    {item['label']:<22} {item['symbol']:<10} "
                  f"{item['rows']:>6} 行  {item['first']} → {item['last']}")
        else:
            print(f"{item['status']:<5} {item['label']:<22} {item['symbol']:<10} "
                  f"{item['detail']}")
    working = [i for i in attempts if i["status"] == "OK"]
    print(f"\n可用 {len(working)} / {len(attempts)}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump({"meta": meta, "attempts": attempts, "working": working},
                      handle, ensure_ascii=False, indent=2)
        print(f"已写入 {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
