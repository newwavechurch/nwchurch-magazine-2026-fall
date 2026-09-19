"""p015 본문 마지막 줄 오탈자 보정: "…섬김의 자리가 되었습" 뒤에 빠진 "니다."를 붙인다.

원본 PDF 조판에서 마지막 줄이 잘려 나갔다. 같은 페이지의 "완료되었습니다."에서
"니다." 글리프를 그대로 잘라 다음 줄 첫머리(왼쪽 여백·줄 간격 동일)에 붙이므로
글꼴·크기·안티에일리어싱이 원문과 같다. 검색 인덱스에도 같은 단어를 넣는다.

build-assets.py --force 로 페이지를 다시 만든 뒤에는 이 스크립트를 다시 실행해야 한다.
    python scripts/patch-p015.py
"""
import json
import sys
from pathlib import Path

import fitz
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib
ba = importlib.import_module("build-assets")

ROOT = Path(__file__).resolve().parents[1]
PAGE = 15                      # 단면 번호
PDF_INDEX = 7                  # 펼침면 인덱스 (2k=14, 2k+1=15)
SRC_WORD = "완료되었습니다."     # 글리프를 빌려올 단어
TAIL = "니다."                  # 붙일 글자
PREV_WORD = "되었습"            # 이 단어 뒤 다음 줄에 붙인다
PAD = 2                        # 잘라낼 때 여백(px)


def find_chars(page, word, at_end=False):
    """word 가 들어 있는 span 의 글자 목록을 돌려준다. at_end 면 span 끝이 word 인 것만."""
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                chars = s["chars"]
                text = "".join(c["c"] for c in chars)
                if at_end:
                    if text.rstrip().endswith(word):
                        i = text.rstrip().rfind(word)
                        return chars[i:i + len(word)]
                    continue
                i = text.find(word)
                if i >= 0:
                    return chars[i:i + len(word)]
    raise SystemExit("span not found: " + word)


def main():
    doc = fitz.open(str(ba.SRC_PDF))
    page = doc[PDF_INDEX]
    half_w = page.rect.width / 2
    img_path = ROOT / "pages" / ("p%03d.webp" % PAGE)
    im = Image.open(img_path).convert("RGB")
    sx = im.width / half_w
    sy = im.height / page.rect.height

    src = find_chars(page, SRC_WORD)[-len(TAIL):]          # '니','다','.'
    x0 = min(c["bbox"][0] for c in src); x1 = max(c["bbox"][2] for c in src)
    y0 = min(c["bbox"][1] for c in src); y1 = max(c["bbox"][3] for c in src)
    src_base = src[0]["origin"][1]

    prev = find_chars(page, PREV_WORD, at_end=True)
    prev_base = prev[0]["origin"][1]
    # 줄 간격: 같은 문단 앞줄들의 baseline 차이
    bases = sorted({round(c["origin"][1], 2)
                    for b in page.get_text("rawdict")["blocks"] for l in b.get("lines", [])
                    for s in l["spans"] for c in s["chars"]
                    if c["origin"][0] > half_w and abs(c["bbox"][3] - c["bbox"][1] - (y1 - y0)) < 0.5})
    above = [b for b in bases if b < prev_base]
    pitch = prev_base - above[-1]
    # 문단 왼쪽 여백: 앞줄들 중 가장 왼쪽 글자
    left = min(c["bbox"][0] for b in page.get_text("rawdict")["blocks"] for l in b.get("lines", [])
               for s in l["spans"] for c in s["chars"]
               if c["origin"][0] > half_w and abs(c["origin"][1] - prev_base) < 0.5)

    crop = im.crop((round((x0 - half_w) * sx) - PAD, round(y0 * sy) - PAD,
                    round((x1 - half_w) * sx) + PAD, round(y1 * sy) + PAD))
    tx = round((left - half_w) * sx) - PAD
    ty = round((y0 + (prev_base + pitch - src_base)) * sy) - PAD
    im.paste(crop, (tx, ty))
    im.save(img_path, "WEBP", quality=ba.PAGE_QUALITY, method=6)
    th = round(ba.THUMB_WIDTH * im.height / im.width)
    im.resize((ba.THUMB_WIDTH, th), Image.LANCZOS).save(
        ROOT / "thumbs" / ("p%03d.webp" % PAGE), "WEBP", quality=ba.THUMB_QUALITY, method=6)
    print("pasted %s at (%d,%d) crop %s pitch %.2fpt" % (TAIL, tx, ty, crop.size, pitch))

    # 검색 인덱스: '되었습' 뒤에 '니다.' 단어 추가 (0~1 정규화, 반쪽 기준)
    sp = ROOT / "data" / "search.json"
    data = json.loads(sp.read_text(encoding="utf-8"))
    rec = next(r for r in data if r["page"] == PAGE)
    words = rec["words"]
    i = next(k for k, w in enumerate(words) if w[4] == PREV_WORD)
    if i + 1 < len(words) and words[i + 1][4] == TAIL:
        print("search.json already patched")
    else:
        nw = [round((left - half_w) / half_w, 5),
              round((y0 + (prev_base + pitch - src_base)) / page.rect.height, 5),
              round((left - half_w + (x1 - x0)) / half_w, 5),
              round((y1 + (prev_base + pitch - src_base)) / page.rect.height, 5), TAIL]
        words.insert(i + 1, nw)
        rec["text"] = " ".join(w[4] for w in words)
        sp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print("search.json patched")


if __name__ == "__main__":
    main()
