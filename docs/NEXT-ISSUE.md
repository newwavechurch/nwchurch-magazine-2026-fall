# 다음 호 e-book 만들기 (작업 지시서)

이 레포는 새물결교회 계간지 『더이웃 SNS』를 웹 플립북으로 배포하기 위한 **완성된 틀**이다.
다음 호(겨울호 등)는 아래 순서대로 **PDF와 배경음악만 바꿔** 새 레포로 찍어내면 된다.
Claude Code 등 AI 도구에 맡길 때는 이 문서를 그대로 붙여 주고 **1번의 입력 3가지**만 알려주면 된다.

> 예시 요청: "docs/NEXT-ISSUE.md 대로 겨울호 만들어줘. PDF는 `…/겨울_새물결교회 (웹용).pdf`, 음악은 `…/xxx.mp3`, 레포 이름은 `nwchurch-magazine-2026-winter`."

---

## 1. 준비물 (사람이 정하는 것)

| 항목 | 예 |
| --- | --- |
| e-book용 PDF | 인디자인에서 뽑은 **웹용 PDF**. 표지·뒤표지는 단면, 본문은 펼침면(2쪽이 한 장) |
| 배경음악 mp3 | 아무 길이나 가능(자동으로 128kbps로 줄임) |
| 새 레포 이름 | `nwchurch-magazine-<연도>-<season>` (예: `nwchurch-magazine-2026-winter`) |
| 호 이름 | 제목 `더이웃 SNS 겨울호`, 부제(표지 문구), `2026 겨울호` |

PDF 구조가 가을호와 같은지 확인: 0번 표지 단면(≈516×729pt), 1~N 펼침면(≈1032×729pt), 마지막 뒤표지 단면.
다르면 `scripts/build-assets.py`의 페이지 분할 로직을 손봐야 한다.

## 2. 레포 복제

```bash
cd C:\Dev
git clone https://github.com/newwavechurch/nwchurch-magazine-2026-fall nwchurch-magazine-2026-winter
cd nwchurch-magazine-2026-winter
rm -rf .git && git init -b main
rm -rf pages thumbs audio data/search.json data/toc.json   # 이전 호 산출물 제거
```

## 3. 호 정보 바꾸기 (파일 3개)

1. `scripts/build-assets.py` 상단 상수
   - `SRC_PDF`, `SRC_MP3` — 새 원본 경로
   - `BOOK_TITLE`, `BOOK_SUBTITLE`, `BOOK_ISSUE`
2. `index.html`
   - `<title>`, `og:title`, `og:description`
   - `og:url`, `og:image`, `og:image:secure_url` 안의 레포 이름 (`nwchurch-magazine-2026-fall` → 새 이름) — 카카오톡 링크 미리보기용이라 **절대 URL** 유지
3. `assets/app.js`
   - 1행 주석과 `replace(/\s*가을호\s*$/, '')` 의 "가을호" → 새 호 이름 (모바일 상단 제목에서 호 이름을 떼는 코드)

## 4. 에셋 생성

```bash
python scripts/build-assets.py --force
```

생성물: `pages/p001~pNNN.webp`(단면 1200px), `thumbs/`, `data/book.json`, `data/search.json`(단어 좌표 포함), `data/toc.json`, `audio/bgm.mp3`.
필요 도구: Python 3.10+, PyMuPDF, Pillow, ffmpeg.

**확인할 것**
- 로그의 총 장수 = 1 + (펼침면 수 × 2) + 1 인지
- `data/toc.json`이 목차 페이지의 섹션 수와 맞는지. 목차는 "큰 제목(≈35pt) + 섹션 번호(≈28pt)" 조판을 찾아 자동 검출한다. 디자인이 바뀌어 빗나가면 스크립트의 `DIVIDER_TITLE_MIN_SIZE` / `DIVIDER_NUM_MIN_SIZE`를 조정하거나 `toc.json`을 손으로 고친다.
- `pages/p001.webp`(표지), `p002/p003`(첫 펼침면 좌/우), 마지막 장을 열어 잘림·좌우 순서 확인

## 5. 표지 미리보기 이미지 (카카오톡 링크용)

`assets/og-cover.jpg`(1200×630)를 새 표지로 다시 만든다:

```bash
ffmpeg -y -i pages/p001.webp -filter_complex \
 "[0:v]scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630,boxblur=20[bg];[0:v]scale=-1:630[fg];[bg][fg]overlay=(W-w)/2:0" \
 -q:v 3 assets/og-cover.jpg
```

`assets/apple-touch-icon.png`(180×180)와 `assets/favicon.svg`도 표지 로고가 바뀌었으면 교체(안 바뀌었으면 그대로).

## 6. 로컬 확인

```bash
python -m http.server 8765
```

`http://localhost:8765` 를 **PC(1280 이상)** 와 **폰 크기(개발자도구 390×844)** 로 열어:
표지 → 넘김 → 뒤로 넘김 → 목차 클릭 → 검색(아무 단어) → 결과 클릭 시 본문 파란 하이라이트 → 소리 버튼 → 확대 → 마지막 장.
콘솔 에러 0건이어야 한다. 파일을 더블클릭(`file://`)로 열면 JSON 로드가 막혀 깨져 보이니 반드시 서버로.

## 7. 배포

```bash
git add -A
git commit -m "[추가 - 2026 겨울호 e-book]"
gh repo create newwavechurch/nwchurch-magazine-2026-winter --public --source=. --remote=origin \
  --description "새물결교회 계간지 더이웃 SNS 2026 겨울호 e-book"
git push --no-verify -u origin main      # RAID 훅이 main 직접 push를 막으므로 이 레포에 한해 우회 (사용자 허용됨)
gh api -X POST repos/newwavechurch/nwchurch-magazine-2026-winter/pages \
  -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'
```

1~2분 뒤 `https://newwavechurch.github.io/nwchurch-magazine-2026-winter/` 가 열린다.
실제 URL에서 6번 확인을 한 번 더 하고, **실제 폰(카카오톡 인앱)** 으로 넘김을 확인한다.

## 8. 마무리

- 교회 홈페이지(표지 QR이 가리키는 글, 가을호는 `nwchurch.or.kr/151`)에 새 링크를 거는 것은 교회 쪽 작업
- 여름호처럼 **FlipHTML5 유료 export를 쓰지 않는다** — 이 뷰어가 그 대체품이다. 여름호 엔진 코드를 복사해 오지 말 것(라이선스)

---

## 뷰어 구조 (고칠 일이 생기면)

| 파일 | 역할 |
| --- | --- |
| `index.html` | 마크업·OG 태그·SVG 아이콘 |
| `assets/app.js` | 뷰어 전체. 데스크톱(≥900px)은 StPageFlip 펼침 모드, **모바일 한 장 모드는 자체 구현(`mf*`, 코너 필 방식)** |
| `assets/app.css` | 스타일. 여름호(FlipHTML5) 색: 배경 #505050, 툴바 #333, 패널 #3963A5, 하이라이트 #0099ff |
| `vendor/` | StPageFlip 2.0.7(MIT), qrcode-generator(MIT). 외부 CDN 없음 |
| `scripts/build-assets.py` | PDF → 이미지·썸네일·검색 인덱스(단어 좌표)·목차·음악 |

설계 기준은 "여름호(FlipHTML5)와 비슷하게". 모바일 넘김은 여름호 엔진을 실측한 값(모서리 존 20%, 완료 임계 16%, easeOutQuad 330ms·span, 손가락 지연 45ms)으로 맞춰져 있으니 감으로 바꾸지 말 것.
