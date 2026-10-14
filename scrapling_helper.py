import ipaddress
import json
import re
import socket
import sys
import time
from collections import deque
from urllib.parse import urldefrag, urljoin, urlsplit, urlunsplit

MAX_DEPTH = 10
MAX_PAGES = 100
MAX_REDIRECTS = 5
REQUEST_TIMEOUT_SECONDS = 15
CRAWL_DELAY_SECONDS = 0.25
MAX_EXCERPT_LENGTH = 400
REDIRECT_STATUSES = {301, 302, 303, 307, 308}


def safe_text(value):
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_url(value, base_hostname=None):
    candidate = value.strip()
    if not candidate:
        raise ValueError("URL tidak boleh kosong.")
    if "://" not in candidate:
        candidate = f"https://{candidate}"

    parsed = urlsplit(candidate)
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("Gunakan URL publik HTTP/HTTPS yang valid.")

    try:
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    except ValueError as error:
        raise ValueError("Port URL tidak valid.") from error

    expected_port = 443 if parsed.scheme.lower() == "https" else 80
    if port != expected_port:
        raise ValueError("Crawler hanya menerima port web standar 80 atau 443.")
    if base_hostname is not None and hostname != base_hostname:
        raise ValueError("Crawler hanya mengikuti tautan pada domain awal.")

    path = parsed.path or "/"
    return (
        urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.query, "")),
        hostname,
        port,
    )


def ensure_public_host(hostname, port):
    try:
        addresses = {
            ipaddress.ip_address(record[4][0])
            for record in socket.getaddrinfo(
                hostname,
                port,
                type=socket.SOCK_STREAM,
            )
        }
    except (OSError, ValueError) as error:
        raise ValueError(f"Domain tidak dapat di-resolve: {hostname}") from error

    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("URL mengarah ke alamat IP non-publik dan ditolak.")


def prepare_start_url(value):
    url, hostname, port = normalize_url(value)
    ensure_public_host(hostname, port)
    return url, hostname, port


def fetch_page(url, base_hostname):
    import httpx
    from scrapling.parser import Selector

    current_url = url
    for _ in range(MAX_REDIRECTS + 1):
        normalized_url, hostname, port = normalize_url(
            current_url,
            base_hostname=base_hostname,
        )
        ensure_public_host(hostname, port)
        response = httpx.get(
            normalized_url,
            follow_redirects=False,
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={"User-Agent": "Unicorn-MD-Wa/1.0 (+public page scraper)"},
        )

        if response.status_code in REDIRECT_STATUSES:
            location = response.headers.get("location")
            if not location:
                raise ValueError("Redirect tidak memiliki alamat tujuan.")
            current_url = urljoin(normalized_url, location)
            continue
        if response.status_code < 200 or response.status_code >= 300:
            raise ValueError(f"Server merespons HTTP {response.status_code}.")

        page = Selector(response.text, url=normalized_url)
        title = safe_text(page.css("title::text").get() or "")
        text_parts = page.css("body ::text").getall() or []
        text = safe_text(" ".join(part for part in text_parts if part))
        links = page.css("a::attr(href)").getall() or []
        return {
            "url": normalized_url,
            "title": title,
            "excerpt": text[:MAX_EXCERPT_LENGTH],
            "links": links,
        }

    raise ValueError("Terlalu banyak redirect pada halaman.")


def crawl_site(
    start_url,
    fetch=fetch_page,
    max_depth=MAX_DEPTH,
    max_pages=MAX_PAGES,
    delay=CRAWL_DELAY_SECONDS,
    sleep=time.sleep,
    progress=print,
):
    start_url, hostname, _ = prepare_start_url(start_url)
    queue = deque([(start_url, 0)])
    queued = {start_url}
    pages = []
    failures = []
    last_request_time = 0.0

    while queue and len(pages) + len(failures) < max_pages:
        current_url, depth = queue.popleft()
        elapsed = time.monotonic() - last_request_time
        if last_request_time and elapsed < delay:
            sleep(delay - elapsed)

        try:
            page = fetch(current_url, hostname)
            last_request_time = time.monotonic()
        except Exception as error:
            last_request_time = time.monotonic()
            failures.append(
                {"url": current_url, "depth": depth, "error": str(error)[:250]}
            )
            progress(
                f"SCRAPE_PROGRESS {len(pages) + len(failures)}/{max_pages} "
                f"{depth} {current_url}",
                file=sys.stderr,
                flush=True,
            )
            continue

        pages.append(
            {
                "url": page["url"],
                "depth": depth,
                "title": safe_text(page.get("title", ""))[:200],
                "excerpt": safe_text(page.get("excerpt", ""))[:MAX_EXCERPT_LENGTH],
            }
        )
        progress(
            f"SCRAPE_PROGRESS {len(pages) + len(failures)}/{max_pages} "
            f"{depth} {current_url}",
            file=sys.stderr,
            flush=True,
        )

        if depth >= max_depth:
            continue

        for href in page.get("links", []):
            try:
                next_url, _, _ = normalize_url(
                    urljoin(current_url, href),
                    base_hostname=hostname,
                )
            except (TypeError, ValueError):
                continue

            if next_url not in queued:
                queued.add(next_url)
                queue.append((next_url, depth + 1))

    scanned = len(pages) + len(failures)
    return {
        "status": "ok",
        "url": start_url,
        "max_depth": max_depth,
        "max_depth_reached": max(
            (page["depth"] for page in pages),
            default=0,
        ),
        "max_pages": max_pages,
        "pages_scanned": len(pages),
        "pages": pages,
        "failures": failures,
        "truncated": bool(queue),
        "excerpt": pages[0]["excerpt"] if pages else "",
        "message": (
            f"Selesai memeriksa {len(pages)} halaman sampai kedalaman "
            f"{max((page['depth'] for page in pages), default=0)}."
            + (f" {len(failures)} halaman gagal dibuka." if failures else "")
            + (f" Batas {max_pages} halaman tercapai." if queue and scanned >= max_pages else "")
        ),
    }


def main():
    if len(sys.argv) < 2:
        print(
            json.dumps(
                {
                    "status": "error",
                    "message": "URL tidak ditemukan. Contoh: .scrape https://example.com",
                },
                ensure_ascii=False,
            )
        )
        return 1

    try:
        result = crawl_site(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except ImportError as error:
        print(
            json.dumps(
                {
                    "status": "error",
                    "message": (
                        "Scrapling belum terpasang. Jalankan "
                        f"`python -m pip install -r requirements.txt`. Detail: "
                        f"{type(error).__name__}"
                    ),
                },
                ensure_ascii=False,
            )
        )
        return 1
    except Exception as error:
        print(
            json.dumps(
                {"status": "error", "message": str(error)[:400]},
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
