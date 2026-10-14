import asyncio
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import tiktok_comments_helper
from tiktok_comments_helper import (
    _collect_comments,
    fetch_comments_with_retries,
)


class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_with_backoff_then_returns_comments(self):
        attempts = 0
        delays = []

        async def fetch_attempt():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise RuntimeError("temporary failure")
            return ["hello"]

        async def sleep(delay):
            delays.append(delay)

        result = await fetch_comments_with_retries(fetch_attempt, sleep)

        self.assertEqual(result, {
            "status": "ok",
            "attempts": 3,
            "comments": ["hello"],
        })
        self.assertEqual(delays, [2, 4])

    async def test_stops_after_five_failed_attempts(self):
        attempts = 0
        delays = []

        async def fetch_attempt():
            nonlocal attempts
            attempts += 1
            raise RuntimeError("TikTok unavailable")

        async def sleep(delay):
            delays.append(delay)

        result = await fetch_comments_with_retries(fetch_attempt, sleep)

        self.assertEqual(attempts, 5)
        self.assertEqual(delays, [2, 4, 8, 16])
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["attempts"], 5)
        self.assertIn("TikTok unavailable", result["message"])

    async def test_missing_package_returns_json_without_retries(self):
        output = io.StringIO()
        with (
            patch.dict(sys.modules, {"httpx": None}),
            patch.object(sys, "argv", ["helper", "1234567890123456789"]),
            contextlib.redirect_stdout(output),
        ):
            exit_code = await tiktok_comments_helper.main()

        self.assertEqual(exit_code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["attempts"], 0)
        self.assertIn("httpx belum terpasang", result["message"])

    async def test_collects_two_pages_without_duplicates_and_caps_at_100(self):
        import httpx

        requested_cursors = []

        async def response_for_request(request):
            cursor = request.url.params["cursor"]
            requested_cursors.append(cursor)
            start = int(cursor)
            comments = [
                {"cid": str(index), "text": f"comment {index}"}
                for index in range(start, start + 50)
            ]
            if start:
                comments.insert(0, {"cid": "49", "text": "duplicate"})
            return httpx.Response(
                200,
                json={
                    "comments": comments,
                    "cursor": start + 50,
                    "has_more": 1,
                    "status_code": 0,
                },
                request=request,
            )

        transport = httpx.MockTransport(response_for_request)
        async with httpx.AsyncClient(transport=transport) as client:
            comments = await _collect_comments(client, "1234567890123456789")

        self.assertEqual(requested_cursors, ["0", "50"])
        self.assertEqual(len(comments), 100)
        self.assertEqual(comments[0], "comment 0")
        self.assertEqual(comments[-1], "comment 99")


if __name__ == "__main__":
    unittest.main()
