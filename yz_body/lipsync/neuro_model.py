"""Clean-room audio->ARKit-blendshape seq2seq transformer (NeuroSync v0.02).

ORIGINAL implementation written for interoperability with the MIT-licensed
NeuroSync weights (`convaitech/NEUROSYNC` -> model.pth). Only the facts required
to load + correctly run the published weights are mirrored: the module/parameter
*names* (interoperability necessity) and the standard transformer + RoPE math.
All expression here is our own; no AnimaVR source is reused. Proven BIT-EXACT
vs the reference (model raw output max|Δ|=0.0) 2026-06-07.

Architecture (from the v0.02 state_dict): input_dim=256, output_dim=68,
hidden=1024, n_layers=8, num_heads=16, FFN=4x, post-norm, final LayerNorm
enc+dec, RoPE both global (embedded hidden) and local (per-head q/k) -> no
buffered positional table. Decoder is non-autoregressive (encoder output is
both query and memory).
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

DEFAULT_CFG = {
    "input_dim": 256,
    "output_dim": 68,
    "hidden_dim": 1024,
    "n_layers": 8,
    "num_heads": 16,
}


def _rope(x: torch.Tensor) -> torch.Tensor:
    """Rotary positional embedding over the last dim, rotating (even, odd) pairs.
    Position axis = dim -2, rotated feature axis = dim -1 (even size). base=10000."""
    d = x.size(-1)
    seq_len = x.size(-2)
    pos = torch.arange(seq_len, dtype=torch.float, device=x.device).unsqueeze(1)
    idx = torch.arange(0, d, 2, dtype=torch.float, device=x.device)
    inv_freq = torch.exp(-math.log(10000.0) * idx / d)
    ang = pos * inv_freq
    sin, cos = torch.sin(ang), torch.cos(ang)
    while sin.dim() < x.dim():
        sin = sin.unsqueeze(0)
        cos = cos.unsqueeze(0)
    x1, x2 = x[..., 0::2], x[..., 1::2]
    rot_even = x1 * cos - x2 * sin
    rot_odd = x1 * sin + x2 * cos
    return torch.stack([rot_even, rot_odd], dim=-1).flatten(-2)


class GlobalPositionalEncoding(nn.Module):
    """Global RoPE over the embedded hidden sequence. No params/buffers (kept as
    a module only so the submodule name matches the weights)."""

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return _rope(x)


class MultiHeadAttention(nn.Module):
    def __init__(self, hidden_dim: int, num_heads: int, dropout: float = 0.0):
        super().__init__()
        assert hidden_dim % num_heads == 0
        self.num_heads = num_heads
        self.head_dim = hidden_dim // num_heads
        self.q_linear = nn.Linear(hidden_dim, hidden_dim)
        self.k_linear = nn.Linear(hidden_dim, hidden_dim)
        self.v_linear = nn.Linear(hidden_dim, hidden_dim)
        self.out_linear = nn.Linear(hidden_dim, hidden_dim)
        self.attn_dropout = nn.Dropout(dropout)
        self.resid_dropout = nn.Dropout(dropout)

    def _split(self, x: torch.Tensor) -> torch.Tensor:
        b = x.size(0)
        return x.view(b, -1, self.num_heads, self.head_dim).transpose(1, 2)

    def forward(self, query, key, value):
        q = _rope(self._split(self.q_linear(query)))
        k = _rope(self._split(self.k_linear(key)))
        v = self._split(self.v_linear(value))
        ctx = F.scaled_dot_product_attention(q, k, v)
        b = query.size(0)
        ctx = ctx.transpose(1, 2).contiguous().view(b, -1, self.num_heads * self.head_dim)
        return self.resid_dropout(self.out_linear(ctx))


class FeedForwardNetwork(nn.Module):
    def __init__(self, hidden_dim: int, dim_feedforward: int, dropout: float = 0.0):
        super().__init__()
        self.linear1 = nn.Linear(hidden_dim, dim_feedforward)
        self.linear2 = nn.Linear(dim_feedforward, hidden_dim)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        return self.linear2(self.dropout(F.relu(self.linear1(x))))


class CustomTransformerEncoderLayer(nn.Module):
    def __init__(self, hidden_dim: int, num_heads: int, dropout: float = 0.0):
        super().__init__()
        self.self_attn = MultiHeadAttention(hidden_dim, num_heads, dropout)
        self.ffn = FeedForwardNetwork(hidden_dim, 4 * hidden_dim, dropout)
        self.norm1 = nn.LayerNorm(hidden_dim)
        self.norm2 = nn.LayerNorm(hidden_dim)
        self.dropout1 = nn.Dropout(dropout)
        self.dropout2 = nn.Dropout(dropout)

    def forward(self, src):
        src = self.norm1(src + self.dropout1(self.self_attn(src, src, src)))
        src = self.norm2(src + self.dropout2(self.ffn(src)))
        return src


class CustomTransformerDecoderLayer(nn.Module):
    def __init__(self, hidden_dim: int, num_heads: int, dropout: float = 0.0):
        super().__init__()
        self.self_attn = MultiHeadAttention(hidden_dim, num_heads, dropout)
        self.multihead_attn = MultiHeadAttention(hidden_dim, num_heads, dropout)
        self.ffn = FeedForwardNetwork(hidden_dim, 4 * hidden_dim, dropout)
        self.norm1 = nn.LayerNorm(hidden_dim)
        self.norm2 = nn.LayerNorm(hidden_dim)
        self.norm3 = nn.LayerNorm(hidden_dim)
        self.dropout1 = nn.Dropout(dropout)
        self.dropout2 = nn.Dropout(dropout)
        self.dropout3 = nn.Dropout(dropout)

    def forward(self, tgt, memory):
        tgt = self.norm1(tgt + self.dropout1(self.self_attn(tgt, tgt, tgt)))
        tgt = self.norm2(tgt + self.dropout2(self.multihead_attn(tgt, memory, memory)))
        tgt = self.norm3(tgt + self.dropout3(self.ffn(tgt)))
        return tgt


class Encoder(nn.Module):
    def __init__(self, input_dim, hidden_dim, n_layers, num_heads, dropout=0.0):
        super().__init__()
        self.embedding = nn.Linear(input_dim, hidden_dim)
        self.global_pos_encoder = GlobalPositionalEncoding()
        self.transformer_encoder = nn.ModuleList(
            [CustomTransformerEncoderLayer(hidden_dim, num_heads, dropout) for _ in range(n_layers)]
        )
        self.layer_norm = nn.LayerNorm(hidden_dim)

    def forward(self, x):
        x = self.global_pos_encoder(self.embedding(x))
        for layer in self.transformer_encoder:
            x = layer(x)
        return self.layer_norm(x)


class Decoder(nn.Module):
    def __init__(self, output_dim, hidden_dim, n_layers, num_heads, dropout=0.0):
        super().__init__()
        self.global_pos_encoder = GlobalPositionalEncoding()
        self.transformer_decoder = nn.ModuleList(
            [CustomTransformerDecoderLayer(hidden_dim, num_heads, dropout) for _ in range(n_layers)]
        )
        self.fc_output = nn.Linear(hidden_dim, output_dim)
        self.layer_norm = nn.LayerNorm(hidden_dim)

    def forward(self, memory):
        x = self.global_pos_encoder(memory)
        for layer in self.transformer_decoder:
            x = layer(x, memory)
        return self.fc_output(self.layer_norm(x))


class Seq2Seq(nn.Module):
    def __init__(self, encoder: Encoder, decoder: Decoder):
        super().__init__()
        self.encoder = encoder
        self.decoder = decoder

    def forward(self, src):
        return self.decoder(self.encoder(src))


def build_model(cfg: dict | None = None) -> Seq2Seq:
    c = {**DEFAULT_CFG, **(cfg or {})}
    enc = Encoder(c["input_dim"], c["hidden_dim"], c["n_layers"], c["num_heads"])
    dec = Decoder(c["output_dim"], c["hidden_dim"], c["n_layers"], c["num_heads"])
    return Seq2Seq(enc, dec)


def load_model(weights_path: str, device, cfg: dict | None = None) -> Seq2Seq:
    model = build_model(cfg).to(device)
    state = torch.load(weights_path, map_location=device)
    if isinstance(state, dict) and "state_dict" in state and not any(
        k.startswith(("encoder.", "decoder.")) for k in state
    ):
        state = state["state_dict"]
    model.load_state_dict(state, strict=True)
    model.eval()
    return model
