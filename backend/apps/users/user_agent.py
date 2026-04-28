"""
User-agent parsing helpers shared across auth/session and audit features.
"""
from __future__ import annotations

try:
    from ua_parser import user_agent_parser
except Exception:  # pragma: no cover - optional dependency safety
    user_agent_parser = None


def _normalize_browser_name(browser_family: str, ua: str) -> str:
    family = (browser_family or '').lower()
    if 'edge' in family or 'edg/' in ua or 'edgios' in ua or 'edga/' in ua:
        return 'Edge'
    if 'chrome' in family or 'crios' in family or 'crios' in ua:
        return 'Chrome'
    if 'firefox' in family or 'fxios' in family or 'fxios' in ua:
        return 'Firefox'
    if 'opera' in family or 'opr/' in family or 'opios' in family or 'opr/' in ua:
        return 'Opera'
    if 'safari' in family or ('safari' in ua and 'chrome' not in ua and 'crios' not in ua):
        return 'Safari'
    return 'Browser'


def _normalize_os_name(os_family: str, ua: str) -> str:
    family = (os_family or '').lower()
    if (
        'iphone' in ua
        or 'ipad' in ua
        or 'ipod' in ua
        or ('macintosh' in ua and 'mobile/' in ua)
        or family == 'ios'
    ):
        return 'iOS'
    if family == 'android' or 'android' in ua:
        return 'Android'
    if family in {'windows', 'windows nt'} or 'windows' in ua:
        return 'Windows'
    if family in {'mac os x', 'macos', 'mac os'} or (
        ('macintosh' in ua or 'mac os x' in ua) and 'like mac os x' not in ua
    ):
        return 'macOS'
    if family == 'linux' or 'linux' in ua:
        return 'Linux'
    return ''


def _summarize_user_agent_fallback(ua: str) -> str:
    browser = 'Browser'
    if 'edgios' in ua or 'edga/' in ua or 'edg/' in ua or 'edge/' in ua:
        browser = 'Edge'
    elif 'crios' in ua or ('chrome' in ua and 'edge' not in ua and 'edg' not in ua and 'opr/' not in ua):
        browser = 'Chrome'
    elif 'fxios' in ua or 'firefox' in ua:
        browser = 'Firefox'
    elif 'opera' in ua or 'opr/' in ua or 'opios' in ua:
        browser = 'Opera'
    elif 'safari' in ua and 'chrome' not in ua and 'crios' not in ua:
        browser = 'Safari'

    os_name = _normalize_os_name('', ua)
    return f"{browser} on {os_name}" if os_name else browser


def _summarize_user_agent_with_parser(user_agent: str) -> str:
    if not user_agent_parser:
        return ''
    try:
        parsed = user_agent_parser.Parse(user_agent)
    except Exception:
        return ''
    ua = user_agent.lower()
    browser = _normalize_browser_name(parsed.get('user_agent', {}).get('family', ''), ua)
    os_name = _normalize_os_name(parsed.get('os', {}).get('family', ''), ua)
    return f"{browser} on {os_name}" if os_name else browser


def summarize_user_agent(user_agent: str) -> str:
    ua = (user_agent or '').lower()
    if not ua:
        return ''
    summary = _summarize_user_agent_with_parser(user_agent)
    if summary:
        return summary
    return _summarize_user_agent_fallback(ua)

