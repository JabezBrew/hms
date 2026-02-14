import pytest

from apps.users.session_service import _summarize_user_agent


@pytest.mark.tier1
class TestSessionService:
    @pytest.mark.parametrize(
        ("user_agent", "expected"),
        [
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 "
                "Mobile/15E148 Safari/604.1",
                "Safari on iOS",
            ),
            (
                "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 "
                "Mobile/15E148 Safari/604.1",
                "Safari on iOS",
            ),
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 "
                "Mobile/15E148 Safari/604.1",
                "Safari on iOS",
            ),
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_0) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 "
                "Safari/605.1.15",
                "Safari on macOS",
            ),
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/121.0.6167.73 "
                "Mobile/15E148 Safari/604.1",
                "Chrome on iOS",
            ),
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.2210.86 "
                "Mobile/15E148 Safari/605.1.15",
                "Edge on iOS",
            ),
            ("", ""),
        ],
    )
    def test_summarize_user_agent_detects_browser_and_os(self, user_agent, expected):
        assert _summarize_user_agent(user_agent) == expected
