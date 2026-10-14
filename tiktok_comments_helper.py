import asyncio
import json
import re
import sys

MAX_ATTEMPTS = 5
RETRY_DELAYS = (2, 4, 8, 16)
MAX_COMMENTS = 100
COMMENTS_PER_PAGE = 50
MAX_PAGES = 5
ATTEMPT_TIMEOUT_SECONDS = 35

COMMENT_ENDPOINT = "https://www.tiktok.com/api/comment/list/"
REQUEST_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.tiktok.com/",
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}


async def _collect_comments(client, video_id):
    cursor = 0
    comments = []
    seen_comment_ids = set()

    for _ in range(MAX_PAGES):
        response = await client.get(
            COMMENT_ENDPOINT,
            params={
                "aid": "1988",
                "aweme_id": video_id,
                "count": COMMENTS_PER_PAGE,
                "cursor": cursor,
            },
        )
        response.raise_for_status()
        payload = response.json()

        if payload.get("status_code") not in (0, "0", None):
            message = str(payload.get("status_msg") or "TikTok menolak permintaan.")
            raise RuntimeError(f"API TikTok: {message[:200]}")

        page_comments = payload.get("comments")
        if not isinstance(page_comments, list):
            raise ValueError("Format komentar dari TikTok tidak valid.")

        for comment in page_comments:
            if not isinstance(comment, dict):
                continue

            comment_id = str(comment.get("cid") or "")
            if comment_id and comment_id in seen_comment_ids:
                continue
            if comment_id:
                seen_comment_ids.add(comment_id)

            text = re.sub(r"\s+", " ", str(comment.get("text") or "")).strip()
            if text:
                comments.append(text[:500])
                if len(comments) >= MAX_COMMENTS:
                    return comments

        next_cursor = payload.get("cursor")
        has_more = payload.get("has_more") in (True, 1, "1")
        if not has_more or next_cursor is None or str(next_cursor) == str(cursor):
            break
        cursor = next_cursor

    return comments


async def _fetch_comments_once(video_id):
    import httpx

    async with httpx.AsyncClient(
        follow_redirects=True,
        headers=REQUEST_HEADERS,
        timeout=httpx.Timeout(20, connect=10),
    ) as client:
        return await _collect_comments(client, video_id)


async def fetch_comments_with_retries(fetch_attempt, sleep=asyncio.sleep):
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            comments = await asyncio.wait_for(
                fetch_attempt(),
                timeout=ATTEMPT_TIMEOUT_SECONDS,
            )
            return {"status": "ok", "attempts": attempt, "comments": comments}
        except Exception as error:
            if attempt == MAX_ATTEMPTS:
                return {
                    "status": "error",
                    "attempts": attempt,
                    "message": f"{type(error).__name__}: {str(error)[:250]}",
                }

            delay = RETRY_DELAYS[attempt - 1]
            print(
                f"TikTok gagal pada percobaan {attempt}/{MAX_ATTEMPTS}; "
                f"mencoba lagi dalam {delay} detik.",
                file=sys.stderr,
            )
            await sleep(delay)


async def main():
    if len(sys.argv) < 2 or not re.fullmatch(r"\d{10,30}", sys.argv[1]):
        print(
            json.dumps(
                {
                    "status": "error",
                    "attempts": 0,
                    "message": "ID video TikTok tidak valid.",
                },
                ensure_ascii=False,
            )
        )
        return 2

    try:
        import httpx  # noqa: F401
    except ImportError as error:
        print(
            json.dumps(
                {
                    "status": "error",
                    "attempts": 0,
                    "message": (
                        "Paket httpx belum terpasang. Jalankan "
                        f"`python -m pip install -r requirements.txt`. Detail: "
                        f"{type(error).__name__}"
                    ),
                },
                ensure_ascii=False,
            )
        )
        return 1

    result = await fetch_comments_with_retries(
        lambda: _fetch_comments_once(sys.argv[1])
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
