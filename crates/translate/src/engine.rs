//! Offline Marian (opus-mt-en-zh) engine on ONNX Runtime — SPIKE PENDING.
//!
//! The model bundle (quantized ONNX + tokenizer.json + config.json) is
//! managed by this crate and downloadable from the settings UI, but the ONNX
//! decode loop is not wired yet: it must be validated against the installed
//! `ort` version with a real cargo build (see the plan's spike step). Until
//! then `engine_ready` reports false so callers fall back to MyMemory.
//!
//! Wiring notes for the spike:
//! - encoder_model_quantized.onnx: inputs `input_ids` / `attention_mask`
//!   (i64 `[1, n]`) → `last_hidden_state`.
//! - decoder_model_merged_quantized.onnx: step 0 feeds `decoder_start_token_id`
//!   (Marian: pad_token_id, usually 58100) with no cache; later steps feed the
//!   last token plus the previous run's `present.N.*` tensors as
//!   `past_key_values.N.*` inputs.
//! - Greedy: argmax over `logits[:, -1]`, stop at `eos_token_id` (Marian: 0),
//!   decode with `skip_special_tokens = true`.
//! - Cache one loaded session per model directory; loading takes seconds and
//!   must run inside `spawn_blocking` at the call site.
use anyhow::{bail, Result};
use std::path::Path;

/// True once the decode loop is wired AND the model files are present.
pub fn engine_ready(base: &Path) -> bool {
    let wired = false; // flip to true when the spike lands
    wired
        && [
            "encoder_model_quantized.onnx",
            "decoder_model_merged_quantized.onnx",
            "tokenizer.json",
            "config.json",
        ]
        .iter()
        .all(|name| base.join(name).is_file())
}

pub fn engine_translate(_base: &Path, _text: &str) -> Result<String> {
    bail!("离线翻译引擎尚未接线；当前使用 MyMemory 兜底")
}
