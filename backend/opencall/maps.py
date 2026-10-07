"""Turn the user's map pin into words a delivery partner can use, for free.

Uses OpenStreetMap Nominatim (free, no key; max one request per second and a
real User-Agent are required by its usage policy). Google Maps is only used
through plain links (a shared pin in, a map link out), which need no API key.
"""

from __future__ import annotations

import re

import httpx

NOMINATIM = "https://nominatim.openstreetmap.org"


async def reverse_geocode(lat: float, lng: float, client: httpx.AsyncClient | None = None) -> str:
    own = client is None
    client = client or httpx.AsyncClient(timeout=10, headers={"User-Agent": "OpenCall-Receptionist/0.1"})
    try:
        r = await client.get(
            f"{NOMINATIM}/reverse", params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 18, "addressdetails": 1}
        )
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError:
        return ""
    finally:
        if own:
            await client.aclose()
    addr = data.get("address", {})
    keys = ["amenity", "building", "house_number", "road", "neighbourhood", "suburb", "city", "postcode"]
    parts = [addr[k] for k in keys if addr.get(k)]
    return ", ".join(parts) or data.get("display_name", "")


_COORD_PATTERNS = [
    r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)",  # exact place pin inside /place/ URLs
    r"[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)",
    r"@(-?\d+\.\d+),(-?\d+\.\d+)",  # map centre
    r"geo:(-?\d+\.\d+),(-?\d+\.\d+)",
]


def coords_from_text(text: str) -> tuple[float, float] | None:
    for pattern in _COORD_PATTERNS:
        m = re.search(pattern, text or "")
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return lat, lng
    return None


async def coords_from_link(url: str, client: httpx.AsyncClient | None = None) -> tuple[float, float] | None:
    """Pin from a shared Google Maps link, so no Maps API key (or billing
    account) is ever needed. Short maps.app.goo.gl links are followed."""
    found = coords_from_text(url)
    if found:
        return found
    if not re.match(r"https://(maps\.app\.goo\.gl|goo\.gl/maps|(www\.)?google\.[a-z.]+/maps)", url or ""):
        return None
    own = client is None
    client = client or httpx.AsyncClient(timeout=10, follow_redirects=True, headers={"User-Agent": "OpenCall-Receptionist/0.1"})
    try:
        r = await client.get(url)
        return coords_from_text(str(r.url)) or coords_from_text(r.text[:200000])
    except httpx.HTTPError:
        return None
    finally:
        if own:
            await client.aclose()
