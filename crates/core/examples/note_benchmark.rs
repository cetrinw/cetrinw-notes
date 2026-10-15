use cetrinw_core::Store;
use serde_json::json;
use std::time::Instant;

fn main() -> anyhow::Result<()> {
    let directory = tempfile::tempdir()?;
    let mut db = Store::open(directory.path())?;
    let start = Instant::now();
    let sectors = [
        "超级电容",
        "半导体",
        "储能",
        "铜产业",
        "光伏",
        "工业软件",
        "机械设备",
        "消费电子",
    ];
    for i in 0..10_000 {
        let sector = sectors[i % sectors.len()];
        let paragraphs = [
            format!("{sector} 研究记录 {i}。本记录是性能现实夹具，不代表实际行业结论。分析上游材料供应商、器件制造、系统集成和下游客户之间的关系。"),
            format!("资料编号 REPORT-{i:05}。阅读公司公告后需要确认合同主体、实际订单金额、预计交付日期与收入确认条件。相关业务占比不能从企业名称直接推断。"),
            "事件和判断分开保存。假设订单增长能够改善产能利用率，后续需核对季度产量、成本、毛利率及现金流。反证包括交付延期、价格下降和替代技术渗透。".into(),
            "回看当时可以获得的信息，记录来源的统计期间、发布日期和抓取日期。股价使用未经复权的真实收盘价，拆股和分红另行核对。Keep the evidence separate from the hypothesis.".into(),
        ];
        let content = paragraphs
            .iter()
            .map(|s| json!({"type":"paragraph","content":[{"type":"text","text":s}]}))
            .collect::<Vec<_>>();
        db.save(&json!({"id":format!("fixture-{i}"),"kind":"note","title":format!("{sector} 行业分析 {i}"),"data":{"content":{"type":"doc","content":content},"tags":[sector,"现实夹具"],"folder":"研究"}}))?;
    }
    let generation = start.elapsed().as_secs_f64();
    let mut timings = vec![];
    for _ in 0..10 {
        for query in [
            "超级电容",
            "现金流",
            "半导体",
            "毛利率",
            "REPORT-09999",
            "evidence",
            "工业软件",
            "供应商",
            "光伏",
            "交付日期",
        ] {
            let start = Instant::now();
            let rows = db.list("note", query, 30, 0)?;
            assert!(
                !rows.is_empty(),
                "real populated search should return matches"
            );
            timings.push(start.elapsed().as_secs_f64() * 1000.0);
        }
    }
    timings.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"level":"L2","path":"real Store / SQLite FTS5 / Jieba","notes":10000,"samples":100,"generation_seconds":generation,"p50_ms":timings[49],"p95_ms":timings[94],"max_ms":timings[99],"build":"debug","limitation":"Rust query only; does not measure UI, IPC, startup or total app memory"})
        )?
    );
    Ok(())
}
