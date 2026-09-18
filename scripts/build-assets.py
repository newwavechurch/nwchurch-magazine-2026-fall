# -*- coding: utf-8 -*-
"""
가을호 e-book 에셋 빌드 스크립트 (재실행 가능 / idempotent)

실행:  python scripts/build-assets.py           이미 있는 이미지·음원은 건너뛴다
       python scripts/build-assets.py --force   전부 다시 만든다

생성물:
  pages/p001.webp ... pages/p076.webp   단면 페이지 이미지 (폭 1200)
  thumbs/p001.webp ...                  썸네일 (폭 240)
  data/search.json                      페이지별 본문 텍스트 + 단어 좌표
  data/toc.json                         섹션 목차
  data/book.json                        책 메타데이터
  audio/bgm.mp3                         배경음악 (128kbps 재인코딩)

입력 원본은 읽기만 하며 절대 수정하지 않는다.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

# --------------------------------------------------------------------------
# 입력 원본 경로 (개인 Dropbox 경로이므로 README 에 노출하지 않는다)
# --------------------------------------------------------------------------
SRC_PDF = Path(
    "D:/Raid Dropbox/이준원/007 연희자료/수노AI 음원(유튜브)"
    "/★ 새물결교회 계간지 작업/가을 (0920)/0. 인디자인"
    "/가을_새물결교회 (e-book 변환용) PDF"
    "/2. 가을_새물결교회 (웹용) ver1_0918_1차(e-book형).pdf"
)
SRC_MP3 = Path(
    "D:/Raid Dropbox/이준원/007 연희자료/수노AI 음원(유튜브)"
    "/몽골 단기선교/Endless Steppe of Hope (1).mp3"
)

# --------------------------------------------------------------------------
# 출력 설정
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
PAGES_DIR = ROOT / "pages"
THUMBS_DIR = ROOT / "thumbs"
DATA_DIR = ROOT / "data"
AUDIO_DIR = ROOT / "audio"

PAGE_WIDTH = 1200          # 단면 기준 출력 폭(px)
PAGE_QUALITY = 82
THUMB_WIDTH = 240
THUMB_QUALITY = 70
SUPERSAMPLE = 2            # 렌더 배율 (PAGE_WIDTH * 2 로 뽑은 뒤 축소)
EXPECTED_PAGES = 76
AUDIO_BITRATE = "128k"

BOOK_TITLE = "더이웃 SNS 가을호"
BOOK_SUBTITLE = "새물결교회 50주년 기념 계간지 · 더 닮음, 그리고 물듦"
BOOK_ISSUE = "2026 가을호"

# 섹션 표지(디바이더) 판정 기준
DIVIDER_TITLE_MIN_SIZE = 30.0   # 섹션 제목 글자 크기 하한
DIVIDER_NUM_MIN_SIZE = 24.0     # 섹션 번호 글자 크기 하한


def log(msg):
    print(msg, flush=True)


def half_rects(page):
    """펼침면이면 좌/우 반쪽 rect 두 개, 단면이면 전체 rect 하나."""
    r = page.rect
    if r.width > r.height:  # 가로로 긴 면 = 펼침면
        mid = r.x0 + r.width / 2.0
        return [
            fitz.Rect(r.x0, r.y0, mid, r.y1),
            fitz.Rect(mid, r.y0, r.x1, r.y1),
        ]
    return [fitz.Rect(r)]


def clean_text(s):
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def half_words(page, clip):
    """반쪽에 속하는 단어를 읽기 순서로 뽑아 [x0, y0, x1, y1, 단어] 목록으로 돌려준다.

    좌표는 그 반쪽(= 뷰어의 단면 한 쪽) 기준 0~1 정규화 값이다. 펼침면이면
    clip 이 좌/우 절반이므로 x 는 자동으로 해당 반쪽 기준으로 다시 잡힌다.
    """
    raw = page.get_text("words")  # (x0,y0,x1,y1, word, block, line, word_no)
    picked = []
    for x0, y0, x1, y1, w, bno, lno, wno in raw:
        cx = (x0 + x1) / 2.0
        cy = (y0 + y1) / 2.0
        if not (clip.x0 <= cx < clip.x1 and clip.y0 <= cy < clip.y1):
            continue
        t = clean_text(w)
        if not t:
            continue
        picked.append((bno, lno, wno, x0, y0, x1, y1, t))
    picked.sort(key=lambda t: (t[0], t[1], t[2]))

    cw = clip.width or 1.0
    ch = clip.height or 1.0
    out = []
    for _, _, _, x0, y0, x1, y1, t in picked:
        out.append([
            round(clamp01((x0 - clip.x0) / cw), 5),
            round(clamp01((y0 - clip.y0) / ch), 5),
            round(clamp01((x1 - clip.x0) / cw), 5),
            round(clamp01((y1 - clip.y0) / ch), 5),
            t,
        ])
    return out


def half_spans(page, clip):
    """반쪽 영역의 (글자크기, 텍스트) 스팬 목록."""
    d = page.get_text("dict", clip=clip)
    out = []
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for line in b["lines"]:
            for sp in line["spans"]:
                t = sp["text"].strip()
                if t:
                    out.append((float(sp["size"]), t))
    return out


def detect_divider(spans):
    """섹션 표지 페이지면 (섹션번호, 제목) 을 돌려준다.

    섹션 표지는 35pt 안팎의 큰 제목과 28pt 안팎의 섹션 번호(1~10)로 이루어져 있다.
    제목이 여러 스팬으로 쪼개지는 경우(예: '신앙 사계(' / '四季' / ')')가 있어
    큰 글자 스팬을 나온 순서대로 이어 붙인다.
    """
    title_parts = [t for sz, t in spans if sz >= DIVIDER_TITLE_MIN_SIZE]
    if not title_parts:
        return None
    nums = []
    for sz, t in spans:
        if DIVIDER_NUM_MIN_SIZE <= sz < DIVIDER_TITLE_MIN_SIZE:
            if re.fullmatch(r"\d{1,2}", t) and 1 <= int(t) <= 10:
                nums.append(int(t))
    if not nums:
        return None
    return nums[0], clean_text("".join(title_parts))


def page_names():
    return ["p%03d.webp" % (i + 1) for i in range(EXPECTED_PAGES)]


def images_done():
    """페이지·썸네일이 이미 모두 있으면 True."""
    return all((PAGES_DIR / n).exists() and (THUMBS_DIR / n).exists()
               for n in page_names())


def render_pages(doc, force=False):
    """페이지/썸네일 이미지를 만들고 (출력 높이, [(파일명, 바이트)]) 를 돌려준다.

    이미 다 있으면 다시 쓰지 않는다 (webp 인코더 버전이 달라지면 바이트가
    달라질 수 있어, 재실행이 이미지 파일을 건드리지 않게 막는다).
    --force 로만 다시 만든다.
    """
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)

    if not force and images_done():
        with Image.open(PAGES_DIR / page_names()[0]) as im:
            out_height = im.height
        sizes = [(n, (PAGES_DIR / n).stat().st_size) for n in page_names()]
        log("  이미 있는 %d 장 건너뜀 (다시 만들려면 --force)" % len(sizes))
        return out_height, sizes

    # 단면 폭(= 첫 면인 표지의 폭) 기준 렌더 배율
    zoom = (PAGE_WIDTH * SUPERSAMPLE) / doc[0].rect.width
    out_height = None
    sizes = []
    idx = 0

    for pno in range(doc.page_count):
        page = doc[pno]
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        n = len(half_rects(page))
        for k in range(n):
            idx += 1
            if n == 2:
                left = round(img.width * k / 2)
                right = round(img.width * (k + 1) / 2)
                crop = img.crop((left, 0, right, img.height))
            else:
                crop = img
            if out_height is None:
                out_height = round(PAGE_WIDTH * crop.height / crop.width)
            full = crop.resize((PAGE_WIDTH, out_height), Image.LANCZOS)
            name = "p%03d.webp" % idx
            fp = PAGES_DIR / name
            full.save(fp, "WEBP", quality=PAGE_QUALITY, method=6)
            th = round(THUMB_WIDTH * out_height / PAGE_WIDTH)
            full.resize((THUMB_WIDTH, th), Image.LANCZOS).save(
                THUMBS_DIR / name, "WEBP", quality=THUMB_QUALITY, method=6
            )
            sizes.append((name, fp.stat().st_size))
            log("  %s  %7.1f KB" % (name, fp.stat().st_size / 1024))

    assert idx == EXPECTED_PAGES, "페이지 수 불일치: %d != %d" % (idx, EXPECTED_PAGES)
    return out_height, sizes


def build_text(doc):
    """search.json / toc.json 데이터를 만든다."""
    search = []
    dividers = []  # (섹션번호, 단면페이지, 제목)
    idx = 0
    for pno in range(doc.page_count):
        page = doc[pno]
        for clip in half_rects(page):
            idx += 1
            words = half_words(page, clip)
            # text 는 반드시 words 를 공백으로 이어 붙인 것과 같아야 한다.
            # 뷰어가 text 의 문자 위치를 단어 인덱스로 되짚어 하이라이트를 그린다.
            search.append({
                "page": idx,
                "text": " ".join(w[4] for w in words),
                "words": words,
            })
            d = detect_divider(half_spans(page, clip))
            if d:
                dividers.append((d[0], idx, d[1]))

    seen = set()
    toc = []
    for num, pg, title in sorted(dividers):
        if num in seen:
            continue
        seen.add(num)
        toc.append({"title": title, "page": pg})
    return search, toc


def build_audio(force=False):
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    out = AUDIO_DIR / "bgm.mp3"
    if not force and out.exists():
        log("  이미 있는 bgm.mp3 건너뜀 (다시 만들려면 --force)")
        return out.stat().st_size
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg 를 찾을 수 없습니다.")
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(SRC_MP3), "-vn", "-c:a", "libmp3lame",
         "-b:a", AUDIO_BITRATE, str(out)],
        check=True,
    )
    return out.stat().st_size


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main():
    force = "--force" in sys.argv[1:]
    if not SRC_PDF.exists():
        log("입력 PDF 를 찾을 수 없습니다: %s" % SRC_PDF)
        return 1
    if not SRC_MP3.exists() and (force or not (AUDIO_DIR / "bgm.mp3").exists()):
        log("입력 MP3 를 찾을 수 없습니다: %s" % SRC_MP3)
        return 1

    doc = fitz.open(SRC_PDF)
    log("PDF: %d 면" % doc.page_count)

    log("[1/4] 페이지 이미지 · 썸네일 생성")
    height, sizes = render_pages(doc, force)

    total = sum(s for _, s in sizes)
    smallest = min(sizes, key=lambda t: t[1])
    largest = max(sizes, key=lambda t: t[1])
    log("  생성 %d 장 / 합계 %.2f MB / 평균 %.1f KB"
        % (len(sizes), total / 1048576.0, total / len(sizes) / 1024.0))
    log("  최소 %s %.1f KB / 최대 %s %.1f KB"
        % (smallest[0], smallest[1] / 1024.0, largest[0], largest[1] / 1024.0))
    log("  출력 크기 %dx%d" % (PAGE_WIDTH, height))

    log("[2/4] 텍스트 · 단어 좌표 · 목차 추출")
    search, toc = build_text(doc)
    write_json(DATA_DIR / "search.json", search)
    write_json(DATA_DIR / "toc.json", toc)
    nwords = sum(len(r["words"]) for r in search)
    log("  search.json %d 항목 / 단어 %d 개 / toc.json %d 항목"
        % (len(search), nwords, len(toc)))
    for t in toc:
        log("    p%03d  %s" % (t["page"], t["title"]))

    log("[3/4] 배경음악 재인코딩")
    asize = build_audio(force)
    log("  audio/bgm.mp3 %.2f MB (원본 %.2f MB)"
        % (asize / 1048576.0, SRC_MP3.stat().st_size / 1048576.0))

    log("[4/4] book.json 작성")
    write_json(DATA_DIR / "book.json", {
        "title": BOOK_TITLE,
        "subtitle": BOOK_SUBTITLE,
        "issue": BOOK_ISSUE,
        "pageWidth": PAGE_WIDTH,
        "pageHeight": height,
        "pageCount": EXPECTED_PAGES,
        "pages": "pages/p{NNN}.webp",
        "thumbs": "thumbs/p{NNN}.webp",
        "music": "audio/bgm.mp3",
        "search": "data/search.json",
        "toc": "data/toc.json",
    })
    log("완료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
