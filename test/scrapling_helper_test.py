import sys
import socket
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapling_helper import crawl_site, ensure_public_host, normalize_url


class UrlValidationTests(unittest.TestCase):
    def test_normalizes_url_and_removes_fragment(self):
        url, hostname, port = normalize_url(
            "https://Example.com/path#section"
        )

        self.assertEqual(url, "https://example.com/path")
        self.assertEqual(hostname, "example.com")
        self.assertEqual(port, 443)

    def test_rejects_external_host_credentials_and_non_web_scheme(self):
        with self.assertRaisesRegex(ValueError, "domain awal"):
            normalize_url(
                "https://outside.example/path",
                base_hostname="example.com",
            )
        with self.assertRaisesRegex(ValueError, "valid"):
            normalize_url("https://user:secret@example.com")
        with self.assertRaisesRegex(ValueError, "valid"):
            normalize_url("file:///etc/passwd")

    def test_rejects_private_ip_addresses(self):
        private_record = (
            socket.AF_INET,
            socket.SOCK_STREAM,
            6,
            "",
            ("127.0.0.1", 443),
        )
        with patch("scrapling_helper.socket.getaddrinfo", return_value=[private_record]):
            with self.assertRaisesRegex(ValueError, "non-publik"):
                ensure_public_host("example.com", 443)


class CrawlTests(unittest.TestCase):
    def setUp(self):
        self.public_host = patch("scrapling_helper.ensure_public_host")
        self.public_host.start()
        self.addCleanup(self.public_host.stop)

    def test_follows_same_host_links_to_ten_levels_and_skips_external_links(self):
        visited = []

        def fetch(url, hostname):
            visited.append(url)
            level = int(url.rsplit("/", 1)[-1])
            links = [f"/{level + 1}", "https://other.example/outside"]
            return {
                "url": url,
                "title": f"Page {level}",
                "excerpt": f"content {level}",
                "links": links,
            }

        result = crawl_site(
            "https://example.com/0",
            fetch=fetch,
            delay=0,
            sleep=lambda _: None,
            progress=lambda *args, **kwargs: None,
        )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["pages_scanned"], 11)
        self.assertEqual([page["depth"] for page in result["pages"]], list(range(11)))
        self.assertEqual(result["max_depth_reached"], 10)
        self.assertEqual(len(visited), 11)
        self.assertTrue(all("other.example" not in url for url in visited))
        self.assertFalse(result["truncated"])

    def test_stops_at_the_total_page_limit(self):
        visited = []

        def fetch(url, hostname):
            visited.append(url)
            page_number = int(url.rsplit("/", 1)[-1])
            return {
                "url": url,
                "title": "",
                "excerpt": "",
                "links": [f"/{page_number + index + 1}" for index in range(3)],
            }

        result = crawl_site(
            "https://example.com/0",
            fetch=fetch,
            max_depth=10,
            max_pages=5,
            delay=0,
            sleep=lambda _: None,
            progress=lambda *args, **kwargs: None,
        )

        self.assertEqual(len(visited), 5)
        self.assertEqual(result["pages_scanned"], 5)
        self.assertTrue(result["truncated"])


if __name__ == "__main__":
    unittest.main()
