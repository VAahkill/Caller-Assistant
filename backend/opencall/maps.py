"""Turn the user's map pin into words a delivery partner can use.

Uses OpenStreetMap Nominatim (free, no key; max one request per second and a
real User-Agent are required by its usage policy). If a Google Maps key is set
in the app, the app itself can show Google Maps; the server only needs text.
"""

from __future__ import annotations

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
