"""Rebuild a .glb with edited textures.

Pair with glb_extract_textures.py: that script dumps embedded images as
NN_<name>.<ext> files; this script reads the same folder back (matching
files by their NN_ prefix to the original image index) and produces a
new .glb with those bytes embedded.

Usage:
    uv run tools/glb_pack.py <original.glb> <textures-dir> [out.glb]

If out.glb is omitted, writes <original-stem>_repacked.glb next to the
original.

Approach (fast, no mesh re-encoding):

1. Parse original GLB → JSON + BIN.
2. Identify which bufferViews are referenced by images vs. everything
   else (meshes, animations, accessors).
3. Copy non-image bufferViews verbatim into a fresh BIN, preserving
   their relative order and 4-byte alignment.
4. For each image: read replacement bytes from the textures folder if
   present (matched by NN_ prefix), else use the original bytes. Append
   each image's bytes as a fresh bufferView at the end of the new BIN.
5. Rewrite the JSON: update bufferViews list, update images[].bufferView
   indices, update buffer byteLength.
6. Serialize JSON + BIN with proper GLB padding and chunk headers.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

from .glb_extract_textures import (
    CHUNK_BIN,
    CHUNK_JSON,
    GLB_MAGIC,
    ext_from_mime,
    parse_glb,
)


def _pad4(data: bytes, fill: bytes = b"\x00") -> bytes:
    rem = len(data) % 4
    if rem == 0:
        return data
    return data + fill * (4 - rem)


def _mime_from_ext(ext: str) -> str:
    e = ext.lower()
    if e == ".png":
        return "image/png"
    if e in (".jpg", ".jpeg"):
        return "image/jpeg"
    if e == ".webp":
        return "image/webp"
    return ""


def _sniff_ext(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return ""


def pack(
    original_glb: Path,
    textures_dir: Path | None,
    out_glb: Path,
    *,
    verbose: bool = False,
    image_overrides: dict[int, bytes] | None = None,
    material_overrides: dict[str, dict] | None = None,
) -> dict:
    """Rebuild `original_glb` substituting image bytes and / or
    material properties.

    Replacement channels (all optional):
      - `textures_dir`: folder of NN_*.ext files (as produced by
        glb_extract_textures); index → bytes via the NN_ prefix.
      - `image_overrides`: in-memory dict {image_index: bytes}.
      - `material_overrides`: dict {material_name: {key: value, ...}}.
        Each entry is merged into the material's pbrMetallicRoughness
        block. Used to recolor materials whose baseColor is a flat
        factor rather than a texture — e.g., Streamoji hair lives in
        baseColorFactor, not a texture map.

    `image_overrides` wins over `textures_dir` when both supply a
    replacement for the same index.
    """
    gltf, blob = parse_glb(original_glb)
    images = gltf.get("images", [])
    buffer_views = gltf.get("bufferViews", [])

    if not images:
        raise ValueError("GLB has no images to repack")

    image_bv_indices: set[int] = set()
    for img in images:
        bv = img.get("bufferView")
        if bv is not None:
            image_bv_indices.add(bv)

    # Index replacement files by leading NN_ digits, since that's how
    # the extract script names them.
    replacement_by_index: dict[int, Path] = {}
    if textures_dir is not None and textures_dir.is_dir():
        for p in sorted(textures_dir.iterdir()):
            if not p.is_file() or p.name.startswith("_"):
                continue
            stem = p.name
            prefix = stem.split("_", 1)[0]
            if not prefix.isdigit():
                continue
            idx = int(prefix)
            replacement_by_index[idx] = p
    image_overrides = image_overrides or {}

    # Copy non-image bufferViews into a new bin in their original order
    # so accessor byteOffsets remain valid. We keep the original
    # buffer-view indices that aren't image-referencing intact by
    # building a remap table.
    new_blob = bytearray()
    new_buffer_views: list[dict] = []
    bv_index_remap: dict[int, int] = {}

    for old_idx, bv in enumerate(buffer_views):
        if old_idx in image_bv_indices:
            continue  # Image bufferViews are rebuilt at the end.
        start = bv.get("byteOffset", 0)
        length = bv["byteLength"]
        # Align this view's start to its original requirement (default
        # 4-byte). Some loaders are strict about accessor alignment.
        if len(new_blob) % 4 != 0:
            new_blob.extend(b"\x00" * (4 - len(new_blob) % 4))
        new_offset = len(new_blob)
        new_blob.extend(blob[start:start + length])
        new_bv = dict(bv)
        new_bv["byteOffset"] = new_offset
        new_bv["byteLength"] = length
        # Keep buffer index 0 (single-buffer GLBs are the common case).
        new_bv["buffer"] = 0
        bv_index_remap[old_idx] = len(new_buffer_views)
        new_buffer_views.append(new_bv)

    # Append a fresh bufferView for each image. Replacement bytes win
    # over the original; mime is inferred from the replacement's
    # extension (or sniffed from the bytes). In-memory overrides take
    # priority over folder replacements.
    new_images: list[dict] = []
    replaced_count = 0
    for i, img in enumerate(images):
        override_bytes = image_overrides.get(i)
        replacement = replacement_by_index.get(i)
        if override_bytes is not None:
            data = override_bytes
            mime = _sniff_ext(data) or img.get("mimeType", "")
            replaced_count += 1
            if verbose:
                print(f"  image {i}: REPLACED <- in-memory ({len(data):,} bytes)")
        elif replacement is not None:
            data = replacement.read_bytes()
            mime = _mime_from_ext(replacement.suffix) or _sniff_ext(data)
            replaced_count += 1
            if verbose:
                print(f"  image {i}: REPLACED <- {replacement.name} ({len(data):,} bytes)")
        else:
            old_bv_idx = img.get("bufferView")
            if old_bv_idx is None:
                # No original bytes either (uri-based?). Skip.
                new_images.append(dict(img))
                continue
            bv = buffer_views[old_bv_idx]
            start = bv.get("byteOffset", 0)
            length = bv["byteLength"]
            data = blob[start:start + length]
            mime = img.get("mimeType") or _sniff_ext(data)
            if verbose:
                print(f"  image {i}: kept ({len(data):,} bytes)")

        if len(new_blob) % 4 != 0:
            new_blob.extend(b"\x00" * (4 - len(new_blob) % 4))
        new_offset = len(new_blob)
        new_blob.extend(data)
        new_bv = {
            "buffer": 0,
            "byteOffset": new_offset,
            "byteLength": len(data),
        }
        new_buffer_views.append(new_bv)
        new_img = dict(img)
        new_img.pop("uri", None)
        new_img["bufferView"] = len(new_buffer_views) - 1
        if mime:
            new_img["mimeType"] = mime
        new_images.append(new_img)

    # Update everything that references a bufferView by index to use
    # the remapped indices. Image refs are already rewritten above.
    new_gltf = dict(gltf)
    new_gltf["bufferViews"] = new_buffer_views
    new_gltf["images"] = new_images

    # Material property overrides (e.g., hair lives in baseColorFactor,
    # not a texture). Each override entry merges into the named
    # material's pbrMetallicRoughness block — we don't replace the
    # whole material because that would wipe normals/MR/etc.
    materials_overridden = 0
    if material_overrides:
        new_materials = []
        for mat in new_gltf.get("materials", []):
            name = mat.get("name", "")
            override = material_overrides.get(name)
            if not override:
                new_materials.append(mat)
                continue
            m = dict(mat)
            pbr = dict(m.get("pbrMetallicRoughness", {}))
            for k, v in override.items():
                pbr[k] = v
            m["pbrMetallicRoughness"] = pbr
            new_materials.append(m)
            materials_overridden += 1
        new_gltf["materials"] = new_materials

    # Accessors → bufferView remap.
    if "accessors" in new_gltf:
        new_accessors = []
        for acc in new_gltf["accessors"]:
            a = dict(acc)
            if "bufferView" in a and a["bufferView"] in bv_index_remap:
                a["bufferView"] = bv_index_remap[a["bufferView"]]
            # SparseAccessor refs too (rare but spec-correct).
            sparse = a.get("sparse")
            if sparse:
                s = dict(sparse)
                if "indices" in s and "bufferView" in s["indices"]:
                    idx = dict(s["indices"])
                    if idx["bufferView"] in bv_index_remap:
                        idx["bufferView"] = bv_index_remap[idx["bufferView"]]
                    s["indices"] = idx
                if "values" in s and "bufferView" in s["values"]:
                    vals = dict(s["values"])
                    if vals["bufferView"] in bv_index_remap:
                        vals["bufferView"] = bv_index_remap[vals["bufferView"]]
                    s["values"] = vals
                a["sparse"] = s
            new_accessors.append(a)
        new_gltf["accessors"] = new_accessors

    # Some extensions stash bufferViews directly (KHR_draco, etc.) — at
    # minimum remap mesh primitive draco extensions if present.
    for mesh in new_gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            ext = prim.get("extensions", {})
            draco = ext.get("KHR_draco_mesh_compression")
            if draco and "bufferView" in draco and draco["bufferView"] in bv_index_remap:
                draco["bufferView"] = bv_index_remap[draco["bufferView"]]

    # Single combined buffer; update its declared length.
    final_blob = bytes(new_blob)
    new_gltf["buffers"] = [{"byteLength": len(final_blob)}]

    # Serialize the GLB container.
    json_chunk = json.dumps(new_gltf, separators=(",", ":")).encode("utf-8")
    json_chunk = _pad4(json_chunk, b" ")
    bin_chunk = _pad4(final_blob)

    total_len = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    out = bytearray()
    out.extend(struct.pack("<III", GLB_MAGIC, 2, total_len))
    out.extend(struct.pack("<II", len(json_chunk), CHUNK_JSON))
    out.extend(json_chunk)
    out.extend(struct.pack("<II", len(bin_chunk), CHUNK_BIN))
    out.extend(bin_chunk)

    out_glb.write_bytes(bytes(out))
    summary = {
        "source": str(original_glb),
        "out": str(out_glb),
        "images_total": len(images),
        "images_replaced": replaced_count,
        "materials_overridden": materials_overridden,
        "bytes": len(out),
    }
    if verbose:
        print(
            f"\nWrote {out_glb} ({len(out):,} bytes), "
            f"{replaced_count}/{len(images)} images replaced"
        )
    return summary


def main() -> None:
    if len(sys.argv) < 3:
        print(
            "usage: glb_pack.py <original.glb> <textures-dir> [out.glb]",
            file=sys.stderr,
        )
        sys.exit(2)
    orig = Path(sys.argv[1])
    tex_dir = Path(sys.argv[2])
    if len(sys.argv) > 3:
        out = Path(sys.argv[3])
    else:
        out = orig.with_name(orig.stem + "_repacked.glb")
    pack(orig, tex_dir, out, verbose=True)


if __name__ == "__main__":
    main()
