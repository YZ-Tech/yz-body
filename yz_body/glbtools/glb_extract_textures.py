"""Extract all embedded textures from a .glb file to a folder.

Usage:
    uv run tools/glb_extract_textures.py <path-to.glb> [out-dir]

If out-dir is omitted, writes next to the .glb as <name>_textures/.
Each image is named <index>_<material-name-or-image-name>.<ext>
and a sidecar JSON lists which materials reference which image and via which slot
(baseColor, normal, metallicRoughness, emissive, occlusion).
"""

import json
import struct
import sys
from pathlib import Path

GLB_MAGIC = 0x46546C67  # 'glTF'
CHUNK_JSON = 0x4E4F534A  # 'JSON'
CHUNK_BIN = 0x004E4942   # 'BIN\0'


def parse_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, _length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"Not a GLB file: bad magic {magic:#x}")
    if version != 2:
        raise ValueError(f"Unsupported GLB version {version}")

    offset = 12
    gltf_json: dict | None = None
    bin_blob = b""
    while offset < len(data):
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk_data = data[offset:offset + chunk_len]
        offset += chunk_len
        if chunk_type == CHUNK_JSON:
            gltf_json = json.loads(chunk_data.decode("utf-8"))
        elif chunk_type == CHUNK_BIN:
            bin_blob = chunk_data

    if gltf_json is None:
        raise ValueError("No JSON chunk in GLB")
    return gltf_json, bin_blob


def ext_from_mime(mime: str) -> str:
    if mime == "image/png":
        return ".png"
    if mime in ("image/jpeg", "image/jpg"):
        return ".jpg"
    if mime == "image/webp":
        return ".webp"
    return ".bin"


def extract(glb_path: Path, out_dir: Path, *, verbose: bool = False) -> dict:
    """Dump all embedded images from `glb_path` into `out_dir`. Returns the
    sidecar dict (also written to `_textures.json`)."""
    gltf, blob = parse_glb(glb_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    buffer_views = gltf.get("bufferViews", [])
    images = gltf.get("images", [])
    textures = gltf.get("textures", [])
    materials = gltf.get("materials", [])

    written: list[dict] = []
    for i, img in enumerate(images):
        name = img.get("name") or f"image_{i}"
        safe_name = "".join(c if c.isalnum() or c in ("_", "-", ".") else "_" for c in name)
        mime = img.get("mimeType", "")

        if "uri" in img:
            data = img["uri"].encode("utf-8")
            ext = ".uri.txt"
        else:
            bv_index = img.get("bufferView")
            if bv_index is None:
                continue
            bv = buffer_views[bv_index]
            start = bv.get("byteOffset", 0)
            length = bv["byteLength"]
            data = blob[start:start + length]
            ext = ext_from_mime(mime) if mime else _sniff_ext(data)

        filename = f"{i:02d}_{safe_name}{ext}"
        (out_dir / filename).write_bytes(data)
        written.append({"index": i, "file": filename, "bytes": len(data), "mime": mime})
        if verbose:
            print(f"  wrote {filename}  ({len(data):,} bytes)")

    # Map: which material slot uses which image
    refs: list[dict] = []
    for mi, mat in enumerate(materials):
        mat_name = mat.get("name") or f"material_{mi}"
        pbr = mat.get("pbrMetallicRoughness", {})
        slots = {
            "baseColor": pbr.get("baseColorTexture"),
            "metallicRoughness": pbr.get("metallicRoughnessTexture"),
            "normal": mat.get("normalTexture"),
            "occlusion": mat.get("occlusionTexture"),
            "emissive": mat.get("emissiveTexture"),
        }
        for slot_name, slot in slots.items():
            if not slot:
                continue
            tex_index = slot.get("index")
            if tex_index is None:
                continue
            tex = textures[tex_index]
            img_index = tex.get("source")
            if img_index is None:
                continue
            img_file = next(
                (w["file"] for w in written if w["index"] == img_index),
                None,
            )
            refs.append({
                "material": mat_name,
                "slot": slot_name,
                "image_index": img_index,
                "file": img_file,
            })

    sidecar = {
        "source": str(glb_path),
        "images": written,
        "material_refs": refs,
    }
    (out_dir / "_textures.json").write_text(json.dumps(sidecar, indent=2))
    if verbose:
        print(f"\nWrote {len(written)} image(s) and {len(refs)} material refs to {out_dir}")
    return sidecar


def _sniff_ext(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return ".bin"


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: glb_extract_textures.py <path-to.glb> [out-dir]", file=sys.stderr)
        sys.exit(2)
    glb = Path(sys.argv[1])
    if not glb.exists():
        print(f"not found: {glb}", file=sys.stderr)
        sys.exit(1)
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else glb.with_name(glb.stem + "_textures")
    print(f"extracting {glb} -> {out}")
    extract(glb, out, verbose=True)


if __name__ == "__main__":
    main()
