//! Offline English→Chinese translation.
//!
//! The offline engine (Marian opus-mt-en-zh on ONNX Runtime) is feature-gated
//! behind `onnx` and needs a one-time model download into the app data
//! directory; the decode loop itself is the pending spike (see `engine.rs`).
//! Callers run a pipeline: local cache → offline engine → MyMemory fallback,
//! and store results in `translation_cache` so repeated sentences never rerun
//! the model or the network.
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

#[cfg(feature = "onnx")]
mod engine;
#[cfg(feature = "onnx")]
pub use engine::{engine_ready, engine_translate};

#[cfg(not(feature = "onnx"))]
pub fn engine_ready(_base: &Path) -> bool {
    false
}
#[cfg(not(feature = "onnx"))]
pub fn engine_translate(_base: &Path, _text: &str) -> Result<String> {
    bail!("此构建未启用离线翻译引擎")
}

/// Files that make up the offline model bundle, in download order. The
/// quantized Marian conversion is small enough to fetch on first use instead
/// of bloating the installer.
pub const MODEL_FILES: [(&str, &str); 4] = [
    (
        "config.json",
        "https://huggingface.co/Xenova/opus-mt-en-zh/resolve/main/config.json",
    ),
    (
        "tokenizer.json",
        "https://huggingface.co/Xenova/opus-mt-en-zh/resolve/main/tokenizer.json",
    ),
    (
        "encoder_model_quantized.onnx",
        "https://huggingface.co/Xenova/opus-mt-en-zh/resolve/main/onnx/encoder_model_quantized.onnx",
    ),
    (
        "decoder_model_merged_quantized.onnx",
        "https://huggingface.co/Xenova/opus-mt-en-zh/resolve/main/onnx/decoder_model_merged_quantized.onnx",
    ),
];

pub fn model_dir(base: &Path) -> PathBuf {
    base.join("translate-model")
}

/// Status for the settings UI: which files are present and how large the
/// bundle is. `ready` requires every file to be non-trivial in size.
pub fn model_status(base: &Path) -> serde_json::Value {
    let dir = model_dir(base);
    let mut files = Vec::new();
    let mut total = 0u64;
    let mut ready = true;
    for (name, _) in MODEL_FILES {
        let path = dir.join(name);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size < 1024 {
            ready = false;
        }
        total += size;
        files.push(serde_json::json!({"name": name, "bytes": size}));
    }
    serde_json::json!({
        "ready": ready,
        "dir": dir,
        "bytes": total,
        "files": files,
        "engineCompiled": cfg!(feature = "onnx"),
    })
}

/// Downloads any missing model files. Existing complete files are kept, so an
/// interrupted download resumes by running this again.
pub async fn download_model(base: &Path) -> Result<serde_json::Value> {
    let dir = model_dir(base);
    tokio::fs::create_dir_all(&dir).await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .user_agent("Cetrinw/0.2 personal translation model")
        .build()?;
    for (name, url) in MODEL_FILES {
        let target = dir.join(name);
        if std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0) > 1024 {
            continue;
        }
        let response = client.get(url).send().await?;
        if !response.status().is_success() {
            bail!(
                "模型下载失败：{name} 返回 HTTP {}，请稍后重试",
                response.status()
            );
        }
        let temp = target.with_extension("part");
        let mut file = tokio::fs::File::create(&temp).await?;
        let mut response = response;
        while let Some(chunk) = response.chunk().await? {
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        }
        tokio::io::AsyncWriteExt::flush(&mut file).await?;
        drop(file);
        tokio::fs::rename(&temp, &target).await?;
    }
    Ok(model_status(base))
}
