"""Daily market collector. stdout is a single JSON document; failures exit nonzero."""
import contextlib
import datetime as dt
import json
import os
import sys

# Index functions are keyed by market. Every entry was verified against the
# installed akshare (see scripts/probe_market_sources.py): each returned rows for
# the symbols listed in resources/data-presets.json. The Eastmoney endpoints are
# unreachable through the local proxy, so only the Sina-backed functions are used.
INDEX_SOURCES = {
    "CN": "stock_zh_index_daily",
    "US": "index_us_stock_sina",
    "HK": "stock_hk_index_daily_sina",
}
INDEX_SOURCE_URL = {
    "CN": "https://finance.sina.com.cn/realstock/company/{symbol}/nc.shtml",
    "US": "https://finance.sina.com.cn/stock/usstock/",
    "HK": "https://finance.sina.com.cn/stock/hkstock/",
}
CURRENCY = {"CN": "CNY", "US": "USD", "HK": "HKD"}
SHARE_UNIT = {"CN": "元/股", "US": "USD/share", "HK": "HKD/share"}
INDEX_UNIT = {"CN": "点", "US": "点", "HK": "点"}


def normalize(frame, start):
    """Reduces an upstream frame to the {date, ohlcv} points the pipeline stores.

    A row without a usable close is dropped rather than stored as a hole, and a
    missing optional column becomes null instead of failing the whole refresh.
    """
    points = []
    for row in frame.to_dict("records"):
        date = str(row.get("date", ""))[:10]
        if not date or date < start.isoformat():
            continue
        point = {"date": date}
        for key in ("open", "high", "low", "close", "volume"):
            try:
                point[key] = float(row[key])
            except (KeyError, TypeError, ValueError):
                point[key] = None
        if point["close"] is None:
            continue
        points.append(point)
    return points


def collect(config):
    symbol = str(config.get("symbol", "")).strip()
    market = config.get("market", "CN")
    provider = config.get("provider", "sina")
    kind = config.get("kind", "stock")
    if not symbol or not all(c.isalnum() or c in ".-" for c in symbol):
        raise ValueError("请输入有效股票或指数代码")
    end = dt.date.today()
    start = end - dt.timedelta(days=365 * 3 + 3)
    adapter = config.get("adapter")

    if kind == "index":
        if adapter == "tushare":
            raise ValueError("Tushare 适配器仅提供 A 股个股日线，指数请选择 akshare 来源")
        import akshare as ak

        function_name = INDEX_SOURCES.get(market)
        if function_name is None:
            raise ValueError("指数仅支持 A 股、美股与港股")
        function = getattr(ak, function_name, None)
        if function is None:
            raise ValueError(f"当前 akshare 未提供 {function_name}")
        frame = function(symbol=symbol)
        points = normalize(frame, start)
        source_url = INDEX_SOURCE_URL[market].format(symbol=symbol)
        return {
            "points": points,
            "symbol": symbol,
            "market": market,
            "kind": "index",
            "provider": f"akshare · {function_name}",
            "currency": CURRENCY.get(market),
            "unit": INDEX_UNIT.get(market, "点"),
            "priceBasis": "index",
            "sourceUrl": source_url,
            "frequency": "daily",
        }

    if adapter == "tushare":
        import tushare as ts

        key = os.environ.get("TUSHARE_TOKEN")
        if not key:
            raise ValueError("未配置 TUSHARE_TOKEN")
        if market != "CN":
            raise ValueError("当前 Tushare 适配器仅提供 A 股日线")
        frame = ts.pro_api(key).daily(
            ts_code=symbol,
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
        )
        points = [
            dict(
                date=dt.datetime.strptime(str(r.trade_date), "%Y%m%d").date().isoformat(),
                open=float(r.open),
                high=float(r.high),
                low=float(r.low),
                close=float(r.close),
                volume=float(r.vol) * 100,
            )
            for r in frame.itertuples()
        ]
        source_url = "https://tushare.pro/document/2?doc_id=27"
        provider = "tushare"
    else:
        import akshare as ak

        if market == "CN":
            code = symbol.split(".")[0]
            if len(code) != 6 or not code.isdigit():
                raise ValueError("A 股需使用六位数字代码")
            if provider == "eastmoney":
                # Known unreachable through the local proxy; kept for deployments
                # that can reach it, and reported by the probe script when not.
                frame = ak.stock_zh_a_hist(
                    symbol=code,
                    period="daily",
                    start_date=start.strftime("%Y%m%d"),
                    end_date=end.strftime("%Y%m%d"),
                    adjust="",
                    timeout=30,
                )
                frame = frame.rename(
                    columns={
                        "日期": "date",
                        "开盘": "open",
                        "收盘": "close",
                        "最高": "high",
                        "最低": "low",
                        "成交量": "volume",
                    }
                )
                frame["volume"] = frame["volume"] * 100
                source_url = "https://quote.eastmoney.com/"
            elif provider == "sina":
                if code.startswith(("4", "8", "92")):
                    raise ValueError("新浪适配器暂不支持北交所代码，请选择其他来源")
                exchange = "sh" if code.startswith(("6", "9")) else "sz"
                frame = ak.stock_zh_a_daily(
                    symbol=exchange + code,
                    start_date=start.strftime("%Y%m%d"),
                    end_date=end.strftime("%Y%m%d"),
                    adjust="",
                )
                source_url = (
                    f"https://finance.sina.com.cn/realstock/company/{exchange}{code}/nc.shtml"
                )
            else:
                raise ValueError("未知 A 股行情来源")
        else:
            provider = "sina"
            frame = ak.stock_us_daily(symbol=symbol.upper(), adjust="")
            source_url = "https://finance.sina.com.cn/stock/usstock/"
        points = normalize(frame, start)

    if not points:
        raise ValueError("来源未返回行情，未使用缓存或模拟结果替代")
    points.sort(key=lambda p: p["date"])
    return {
        "points": points,
        "symbol": symbol,
        "market": market,
        "kind": kind,
        "provider": provider,
        "currency": CURRENCY.get(market),
        "unit": SHARE_UNIT.get(market, "元/股"),
        "priceBasis": "unadjusted",
        "sourceUrl": source_url,
        "frequency": "daily",
    }


if __name__ == "__main__":
    try:
        # Third-party progress messages must not corrupt the transport payload.
        with contextlib.redirect_stdout(sys.stderr):
            result = collect(json.loads(sys.argv[1]))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
